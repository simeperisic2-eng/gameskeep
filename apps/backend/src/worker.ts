import { startHeartbeatWorker } from './queue/heartbeat';
import { startCatalogWorker } from './catalog/jobs';
import { startArticlesWorker } from './articles/jobs';
import { startRatingsWorker } from './ratings/jobs';
import { startReputationWorker } from './reputation/jobs';
import { armSteamSync, startSteamWorker } from './steam/jobs';

/**
 * Background-worker process entrypoint. Runs as its own container in compose
 * (same image as the API, different command) to mirror the real architecture:
 * heavy work happens off the request path. Hosts every queue processor —
 * the demo heartbeat (I0), the catalog importer (I2) and the article pipeline
 * (pull → embed → cluster → summarize, I3).
 */
function log(message: string, extra?: unknown): void {
  const time = new Date().toISOString();
  if (extra !== undefined) console.log(`[worker] ${time} ${message}`, extra);
  else console.log(`[worker] ${time} ${message}`);
}

const heartbeat = startHeartbeatWorker();
heartbeat.on('completed', (job, result) => log(`heartbeat ${job.id} completed`, result));
heartbeat.on('failed', (job, err) => log(`heartbeat ${job?.id ?? '?'} failed: ${err.message}`));
heartbeat.on('error', (err) => log(`heartbeat worker error: ${err.message}`));

const catalog = startCatalogWorker();
catalog.on('completed', (job, result) => log(`catalog import ${job.id} completed`, result));
catalog.on('failed', (job, err) => log(`catalog import ${job?.id ?? '?'} failed: ${err.message}`));
catalog.on('error', (err) => log(`catalog worker error: ${err.message}`));

const articles = startArticlesWorker();
articles.on('completed', (job, result) => log(`article ingest ${job.id} completed`, result));
articles.on('failed', (job, err) => log(`article ingest ${job?.id ?? '?'} failed: ${err.message}`));
articles.on('error', (err) => log(`articles worker error: ${err.message}`));

const ratings = startRatingsWorker();
ratings.on('completed', (job, result) => log(`rating recompute ${job.id} completed`, result));
ratings.on('failed', (job, err) =>
  log(`rating recompute ${job?.id ?? '?'} failed: ${err.message}`),
);
ratings.on('error', (err) => log(`ratings worker error: ${err.message}`));

// I6 Slice 5: reputation + level + auto-badge recompute processor.
const reputation = startReputationWorker();
reputation.on('completed', (job, result) =>
  log(`reputation recompute ${job.id} completed`, result),
);
reputation.on('failed', (job, err) =>
  log(`reputation recompute ${job?.id ?? '?'} failed: ${err.message}`),
);
reputation.on('error', (err) => log(`reputation worker error: ${err.message}`));

// B2: Steam sweep processor — registered always, SCHEDULED only in production
// (armSteamSync no-ops in demo; history comes from the seed there).
const steam = startSteamWorker();
steam.on('completed', (job, result) => log(`steam sweep ${job.id} completed`, result));
steam.on('failed', (job, err) => log(`steam sweep ${job?.id ?? '?'} failed: ${err.message}`));
steam.on('error', (err) => log(`steam worker error: ${err.message}`));
void armSteamSync().then((armed) =>
  log(armed ? 'steam sweep armed (production)' : 'steam sweep dormant (demo — seeded history)'),
);

log(
  'worker started — heartbeat + catalog + articles + ratings + reputation + steam processors waiting',
);

const shutdown = async (signal: string): Promise<void> => {
  log(`shutting down (${signal})`);
  await Promise.all([
    heartbeat.close(),
    catalog.close(),
    articles.close(),
    ratings.close(),
    reputation.close(),
    steam.close(),
  ]);
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
