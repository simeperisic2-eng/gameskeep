import type { FastifyInstance } from 'fastify';
import { gameSuggestionInput } from '@gameskeep/shared/validation';
import {
  getCatalogData,
  getDiscoveryData,
  getGameDetail,
  getHomepageData,
  getSitemapGames,
  getSitemapSources,
  getSitemapTopics,
  getSourceDetail,
  getSourcesData,
  getTopicDetail,
  getUpcomingPage,
} from './queries';
import { getPublicProfile } from './profile';
import { promotionForGame, slotPublicView } from '../ads/service';
import { unsubscribe } from '../awards/subscribe';
import { allowSuggest, suggestGame } from '../catalog/suggest';
import { csrfOk, CSRF_HEADER } from '../auth/session';
import { sendError } from '../admin/http';

/**
 * PUBLIC read API (SPEC I5a) — the un-authenticated surface the SSR frontend
 * reads to render the homepage and topic pages. Distinct from the token-guarded
 * `/admin/api`: these routes are anonymous-cacheable and serve ONLY pre-computed,
 * leak-proof DTOs (see ./queries — the internal-only bias field is never selected
 * here). Nothing recomputes on the request path.
 */
export async function registerPublicRoutes(app: FastifyInstance): Promise<void> {
  await app.register(
    async (pub) => {
      // Pre-computed payloads are safe to cache briefly at the edge/CDN. The demo
      // SSR fetches with no-store for always-fresh dev; production can lean on this.
      pub.addHook('onSend', async (_req, reply) => {
        if (!reply.getHeader('cache-control')) {
          reply.header('cache-control', 'public, max-age=30, stale-while-revalidate=120');
        }
      });

      // The whole homepage composition (hero + ranking/disconnect rails).
      pub.get('/homepage', async (_req, reply) => {
        try {
          reply.send({ data: await getHomepageData() });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // A single story page (header + bias + every source's article + timeline +
      // related). 404 when the slug is unknown so the SSR route can render notFound.
      pub.get<{ Params: { slug: string } }>('/topic/:slug', async (req, reply) => {
        try {
          const detail = await getTopicDetail(req.params.slug);
          if (!detail) {
            reply.code(404).send({ error: 'not_found' });
            return;
          }
          reply.send({ data: detail });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // A single game hub page (header + three rating layers + disconnect +
      // content flags + our review + related topics/articles/games). 404 on an
      // unknown slug so the SSR route can render notFound.
      pub.get<{ Params: { slug: string } }>('/game/:slug', async (req, reply) => {
        try {
          const detail = await getGameDetail(req.params.slug);
          if (!detail) {
            reply.code(404).send({ error: 'not_found' });
            return;
          }
          reply.send({ data: detail });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // The browsable catalog (BLUEPRINT 2.4; paginated in A1) — filtered/sorted/
      // paged server-side from pre-computed scores; facets travel with the payload.
      pub.get<{ Querystring: { genre?: string; platform?: string; sort?: string; page?: string } }>(
        '/catalog',
        async (req, reply) => {
          try {
            const parsed = Number.parseInt(req.query.page ?? '', 10);
            reply.send({
              data: await getCatalogData({
                genre: req.query.genre ?? null,
                platform: req.query.platform ?? null,
                sort: req.query.sort ?? null,
                page: Number.isFinite(parsed) ? parsed : null,
              }),
            });
          } catch (err) {
            sendError(reply, err);
          }
        },
      );

      // The /games discovery composition (A1) — curated entry into the catalog:
      // top rated + most discussed + genres + coming soon + the browse-all count.
      pub.get('/discovery', async (_req, reply) => {
        try {
          reply.send({ data: await getDiscoveryData() });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // The enriched Upcoming page (Upcoming enrichment; BLUEPRINT 2.4) — grouped
      // (games / DLC & expansions / New) with status+overrides+promoted+filters.
      pub.get<{ Querystring: { genre?: string; platform?: string; indie?: string } }>(
        '/upcoming',
        async (req, reply) => {
          try {
            const { genre, platform, indie } = req.query;
            reply.send({
              data: await getUpcomingPage({
                genre,
                platform,
                indie: indie === '1' || indie === 'true',
              }),
            });
          } catch (err) {
            sendError(reply, err);
          }
        },
      );

      // Public "Suggest a missing game" (Upcoming enrichment, decision 3). A new
      // PUBLIC write surface: CSRF-gated (the scope hook below), zod-validated +
      // escaped UGC, rate-limited, and files a PENDING unmatched-game row — it
      // NEVER publishes. An editor reviews the queue and adds the game.
      pub.post<{ Body: unknown }>('/suggest-game', async (req, reply) => {
        try {
          if (!csrfOk(req)) {
            reply.code(403).send({
              error: 'csrf',
              message: `Missing or mismatched ${CSRF_HEADER} header (fetch /auth/csrf first).`,
            });
            return;
          }
          if (!allowSuggest(req.ip)) {
            reply.code(429).send({
              error: 'rate_limited',
              message: 'Too many suggestions — try again shortly.',
            });
            return;
          }
          const input = gameSuggestionInput.parse(req.body);
          await suggestGame(input, req.ip);
          reply.send({ ok: true }); // generic — never an "is this game known?" oracle
        } catch (err) {
          sendError(reply, err);
        }
      });

      // The sources index (BLUEPRINT 2.5) — ownership + reputation + coverage stats.
      pub.get('/sources', async (_req, reply) => {
        try {
          reply.send({ data: await getSourcesData() });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // One outlet's profile (ownership/conflict + reputation + recent coverage).
      // 404 on an unknown slug so the SSR route can render notFound.
      pub.get<{ Params: { slug: string } }>('/source/:slug', async (req, reply) => {
        try {
          const detail = await getSourceDetail(req.params.slug);
          if (!detail) {
            reply.code(404).send({ error: 'not_found' });
            return;
          }
          reply.send({ data: detail });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // Public user profile (I6 Slice 8) — leak-proof; 404 for unknown/tombstone.
      pub.get<{ Params: { username: string } }>('/user/:username', async (req, reply) => {
        try {
          const profile = await getPublicProfile(req.params.username);
          if (!profile) {
            reply.code(404).send({ error: 'not_found' });
            return;
          }
          reply.send({ data: profile });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // What an on-site AdSlot renders (I8 Slice 2): the live placement's creative
      // (leak-proof — no price/contact/notes) + the slot's unsold fallback. The
      // creative is UGC and is rendered ESCAPED by the frontend.
      pub.get<{ Params: { key: string } }>('/adslot/:key', async (req, reply) => {
        try {
          reply.send({ data: await slotPublicView(req.params.key) });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // An active promotion for a game (by slug) — the game-page Promoted badge.
      pub.get<{ Params: { slug: string } }>('/promotion/:slug', async (req, reply) => {
        try {
          reply.send({ data: await promotionForGame(req.params.slug) });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // Login-free newsletter unsubscribe (SPEC I8, Slice 3). The unguessable
      // per-recipient token IS the authorization capability, so this needs no
      // session/CSRF (the email recipient has neither) — CSRF guards ambient
      // credentials, which don't apply here. Enumeration-safe: the reply is the
      // same generic 200 whether or not the token matched. `no-store` so no
      // intermediary caches a mutation.
      pub.post<{ Body: { token?: unknown } }>('/newsletter/unsubscribe', async (req, reply) => {
        try {
          const token = typeof req.body?.token === 'string' ? req.body.token : '';
          if (token) await unsubscribe(token);
          reply.header('cache-control', 'no-store');
          reply.send({ ok: true });
        } catch (err) {
          sendError(reply, err);
        }
      });

      // Sitemap source — topic + game + source slugs + lastmod for sitemap.xml.
      pub.get('/sitemap', async (_req, reply) => {
        try {
          const [topics, games, sources] = await Promise.all([
            getSitemapTopics(),
            getSitemapGames(),
            getSitemapSources(),
          ]);
          reply.send({ data: { topics, games, sources } });
        } catch (err) {
          sendError(reply, err);
        }
      });
    },
    { prefix: '/public' },
  );
}
