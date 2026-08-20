import type { FastifyInstance } from 'fastify';
import { listsConfigInput } from '@gameskeep/shared/validation';
import { listsSettings, setListsSettings } from '../lists/settings';
import { activePromotedGameSlugs, inventory } from '../ads/service';
import { getHomepageData } from '../public/queries';
import { actorOf, sendError } from './http';

/**
 * List / slot configuration admin routes (SPEC I8, Slice 4) — registered inside
 * the session/token-guarded admin scope, before the generic `/:resource` CRUD.
 * The `lists` section falls through to the ADMIN (40) default rank. These edit
 * the homepage rail sizes + manual pins (all in `app_settings.lists`) and expose
 * a leak-proof preview + the slot-placement inventory (ad_slots, from Slice 2).
 * Slot RECORDS are edited via the generic `ad-slots` CRUD; this ties the two
 * "configuration" concerns together in one Control Panel surface.
 */
export async function registerListAdminRoutes(admin: FastifyInstance): Promise<void> {
  // Read the current list config + the promoted-game slugs it would auto-pin.
  admin.get('/lists/config', async (_req, reply) => {
    try {
      const [config, promoted] = await Promise.all([listsSettings(), activePromotedGameSlugs()]);
      reply.send({ data: { config, promotedGameSlugs: promoted } });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Patch the config (only provided fields change) — audited.
  admin.patch('/lists/config', async (req, reply) => {
    try {
      const patch = listsConfigInput.parse(req.body);
      const next = await setListsSettings(patch, actorOf(req));
      reply.send({ data: next });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Preview: exactly what the homepage rails will render with the current config
  // (leak-proof — the same public payload the SSR homepage reads). Lets staff see
  // pins take effect without leaving the panel.
  admin.get('/lists/preview', async (_req, reply) => {
    try {
      const home = await getHomepageData();
      reply.send({
        data: {
          hero: home.hero.map((c) => ({ slug: c.slug, title: c.title })),
          topRated: home.topRated.map((g) => ({ slug: g.slug, name: g.name })),
          controversial: home.controversial.map((g) => ({ slug: g.slug, name: g.name })),
        },
      });
    } catch (err) {
      sendError(reply, err);
    }
  });

  // Slot placement: every ad slot with its page/occupancy (from Slice 2).
  admin.get('/lists/slots', async (_req, reply) => {
    try {
      reply.send({ data: await inventory() });
    } catch (err) {
      sendError(reply, err);
    }
  });
}
