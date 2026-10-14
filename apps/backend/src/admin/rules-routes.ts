import type { FastifyInstance } from 'fastify';
import { RULE_BOUNDS, RULES_DEFAULTS } from '@gameskeep/shared/constants';
import {
  COPY_DEFS,
  COPY_GROUP_LABELS,
  COPY_GROUPS,
  COPY_TOKENS,
  LOCKED_PAGES,
} from '@gameskeep/shared/copy';
import {
  briefingOverride,
  RulesError,
  rulesSettings,
  setBriefingOverride,
  setRulesSettings,
} from '../rules/settings';
import { copyState, CopyError, invalidatePublicSite, setCopy } from '../copy/settings';
import { enqueueHomepageCompute } from '../homepage/jobs';
import { RANK } from './rbac';
import { getAdminAuth } from './guard';
import { actorOf, sendError } from './http';

/**
 * Phase P S3b — the product rules (Control Panel → Rules & limits), the per-day
 * briefing override, and the copy registry (Control Panel → Copy). Sections
 * `rules` and `copy` fall through to the ADMIN (40) default; the brand + contact
 * identity inside copy is additionally OWNER-only (checked per key).
 */
export async function registerRulesAdminRoutes(admin: FastifyInstance): Promise<void> {
  admin.get('/rules', async (_req, reply) => {
    try {
      reply.send({
        data: { settings: await rulesSettings(), defaults: RULES_DEFAULTS, bounds: RULE_BOUNDS },
      });
    } catch (err) {
      sendError(reply, err);
    }
  });

  admin.patch('/rules', async (req, reply) => {
    try {
      const { settings, changed } = await setRulesSettings(req.body, actorOf(req));
      invalidatePublicSite();
      // Homepage rules shape the stored sections — recompute (background) so they apply now.
      const recomputeJobId = changed.some((c) => c.startsWith('homepage.'))
        ? ((await enqueueHomepageCompute({ reason: 'rules' })) ?? null)
        : null;
      reply.send({ data: settings, changed, recomputeJobId });
    } catch (err) {
      if (err instanceof RulesError) {
        reply.code(400).send({ error: 'validation', message: err.message });
        return;
      }
      sendError(reply, err);
    }
  });

  admin.get('/rules/briefing', async (_req, reply) => {
    try {
      reply.send({ data: await briefingOverride() });
    } catch (err) {
      sendError(reply, err);
    }
  });

  admin.put('/rules/briefing', async (req, reply) => {
    try {
      reply.send({ data: await setBriefingOverride(req.body, actorOf(req)) });
    } catch (err) {
      if (err instanceof RulesError) {
        reply.code(400).send({ error: 'validation', message: err.message });
        return;
      }
      sendError(reply, err);
    }
  });

  admin.get('/copy', async (req, reply) => {
    try {
      const state = await copyState();
      reply.send({
        data: {
          groups: COPY_GROUPS.map((g) => ({ key: g, label: COPY_GROUP_LABELS[g] })),
          defs: COPY_DEFS,
          stored: state.stored,
          values: state.values,
          tokens: COPY_TOKENS,
          lockedPages: LOCKED_PAGES,
          canEditIdentity: (getAdminAuth(req)?.rank ?? 0) >= RANK.owner,
        },
      });
    } catch (err) {
      sendError(reply, err);
    }
  });

  admin.patch('/copy', async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { values?: unknown };
      const { state, changed } = await setCopy(body.values, actorOf(req), {
        isOwner: (getAdminAuth(req)?.rank ?? 0) >= RANK.owner,
      });
      reply.send({ data: { stored: state.stored, values: state.values }, changed });
    } catch (err) {
      if (err instanceof CopyError) {
        reply
          .code(err.status)
          .send({ error: err.status === 403 ? 'forbidden' : 'validation', message: err.message });
        return;
      }
      sendError(reply, err);
    }
  });
}
