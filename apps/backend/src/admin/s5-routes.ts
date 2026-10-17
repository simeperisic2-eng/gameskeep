import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  communityNoteDraft,
  communityNotePolishInput,
  communitySettingsPatch,
  criticFeedDismiss,
  criticFeedScore,
  reputationSettingsPatch,
  steamSummaryOverride,
} from '@gameskeep/shared/validation';
import { db } from '../db/client';
import { appSettings } from '../db/schema';
import { writeAudit, type AuditActor } from './audit';
import { actorOf, sendError } from './http';
import {
  acceptPolish,
  discardPolish,
  getNote,
  listNotes,
  NoteError,
  polishNote,
  publishNote,
  saveDraft,
  unpublishNote,
} from '../community/notes';
import {
  listSteamSummaries,
  overrideSteamSummary,
  SteamSummaryError,
} from '../steam/review-summary';
import { enqueueSteamSummaries } from '../steam/review-jobs';
import {
  criticFeedQueue,
  CriticFeedError,
  dismissedFeedItems,
  dismissFeedItem,
  restoreFeedItem,
  scoreFeedItem,
} from '../critics/feed';
import {
  approveSummary,
  listStorySummaries,
  SummaryApprovalError,
  withdrawSummaryApproval,
} from '../articles/summary-approval';
import { requestSearchRefresh } from '../search/jobs';
import { enqueueHomepageCompute } from '../homepage/jobs';
import {
  COMMUNITY_DEFAULTS,
  COMMUNITY_SETTINGS_KEY,
  communitySettings,
} from '../community/settings';
import {
  REPUTATION_DEFAULTS,
  REPUTATION_SETTINGS_KEY,
  reputationSettings,
} from '../reputation/settings';
import { enqueueReputationRecompute } from '../reputation/jobs';
import { describeCriticProvider } from '../data-source/critics';

/**
 * Phase P S5 admin surfaces.
 *  - `community-voice` (MODERATOR+, owner answer): the editor note (draft, AI
 *    polish + validator verdict + diff, accept / discard, publish / unpublish)
 *    and the Steam reviews summary overrides (hide / edit / approve / back to
 *    automatic) + "Run now" (a job id).
 *  - `critic-feed` (MODERATOR+): "Score this review" — confirm a (suggested)
 *    score, dismiss "not a scored review", restore.
 *  - `story-summaries` (MODERATOR+): approve / withdraw a story's AI text as
 *    editorial (who + when recorded).
 *  - `community-settings`, `reputation-settings` (ADMIN): the knobs that lived
 *    only in the database until S5 — validated, audited per field.
 */
function fail(reply: FastifyReply, err: unknown): void {
  if (
    err instanceof NoteError ||
    err instanceof SteamSummaryError ||
    err instanceof CriticFeedError ||
    err instanceof SummaryApprovalError
  ) {
    reply
      .code(err.status)
      .send({ error: err.status === 404 ? 'not_found' : 'invalid', message: err.message });
    return;
  }
  sendError(reply, err);
}

const guidBody = z.object({ guid: z.string().trim().min(1).max(400) });
const uuidParam = z.string().uuid();

async function saveSettingsRow(
  key: string,
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
  actor: AuditActor,
): Promise<{ changed: string[]; value: Record<string, unknown> }> {
  const value = { ...before, ...patch };
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (JSON.stringify(before[k]) !== JSON.stringify(v)) changes[k] = { from: before[k], to: v };
  }
  if (Object.keys(changes).length === 0) return { changed: [], value };
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  await writeAudit({
    action: 'update',
    entityType: 'app-settings',
    entityId: key,
    changes,
    summary: `${key}: ${Object.keys(changes).join(', ')}`,
    actor,
  });
  return { changed: Object.keys(changes), value };
}

export async function registerS5AdminRoutes(admin: FastifyInstance): Promise<void> {
  // ── community voice ─────────────────────────────────────────────────────────
  admin.get('/community-voice', async (_req, reply) => {
    try {
      const [notes, steam] = await Promise.all([listNotes(), listSteamSummaries()]);
      reply.send({ data: { notes, steam } });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.get<{ Params: { slug: string } }>('/community-voice/:slug', async (req, reply) => {
    try {
      const note = await getNote(req.params.slug);
      const steam = (await listSteamSummaries()).find((s) => s.slug === req.params.slug) ?? null;
      reply.send({ data: { note, steam } });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.put<{ Params: { slug: string } }>('/community-voice/:slug/note', async (req, reply) => {
    try {
      const input = communityNoteDraft.parse(req.body ?? {});
      reply.send({ data: await saveDraft(req.params.slug, input, actorOf(req)) });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.post<{ Params: { slug: string } }>('/community-voice/:slug/polish', async (req, reply) => {
    try {
      const input = communityNotePolishInput.parse(req.body ?? {});
      reply.send({ data: await polishNote(req.params.slug, input, actorOf(req)) });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.post<{ Params: { slug: string } }>(
    '/community-voice/:slug/polish/accept',
    async (req, reply) => {
      try {
        reply.send({ data: await acceptPolish(req.params.slug, actorOf(req)) });
      } catch (err) {
        fail(reply, err);
      }
    },
  );
  admin.post<{ Params: { slug: string } }>(
    '/community-voice/:slug/polish/discard',
    async (req, reply) => {
      try {
        reply.send({ data: await discardPolish(req.params.slug, actorOf(req)) });
      } catch (err) {
        fail(reply, err);
      }
    },
  );
  admin.post<{ Params: { slug: string } }>('/community-voice/:slug/publish', async (req, reply) => {
    try {
      reply.send({ data: await publishNote(req.params.slug, actorOf(req)) });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.post<{ Params: { slug: string } }>(
    '/community-voice/:slug/unpublish',
    async (req, reply) => {
      try {
        reply.send({ data: await unpublishNote(req.params.slug, actorOf(req)) });
      } catch (err) {
        fail(reply, err);
      }
    },
  );
  admin.post<{ Params: { slug: string } }>('/community-voice/:slug/steam', async (req, reply) => {
    try {
      const input = steamSummaryOverride.parse(req.body ?? {});
      await overrideSteamSummary(req.params.slug, input, actorOf(req));
      reply.send({ ok: true });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.post('/community-voice/steam/run', async (_req, reply) => {
    try {
      reply.code(202).send({ jobId: (await enqueueSteamSummaries('admin')) ?? null });
    } catch (err) {
      fail(reply, err);
    }
  });

  // ── critic feed ─────────────────────────────────────────────────────────────
  admin.get('/critic-feed', async (_req, reply) => {
    try {
      const [queue, dismissed] = await Promise.all([criticFeedQueue(), dismissedFeedItems()]);
      reply.send({ data: { queue, dismissed, provider: describeCriticProvider() } });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.post('/critic-feed/score', async (req, reply) => {
    try {
      const { guid } = guidBody.parse(req.body ?? {});
      const input = criticFeedScore.parse(req.body ?? {});
      const out = await scoreFeedItem(guid, input, actorOf(req));
      reply.code(201).send({ data: { id: out.id }, jobId: out.jobId });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.post('/critic-feed/dismiss', async (req, reply) => {
    try {
      const { guid } = guidBody.parse(req.body ?? {});
      const { note } = criticFeedDismiss.parse(req.body ?? {});
      await dismissFeedItem(guid, note, actorOf(req));
      reply.send({ ok: true });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.post('/critic-feed/restore', async (req, reply) => {
    try {
      const { guid } = guidBody.parse(req.body ?? {});
      await restoreFeedItem(guid, actorOf(req));
      reply.send({ ok: true });
    } catch (err) {
      fail(reply, err);
    }
  });

  // ── story AI text → editorial ───────────────────────────────────────────────
  admin.get<{ Querystring: { filter?: string } }>('/story-summaries', async (req, reply) => {
    try {
      const f = req.query?.filter;
      const filter = f === 'editorial' || f === 'all' ? f : 'ai';
      reply.send({ data: await listStorySummaries(filter) });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.post<{ Params: { id: string } }>('/story-summaries/:id/approve', async (req, reply) => {
    try {
      const id = uuidParam.parse(req.params.id);
      await approveSummary(id, actorOf(req));
      await requestSearchRefresh('summary-approved');
      await enqueueHomepageCompute({ reason: 'summary-approved' });
      reply.send({ ok: true });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.post<{ Params: { id: string } }>('/story-summaries/:id/withdraw', async (req, reply) => {
    try {
      const id = uuidParam.parse(req.params.id);
      await withdrawSummaryApproval(id, actorOf(req));
      await requestSearchRefresh('summary-withdrawn');
      await enqueueHomepageCompute({ reason: 'summary-withdrawn' });
      reply.send({ ok: true });
    } catch (err) {
      fail(reply, err);
    }
  });

  // ── community + reputation knobs (were database-only until S5) ──────────────
  admin.get('/community-settings', async (_req, reply) => {
    try {
      reply.send({ data: { values: await communitySettings(), defaults: COMMUNITY_DEFAULTS } });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.patch('/community-settings', async (req, reply) => {
    try {
      const patch = communitySettingsPatch.parse(req.body ?? {});
      const before = (await communitySettings()) as unknown as Record<string, unknown>;
      const out = await saveSettingsRow(COMMUNITY_SETTINGS_KEY, before, patch, actorOf(req));
      reply.send({ data: await communitySettings(), changed: out.changed });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.get('/reputation-settings', async (_req, reply) => {
    try {
      reply.send({ data: { values: await reputationSettings(), defaults: REPUTATION_DEFAULTS } });
    } catch (err) {
      fail(reply, err);
    }
  });
  admin.patch('/reputation-settings', async (req, reply) => {
    try {
      const patch = reputationSettingsPatch.parse(req.body ?? {});
      const before = (await reputationSettings()) as unknown as Record<string, unknown>;
      const out = await saveSettingsRow(REPUTATION_SETTINGS_KEY, before, patch, actorOf(req));
      // Levels and badges follow the new knobs in the background.
      const jobId = out.changed.length
        ? ((await enqueueReputationRecompute({ reason: 'settings' })) ?? null)
        : null;
      reply.send({ data: await reputationSettings(), changed: out.changed, jobId });
    } catch (err) {
      fail(reply, err);
    }
  });
}
