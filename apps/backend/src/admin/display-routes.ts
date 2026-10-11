import type { FastifyInstance } from 'fastify';
import { displaySettingsInput } from '@gameskeep/shared/validation';
import { displaySettings, setDisplaySettings } from '../display/settings';
import { enqueueArticleIngest } from '../articles/jobs';
import { actorOf, sendError } from './http';

/**
 * Public display switches (Phase P S1) — section `display`, which falls through
 * to the ADMIN (40) default rank: these decide what the whole public site shows
 * (system tuning, like bias weights). Every write is audited per app_settings key.
 * A lexicon change auto-enqueues a re-scan so the new keywords take effect.
 */
export async function registerDisplayAdminRoutes(admin: FastifyInstance): Promise<void> {
  admin.get('/display/config', async (_req, reply) => {
    try {
      reply.send({ data: await displaySettings() });
    } catch (err) {
      sendError(reply, err);
    }
  });

  admin.patch('/display/config', async (req, reply) => {
    try {
      const patch = displaySettingsInput.parse(req.body);
      const next = await setDisplaySettings(patch, actorOf(req));
      const rescanJobId = patch.integrityLexicon
        ? await enqueueArticleIngest({ reason: 'integrity-lexicon' })
        : undefined;
      reply.send({ data: next, rescanJobId: rescanJobId ?? null });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
