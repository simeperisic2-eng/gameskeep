import type { FastifyInstance } from 'fastify';
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
  getUpcomingData,
} from './queries';
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

      // The upcoming slate (BLUEPRINT 2.4) — status + release date for countdowns.
      pub.get('/upcoming', async (_req, reply) => {
        try {
          reply.send({ data: await getUpcomingData() });
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
