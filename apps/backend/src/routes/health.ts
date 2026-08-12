import type { FastifyInstance } from 'fastify';
import { env } from '../config/env';
import { checkDb } from '../db/health';
import { checkAi } from '../ai/client';
import { readHeartbeat } from '../queue/heartbeat';
import { redis } from '../redis/client';
import { describeDataSource } from '../data-source';
import { describeGameProvider } from '../data-source/games';
import { describeArticleSource } from '../data-source/articles';
import { describeSteamProvider } from '../data-source/steam';
import { readCatalogImportState } from '../catalog/jobs';
import { readArticleIngestState } from '../articles/jobs';
import { readSteamSyncState } from '../steam/jobs';
import { errorMessage, withTimeout } from '../lib/errors';

async function checkRedis(timeoutMs = 3000): Promise<{ ok: boolean; error?: string }> {
  try {
    const pong = await withTimeout(redis.ping(), timeoutMs, 'redis ping');
    return { ok: pong === 'PONG' };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  // Liveness — is the process up? Touches no dependencies, so it is always
  // fast and never fails because Postgres/Redis are slow.
  app.get('/health', async () => ({
    status: 'ok',
    service: 'backend',
    mode: env.APP_MODE,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }));

  // Readiness — can the API reach Postgres, Redis and the AI service?
  // Also surfaces the pgvector extension and the demo heartbeat job.
  app.get('/health/ready', async (_req, reply) => {
    const [database, cache, ai, heartbeat, catalogImport, articleIngest, steamSync] =
      await Promise.all([
        checkDb(),
        checkRedis(),
        checkAi(),
        readHeartbeat(),
        readCatalogImportState(),
        readArticleIngestState(),
        readSteamSyncState(),
      ]);

    const ready = database.ok && cache.ok && ai.ok;

    reply.code(ready ? 200 : 503);
    return {
      status: ready ? 'ready' : 'not-ready',
      service: 'backend',
      mode: env.APP_MODE,
      dataSource: describeDataSource(),
      gameProvider: describeGameProvider(),
      articleSource: describeArticleSource(),
      catalog: catalogImport
        ? {
            lastImportAt: catalogImport.finishedAt,
            totalGames: catalogImport.totalGames,
            imported: catalogImport.imported,
            reason: catalogImport.reason,
          }
        : { note: 'no catalog import recorded yet' },
      articles: articleIngest
        ? {
            lastIngestAt: articleIngest.finishedAt,
            totalArticles: articleIngest.totalArticles,
            totalTopics: articleIngest.totalTopics,
            newArticles: articleIngest.newArticles,
            reason: articleIngest.reason,
          }
        : { note: 'no article ingest recorded yet' },
      // B2: the Steam seam + accumulate-our-own-history sweep. Armed only in
      // production; demo history comes from the seed (Steam has no past-players
      // API — history only ever grows from our own sweeps).
      steam: {
        ...describeSteamProvider(),
        sync: {
          armed: describeSteamProvider().live,
          ...(steamSync
            ? {
                lastSweepAt: steamSync.finishedAt,
                tracked: steamSync.tracked,
                appended: steamSync.appended,
                failures: steamSync.failures,
              }
            : { note: 'no sweep recorded yet (dormant in demo — seeded history)' }),
        },
      },
      dependencies: {
        postgres: {
          ok: database.ok,
          vectorExtension: database.vectorExtension,
          error: database.error,
        },
        redis: cache,
        aiService: ai,
      },
      backgroundJobs: {
        heartbeat: heartbeat
          ? { ok: true, lastRunAt: heartbeat.lastRunAt, count: heartbeat.count }
          : { ok: false, note: 'no heartbeat recorded yet' },
      },
      timestamp: new Date().toISOString(),
    };
  });
}
