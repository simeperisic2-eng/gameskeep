import { buildServer } from './server';
import { env, isDemo } from './config/env';
import { scheduleHeartbeat } from './queue/heartbeat';
import { enqueueCatalogImport } from './catalog/jobs';
import { enqueueArticleIngest } from './articles/jobs';
import { enqueueRatingRecompute } from './ratings/jobs';
import { runMigrations } from './db/migrate';
import { seedDemo } from './db/seed';

/** API process entrypoint. */
async function main(): Promise<void> {
  const app = await buildServer();

  // Bring the schema up to date, then (in demo) load the tiny idempotent seed.
  // A broken schema must fail loudly — the API is useless without its data layer.
  try {
    await runMigrations();
    app.log.info('database migrations applied');
    if (isDemo()) {
      await seedDemo();
      app.log.info('demo seed loaded');
    }
  } catch (err) {
    app.log.error({ err }, 'database init (migrate/seed) failed');
    process.exit(1);
  }

  // Register the demo background job. Don't crash the API if Redis isn't up
  // yet — log it; the readiness endpoint will report the real state.
  try {
    await scheduleHeartbeat();
    app.log.info('heartbeat job scheduled');
  } catch (err) {
    app.log.error({ err }, 'failed to schedule heartbeat job');
  }

  // Load the broad game catalog OFF the request path (I2). The worker runs the
  // idempotent importer; `skipIfPopulated` makes reboots cheap. Never fatal —
  // the admin can re-trigger it, and readiness surfaces the last result.
  if (isDemo()) {
    try {
      await enqueueCatalogImport({ skipIfPopulated: true, reason: 'boot' });
      app.log.info('catalog import job enqueued');
    } catch (err) {
      app.log.error({ err }, 'failed to enqueue catalog import job');
    }

    // Run the article pipeline (pull → embed → cluster → summarize) off the
    // request path too (I3). `skipIfPopulated` makes reboots cheap; the worker
    // owns the heavy work and readiness surfaces the last ingest.
    try {
      await enqueueArticleIngest({ skipIfPopulated: true, reason: 'boot' });
      app.log.info('article ingest job enqueued');
    } catch (err) {
      app.log.error({ err }, 'failed to enqueue article ingest job');
    }

    // Compute the rating summaries (three layers + disconnect + community
    // weighting) off the request path too (I4b). Idempotent; readiness/admin
    // surface the last recompute.
    try {
      await enqueueRatingRecompute({ reason: 'boot' });
      app.log.info('rating recompute job enqueued');
    } catch (err) {
      app.log.error({ err }, 'failed to enqueue rating recompute job');
    }
  }

  try {
    await app.listen({ host: env.BACKEND_HOST, port: env.BACKEND_PORT });
  } catch (err) {
    app.log.error({ err }, 'failed to start server');
    process.exit(1);
  }

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

void main();
