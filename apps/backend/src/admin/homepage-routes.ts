import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  homepageOrderInput,
  homepagePinsInput,
  homepagePromotionCreate,
  homepageSectionPatch,
  homepageSettingsPatch,
} from '@gameskeep/shared/validation';
import { HOMEPAGE_SECTIONS } from '@gameskeep/shared/constants';
import {
  HomepageConfigError,
  createSectionPromotion,
  listSections,
  pinsFor,
  promotionsFor,
  reorderSections,
  sectionByKey,
  setSectionPins,
  updateSection,
} from '../homepage/sections';
import { homepageSettings, setHomepageSettings } from '../homepage/settings';
import { armHomepageRefresh, enqueueHomepageCompute } from '../homepage/jobs';
import { lastSnapshotAt } from '../homepage/snapshots';
import { ruleDimensionsFor } from '../homepage/rules';
import { armSteamSync } from '../steam/jobs';
import { actorOf, sendError } from './http';

/**
 * Homepage sections admin (Phase P S2) — the `homepage` section falls through to
 * the ADMIN (40) default rank. Every write is validated per section kind,
 * audited old → new, and enqueues a snapshot recompute ("saving invalidates the
 * homepage cache") whose job id is returned so a caller can wait for it.
 */
function sendHomepageError(reply: FastifyReply, err: unknown): void {
  if (err instanceof HomepageConfigError) {
    reply
      .code(err.status)
      .send({ error: err.status === 404 ? 'not_found' : 'invalid', message: err.message });
    return;
  }
  sendError(reply, err);
}

async function recompute(reason: string): Promise<string | null> {
  return (await enqueueHomepageCompute({ reason })) ?? null;
}

export async function registerHomepageAdminRoutes(admin: FastifyInstance): Promise<void> {
  // The whole config: sections (with pins + discovery promotions) + switches.
  admin.get('/homepage/config', async (_req, reply) => {
    try {
      const sections = await listSections();
      const detailed = await Promise.all(
        sections.map(async (s) => ({
          ...s,
          ruleDimensions: ruleDimensionsFor(s.items),
          defaultTitle: HOMEPAGE_SECTIONS[s.key].title,
          pins: await pinsFor(s.id),
          promotions: s.kind === 'discovery' ? await promotionsFor(s.id) : [],
        })),
      );
      reply.send({
        data: {
          sections: detailed,
          settings: await homepageSettings(),
          lastComputedAt: await lastSnapshotAt(),
        },
      });
    } catch (err) {
      sendHomepageError(reply, err);
    }
  });

  admin.patch<{ Params: { key: string } }>('/homepage/sections/:key', async (req, reply) => {
    try {
      const patch = homepageSectionPatch.parse(req.body);
      const section = await updateSection(req.params.key, patch, actorOf(req));
      reply.send({ data: section, jobId: await recompute(`section:${req.params.key}`) });
    } catch (err) {
      sendHomepageError(reply, err);
    }
  });

  admin.put('/homepage/order', async (req, reply) => {
    try {
      const { keys } = homepageOrderInput.parse(req.body);
      const sections = await reorderSections(keys, actorOf(req));
      reply.send({ data: sections.map((s) => s.key), jobId: await recompute('order') });
    } catch (err) {
      sendHomepageError(reply, err);
    }
  });

  admin.put<{ Params: { key: string } }>('/homepage/sections/:key/pins', async (req, reply) => {
    try {
      const input = homepagePinsInput.parse(req.body);
      const pins = await setSectionPins(req.params.key, input, actorOf(req));
      reply.send({ data: pins, jobId: await recompute(`pins:${req.params.key}`) });
    } catch (err) {
      sendHomepageError(reply, err);
    }
  });

  admin.patch('/homepage/settings', async (req, reply) => {
    try {
      const patch = homepageSettingsPatch.parse(req.body);
      const { settings, changedKeys } = await setHomepageSettings(patch, actorOf(req));
      // Cadences take effect now: the snapshot refresh + (production) the Steam sweep.
      if (patch.refreshMinutes !== undefined) await armHomepageRefresh();
      if (patch.steamSampleEveryHours !== undefined) await armSteamSync();
      reply.send({ data: settings, changedKeys, jobId: await recompute('settings') });
    } catch (err) {
      sendHomepageError(reply, err);
    }
  });

  // PAID placements for a section — discovery only (service 400 + DB rejection).
  admin.get<{ Params: { key: string } }>(
    '/homepage/sections/:key/promotions',
    async (req, reply) => {
      try {
        const section = await sectionByKey(req.params.key);
        if (!section) {
          reply
            .code(404)
            .send({ error: 'not_found', message: `Unknown section "${req.params.key}".` });
          return;
        }
        reply.send({ data: section.kind === 'discovery' ? await promotionsFor(section.id) : [] });
      } catch (err) {
        sendHomepageError(reply, err);
      }
    },
  );

  admin.post<{ Params: { key: string } }>(
    '/homepage/sections/:key/promotions',
    async (req, reply) => {
      try {
        const input = homepagePromotionCreate.parse(req.body);
        const created = await createSectionPromotion(req.params.key, input, actorOf(req));
        reply
          .code(201)
          .send({ data: created, jobId: await recompute(`promotion:${req.params.key}`) });
      } catch (err) {
        sendHomepageError(reply, err);
      }
    },
  );

  // Recompute now (e.g. after activating a placement) — returns the job id.
  admin.post('/homepage/recompute', async (_req, reply) => {
    try {
      reply.code(202).send({ enqueued: true, jobId: await recompute('manual') });
    } catch (err) {
      sendHomepageError(reply, err);
    }
  });
}
