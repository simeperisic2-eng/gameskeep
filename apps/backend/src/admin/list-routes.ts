import type { FastifyInstance } from 'fastify';
import { listsConfigInput } from '@gameskeep/shared/validation';
import { listsSettings, setListsSettings } from '../lists/settings';
import { inventory } from '../ads/service';
import { getHomepageData } from '../public/queries';
import { actorOf, sendError } from './http';

/**
 * List / slot configuration admin routes (SPEC I8, Slice 4) — registered inside
 * the session/token-guarded admin scope, before the generic `/:resource` CRUD.
 * The `lists` section falls through to the ADMIN (40) default rank. Since Phase P
 * S2 the config holds only the "New" window — rail sizes + pins live on the
 * homepage sections (/admin/api/homepage); `pinPromotedGames` is removed (a paid
 * item is a labeled placement at an admin-set position, never an unlabeled pin).
 * Plus a leak-proof preview + the slot inventory.
 * Slot RECORDS are edited via the generic `ad-slots` CRUD; this ties the two
 * "configuration" concerns together in one Control Panel surface.
 */
export async function registerListAdminRoutes(admin: FastifyInstance): Promise<void> {
  // Read the current list config.
  admin.get('/lists/config', async (_req, reply) => {
    try {
      reply.send({ data: { config: await listsSettings() } });
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
      const deltaLabel = (d: { kind: string; value?: number } | null): string | null =>
        !d
          ? null
          : d.kind === 'new'
            ? 'New'
            : d.kind === 'none'
              ? '—'
              : `${(d.value ?? 0) > 0 ? '+' : ''}${d.value}%`;
      reply.send({
        data: {
          computedAt: home.computedAt,
          sections: home.sections.map((sec) => ({
            key: sec.key,
            title: sec.title,
            windowHours: sec.windowHours,
            items: sec.items.map((it) => ({
              label: it.topic?.title ?? it.game?.name ?? '?',
              pinned: it.pinned,
              promoted: it.paid
                ? `${it.paid.kind === 'story' ? 'Sponsored' : 'Promoted'} · ${it.paid.advertiser}`
                : null,
              delta: deltaLabel(it.delta),
            })),
          })),
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
