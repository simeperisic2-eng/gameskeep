import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  articleSubjectLink,
  articleTopicLink,
  topicSubjectLink,
} from '@gameskeep/shared/validation';
import { db } from '../db/client';
import { articleSubjects, articleTopics, auditLogs, topicSubjects } from '../db/schema';
import { diffRows, writeAudit } from './audit';
import { registerArticleAdminRoutes } from './article-routes';
import { registerAwardAdminRoutes } from './award-routes';
import { registerAdAdminRoutes } from './ad-routes';
import { registerDashboardRoutes } from './dashboard-routes';
import { registerBiasAdminRoutes } from './bias-routes';
import { registerCatalogAdminRoutes } from './catalog-routes';
import { registerRatingAdminRoutes } from './rating-routes';
import { registerReputationAdminRoutes } from './reputation-routes';
import { deleteRow, getRow, insertRow, listRows, updateRow, type Row } from './crud';
import { actorOf, sendError, type Actor } from './http';
import { adminAuthHook, getAdminAuth } from './guard';
import { moderateComment } from '../community/service';
import { RESOURCE_BY_NAME, listResourceMeta, uniqueSlug, type ResourceDef } from './registry';

function requireResource(reply: FastifyReply, name: string): ResourceDef | null {
  const resource = RESOURCE_BY_NAME.get(name);
  if (!resource) {
    reply.code(404).send({ error: 'unknown_resource', message: `No admin resource "${name}"` });
    return null;
  }
  return resource;
}

/**
 * I6 hardening (CRITICAL — broken access control, review #1): enforce a
 * resource's minimum rank on the RESOLVED resource object, independent of any
 * URL-string section classification (which a percent-encoded section could
 * evade). The service token carries owner rank (50), so automation is
 * unaffected. Returns false (and replies 403) when the caller is below the floor.
 */
function enforceRank(req: FastifyRequest, reply: FastifyReply, resource: ResourceDef): boolean {
  const min = resource.minRank ?? 0;
  if (min <= 0) return true;
  const auth = getAdminAuth(req);
  if (!auth || auth.rank < min) {
    reply.code(403).send({ error: 'forbidden', message: `This resource requires rank ${min}.` });
    return false;
  }
  return true;
}

/**
 * I6 hardening (MED — audit leak): strip a resource's secret columns from
 * every CRUD payload AND every audit snapshot. `passwordHash` (and any future
 * secret column) must never appear in an admin response or an audit row.
 */
function redactRow(resource: ResourceDef, row: Row | null): Row | null {
  const fields = resource.redactFields;
  if (!row || !fields || fields.length === 0) return row;
  const out: Row = { ...row };
  for (const f of fields) {
    if (f in out) out[f] = out[f] == null ? null : '[REDACTED]';
  }
  return out;
}

function redactDiff(resource: ResourceDef, diff: Row): Row {
  const fields = resource.redactFields;
  if (!fields || fields.length === 0) return diff;
  const out: Row = { ...diff };
  for (const f of fields) {
    if (f in out) out[f] = '[REDACTED]';
  }
  return out;
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
    changes: { created: redactRow(resource, row) },
    actor,
  });
  return redactRow(resource, row)!;
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
    changes: redactDiff(resource, diffRows(before, after)),
    actor,
  });
  return redactRow(resource, after)!;
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
    changes: { deleted: redactRow(resource, before) },
    actor,
  });
  return redactRow(resource, before);
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
      // Dual-path guard for the whole admin surface (SPEC I6, Slice 3): a
      // rank-gated staff SESSION (the primary human path, CSRF-checked on
      // mutations) OR the `x-admin-token` service credential (RETAINED for
      // automation — a hard constraint; verify:i1…b2 depend on it). See
      // ./guard.ts for the full contract.
      admin.addHook('onRequest', adminAuthHook);

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

      // ── comment moderation (SPEC I6, Slice 4, decision 8) ───────────────────
      // Soft-remove / restore a reported comment. Section 'comments' is gated at
      // MODERATOR rank (see admin/rbac.ts); the full moderation dashboard is I8.
      admin.post<{ Params: { id: string } }>('/comments/:id/remove', async (req, reply) => {
        const ok = await moderateComment(req.params.id, true, actorOf(req));
        if (!ok) {
          reply.code(404).send({ error: 'not_found' });
          return;
        }
        reply.send({ ok: true, isRemoved: true });
      });
      admin.post<{ Params: { id: string } }>('/comments/:id/restore', async (req, reply) => {
        const ok = await moderateComment(req.params.id, false, actorOf(req));
        if (!ok) {
          reply.code(404).send({ error: 'not_found' });
          return;
        }
        reply.send({ ok: true, isRemoved: false });
      });

      // ── catalog + unmatched-queue routes (before generic so they win) ───────
      await registerCatalogAdminRoutes(admin);

      // ── clustering engine routes (before generic so they win) ───────────────
      await registerArticleAdminRoutes(admin);

      // ── bias engine routes (before generic so they win) ─────────────────────
      await registerBiasAdminRoutes(admin);

      // ── rating engine routes (before generic so they win) ───────────────────
      await registerRatingAdminRoutes(admin);

      // ── reputation engine routes (before generic so they win) ───────────────
      await registerReputationAdminRoutes(admin);

      // ── awards routes (before generic so they win) ──────────────────────────
      await registerAwardAdminRoutes(admin);

      // ── Control Panel dashboard (before generic so it wins) ──────────────────
      await registerDashboardRoutes(admin);

      // ── ad / promotion management (before generic so it wins) ────────────────
      await registerAdAdminRoutes(admin);

      // ── generic resource CRUD ──────────────────────────────────────────────
      admin.get('/:resource', async (req, reply) => {
        const { resource: name } = req.params as { resource: string };
        const resource = requireResource(reply, name);
        if (!resource) return;
        if (!enforceRank(req, reply, resource)) return;
        try {
          const rows = resource.ops?.list
            ? await resource.ops.list()
            : await listRows(resource.table);
          reply.send({ data: rows.map((r) => redactRow(resource, r)) });
        } catch (err) {
          sendError(reply, err);
        }
      });

      admin.get('/:resource/:id', async (req, reply) => {
        const { resource: name, id } = req.params as { resource: string; id: string };
        const resource = requireResource(reply, name);
        if (!resource) return;
        if (!enforceRank(req, reply, resource)) return;
        try {
          const row = resource.ops?.get
            ? await resource.ops.get(id)
            : await getRow(resource.table, id);
          if (!row) {
            reply.code(404).send({ error: 'not_found' });
            return;
          }
          reply.send({ data: redactRow(resource, row) });
        } catch (err) {
          sendError(reply, err);
        }
      });

      admin.post('/:resource', async (req, reply) => {
        const { resource: name } = req.params as { resource: string };
        const resource = requireResource(reply, name);
        if (!resource) return;
        if (!enforceRank(req, reply, resource)) return;
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
        if (!enforceRank(req, reply, resource)) return;
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
        if (!enforceRank(req, reply, resource)) return;
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
