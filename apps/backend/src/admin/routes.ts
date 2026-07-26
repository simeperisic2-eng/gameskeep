import type { FastifyInstance, FastifyReply } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  articleSubjectLink,
  articleTopicLink,
  topicSubjectLink,
} from '@gameskeep/shared/validation';
import { env } from '../config/env';
import { db } from '../db/client';
import { articleSubjects, articleTopics, auditLogs, topicSubjects } from '../db/schema';
import { diffRows, writeAudit } from './audit';
import { registerArticleAdminRoutes } from './article-routes';
import { registerBiasAdminRoutes } from './bias-routes';
import { registerCatalogAdminRoutes } from './catalog-routes';
import { registerRatingAdminRoutes } from './rating-routes';
import { deleteRow, getRow, insertRow, listRows, updateRow, type Row } from './crud';
import { actorOf, sendError, type Actor } from './http';
import { RESOURCE_BY_NAME, listResourceMeta, uniqueSlug, type ResourceDef } from './registry';

function requireResource(reply: FastifyReply, name: string): ResourceDef | null {
  const resource = RESOURCE_BY_NAME.get(name);
  if (!resource) {
    reply.code(404).send({ error: 'unknown_resource', message: `No admin resource "${name}"` });
    return null;
  }
  return resource;
}

// ── generic CRUD operations ──────────────────────────────────────────────────
async function createOne(resource: ResourceDef, body: unknown, actor: Actor): Promise<Row> {
  const parsed = resource.create.parse(body) as Row;
  if (resource.ops?.create) return resource.ops.create(parsed, actor);
  const values: Row = { ...parsed };
  if (resource.hasSlug && resource.slugFrom && !values.slug) {
    values.slug = await uniqueSlug(resource.table, String(values[resource.slugFrom] ?? 'item'));
  }
  const row = await insertRow(resource.table, values);
  await writeAudit({
    action: 'create',
    entityType: resource.name,
    entityId: String(row.id),
    changes: { created: row },
    actor,
  });
  return row;
}

async function updateOne(
  resource: ResourceDef,
  id: string,
  body: Record<string, unknown>,
  actor: Actor,
): Promise<Row | null> {
  const parsed = resource.update.parse(body) as Row;
  const rawKeys = Object.keys(body ?? {});
  if (resource.ops?.update) return resource.ops.update(id, parsed, rawKeys, actor);
  const before = await getRow(resource.table, id);
  if (!before) return null;
  // Apply only the fields the client actually sent (no default-injection on PATCH).
  const patch: Row = {};
  for (const key of rawKeys) if (key in parsed) patch[key] = parsed[key];
  const after = await updateRow(resource.table, id, patch);
  if (!after) return null;
  await writeAudit({
    action: 'update',
    entityType: resource.name,
    entityId: id,
    changes: diffRows(before, after),
    actor,
  });
  return after;
}

async function deleteOne(resource: ResourceDef, id: string, actor: Actor): Promise<Row | null> {
  if (resource.ops?.remove) return resource.ops.remove(id, actor);
  const before = await getRow(resource.table, id);
  if (!before) return null;
  await deleteRow(resource.table, id);
  await writeAudit({
    action: 'delete',
    entityType: resource.name,
    entityId: id,
    changes: { deleted: before },
    actor,
  });
  return before;
}

/** Which columns are pgvector — proves the embedding columns exist (verify #6). */
async function vectorColumns(): Promise<{ table: string; column: string }[]> {
  const res = await db.execute(
    sql`SELECT table_name, column_name FROM information_schema.columns WHERE udt_name = 'vector' ORDER BY table_name, column_name`,
  );
  const rows = (res as unknown as { rows?: Row[] }).rows ?? (res as unknown as Row[]);
  return (rows as Row[]).map((r) => ({
    table: String(r.table_name),
    column: String(r.column_name),
  }));
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (admin) => {
      // Token guard for the whole admin surface (full RBAC arrives in I8).
      admin.addHook('onRequest', async (req, reply) => {
        const token = req.headers['x-admin-token'];
        const provided = Array.isArray(token) ? token[0] : token;
        if (provided !== env.ADMIN_API_TOKEN) {
          reply
            .code(401)
            .send({ error: 'unauthorized', message: 'Missing or invalid admin token' });
        }
      });

      admin.get('/_meta', async () => ({
        resources: listResourceMeta(),
        vectorColumns: await vectorColumns(),
      }));

      // Read the immutable audit trail (full audit UI is I8). Optional filters.
      admin.get('/_audit', async (req) => {
        const q = req.query as { entityType?: string; entityId?: string; limit?: string };
        const conds = [];
        if (q.entityType) conds.push(eq(auditLogs.entityType, q.entityType));
        if (q.entityId) conds.push(eq(auditLogs.entityId, q.entityId));
        const where = conds.length > 0 ? and(...conds) : undefined;
        const limit = Math.min(Number(q.limit ?? 50) || 50, 200);
        const rows = await db
          .select()
          .from(auditLogs)
          .where(where)
          .orderBy(desc(auditLogs.createdAt))
          .limit(limit);
        return { data: rows };
      });

      // ── relation routes (declared before /:resource so they take precedence) ──
      admin.post('/relations/topic-subject', async (req, reply) => {
        try {
          const { topicId, subjectId } = topicSubjectLink.parse(req.body);
          await db.insert(topicSubjects).values({ topicId, subjectId }).onConflictDoNothing();
          await writeAudit({
            action: 'create',
            entityType: 'topic-subjects',
            entityId: `${topicId}:${subjectId}`,
            changes: { topicId, subjectId },
            actor: actorOf(req),
          });
          reply.code(201).send({ topicId, subjectId });
        } catch (err) {
          sendError(reply, err);
        }
      });
      admin.delete('/relations/topic-subject', async (req, reply) => {
        try {
          const { topicId, subjectId } = topicSubjectLink.parse(req.body);
          await db
            .delete(topicSubjects)
            .where(and(eq(topicSubjects.topicId, topicId), eq(topicSubjects.subjectId, subjectId)));
          await writeAudit({
            action: 'delete',
            entityType: 'topic-subjects',
            entityId: `${topicId}:${subjectId}`,
            actor: actorOf(req),
          });
          reply.send({ ok: true });
        } catch (err) {
          sendError(reply, err);
        }
      });

      admin.post('/relations/article-topic', async (req, reply) => {
        try {
          const { articleId, topicId, isPrimary } = articleTopicLink.parse(req.body);
          await db.transaction(async (tx) => {
            // Enforce a single primary topic per article before (re)linking.
            if (isPrimary) {
              await tx
                .update(articleTopics)
                .set({ isPrimary: false })
                .where(eq(articleTopics.articleId, articleId));
            }
            await tx
              .insert(articleTopics)
              .values({ articleId, topicId, isPrimary })
              .onConflictDoUpdate({
                target: [articleTopics.articleId, articleTopics.topicId],
                set: { isPrimary },
              });
          });
          await writeAudit({
            action: 'create',
            entityType: 'article-topics',
            entityId: `${articleId}:${topicId}`,
            changes: { articleId, topicId, isPrimary },
            actor: actorOf(req),
          });
          reply.code(201).send({ articleId, topicId, isPrimary });
        } catch (err) {
          sendError(reply, err);
        }
      });
      admin.delete('/relations/article-topic', async (req, reply) => {
        try {
          const { articleId, topicId } = articleTopicLink.parse(req.body);
          await db
            .delete(articleTopics)
            .where(and(eq(articleTopics.articleId, articleId), eq(articleTopics.topicId, topicId)));
          await writeAudit({
            action: 'delete',
            entityType: 'article-topics',
            entityId: `${articleId}:${topicId}`,
            actor: actorOf(req),
          });
          reply.send({ ok: true });
        } catch (err) {
          sendError(reply, err);
        }
      });

      admin.post('/relations/article-subject', async (req, reply) => {
        try {
          const { articleId, subjectId } = articleSubjectLink.parse(req.body);
          await db.insert(articleSubjects).values({ articleId, subjectId }).onConflictDoNothing();
          await writeAudit({
            action: 'create',
            entityType: 'article-subjects',
            entityId: `${articleId}:${subjectId}`,
            changes: { articleId, subjectId },
            actor: actorOf(req),
          });
          reply.code(201).send({ articleId, subjectId });
        } catch (err) {
          sendError(reply, err);
        }
      });
      admin.delete('/relations/article-subject', async (req, reply) => {
        try {
          const { articleId, subjectId } = articleSubjectLink.parse(req.body);
          await db
            .delete(articleSubjects)
            .where(
              and(
                eq(articleSubjects.articleId, articleId),
                eq(articleSubjects.subjectId, subjectId),
              ),
            );
          await writeAudit({
            action: 'delete',
            entityType: 'article-subjects',
            entityId: `${articleId}:${subjectId}`,
            actor: actorOf(req),
          });
          reply.send({ ok: true });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // ── catalog + unmatched-queue routes (before generic so they win) ───────
      await registerCatalogAdminRoutes(admin);

      // ── clustering engine routes (before generic so they win) ───────────────
      await registerArticleAdminRoutes(admin);

      // ── bias engine routes (before generic so they win) ─────────────────────
      await registerBiasAdminRoutes(admin);

      // ── rating engine routes (before generic so they win) ───────────────────
      await registerRatingAdminRoutes(admin);

      // ── generic resource CRUD ──────────────────────────────────────────────
      admin.get('/:resource', async (req, reply) => {
        const { resource: name } = req.params as { resource: string };
        const resource = requireResource(reply, name);
        if (!resource) return;
        try {
          const rows = resource.ops?.list
            ? await resource.ops.list()
            : await listRows(resource.table);
          reply.send({ data: rows });
        } catch (err) {
          sendError(reply, err);
        }
      });

      admin.get('/:resource/:id', async (req, reply) => {
        const { resource: name, id } = req.params as { resource: string; id: string };
        const resource = requireResource(reply, name);
        if (!resource) return;
        try {
          const row = resource.ops?.get
            ? await resource.ops.get(id)
            : await getRow(resource.table, id);
          if (!row) {
            reply.code(404).send({ error: 'not_found' });
            return;
          }
          reply.send({ data: row });
        } catch (err) {
          sendError(reply, err);
        }
      });

      admin.post('/:resource', async (req, reply) => {
        const { resource: name } = req.params as { resource: string };
        const resource = requireResource(reply, name);
        if (!resource) return;
        try {
          const row = await createOne(resource, req.body, actorOf(req));
          reply.code(201).send({ data: row });
        } catch (err) {
          sendError(reply, err);
        }
      });

      admin.patch('/:resource/:id', async (req, reply) => {
        const { resource: name, id } = req.params as { resource: string; id: string };
        const resource = requireResource(reply, name);
        if (!resource) return;
        try {
          const row = await updateOne(
            resource,
            id,
            (req.body ?? {}) as Record<string, unknown>,
            actorOf(req),
          );
          if (!row) {
            reply.code(404).send({ error: 'not_found' });
            return;
          }
          reply.send({ data: row });
        } catch (err) {
          sendError(reply, err);
        }
      });

      admin.delete('/:resource/:id', async (req, reply) => {
        const { resource: name, id } = req.params as { resource: string; id: string };
        const resource = requireResource(reply, name);
        if (!resource) return;
        try {
          const row = await deleteOne(resource, id, actorOf(req));
          if (!row) {
            reply.code(404).send({ error: 'not_found' });
            return;
          }
          reply.send({ data: row });
        } catch (err) {
          sendError(reply, err);
        }
      });
    },
    { prefix: '/admin/api' },
  );
}
