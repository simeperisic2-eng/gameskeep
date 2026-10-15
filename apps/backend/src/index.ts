import { buildServer } from './server';
import { env, isDemo } from './config/env';
import { scheduleHeartbeat } from './queue/heartbeat';
import { armGameStatusSync, enqueueCatalogImport } from './catalog/jobs';
import { syncDerivedGameStatuses } from './catalog/status';
import { enqueueArticleIngest, enqueueReclassify } from './articles/jobs';
import { realignStoredDemoFeedDates } from './articles/demo-dates';
import { enqueueRatingRecompute } from './ratings/jobs';
import { enqueueReputationRecompute } from './reputation/jobs';
import { runMigrations } from './db/migrate';
import { seedDemo } from './db/seed';
import { ensureBuiltinSourceTypes } from './sources/rules';
import { applyDemoSectionDefaults, ensureHomepageSections } from './homepage/sections';
import { ensureTagTaxonomy } from './tags/service';
import { realignDemoTagDates, seedDemoTagActivity } from './tags/demo';
import { enqueueTagSync } from './tags/jobs';
import { armHomepageRefresh, enqueueHomepageCompute } from './homepage/jobs';
import { ensureDemoPlayerHistory } from './steam/demo-history';
import { countUnclassifiedArticles, ensureNewsCategories } from './news/categories';
import { ensureListCategories } from './lists/service';
import { enqueueConsensus } from './lists/jobs';
import { enqueueSearchRebuild } from './search/jobs';
import { seedS4Demo } from './demo/s4-seed';

/** API process entrypoint. */
async function main(): Promise<void> {
  const app = await buildServer();

  // Bring the schema up to date, then (in demo) load the tiny idempotent seed.
  // A broken schema must fail loudly — the API is useless without its data layer.
  try {
    await runMigrations();
    app.log.info('database migrations applied');
    // Built-in rows every mode needs (S2): the Standalone source type's stable
    // role, and the homepage section catalogue (legacy list knobs carried over).
    await ensureBuiltinSourceTypes();
    const created = await ensureHomepageSections();
    if (created.length) app.log.info({ created }, 'homepage sections created');
    // Phase P S3: a fresh install gets the seed tag taxonomy (data editors own).
    const seededTags = await ensureTagTaxonomy();
    if (seededTags) app.log.info({ seededTags }, 'tag taxonomy seeded');
    if (isDemo()) {
      await seedDemo();
      app.log.info('demo seed loaded');
      // Demo defaults on an older volume (S2 review: Trending window 168h), guarded.
      const demoDefaults = await applyDemoSectionDefaults();
      if (demoDefaults.length) app.log.info({ demoDefaults }, 'demo section defaults applied');
    }
  } catch (err) {
    app.log.error({ err }, 'database init (migrate/seed) failed');
    process.exit(1);
  }

  // Phase P S3: imported free-form tags → the taxonomy (or the suggestion queue),
  // the legacy predatory flag → the Pay-to-win issue tag, demo tag activity. All
  // idempotent; a hiccup must not stop the API (the catalog job re-syncs).
  // Import mapping + the legacy Pay-to-win hand-over run in the background tags
  // job (S3b: batched, nothing heavy at boot); the small demo seed stays inline.
  try {
    const jobId = await enqueueTagSync({ reason: 'boot' });
    const demoTags = await seedDemoTagActivity();
    const realigned = await realignDemoTagDates();
    app.log.info({ jobId, demoTags, realigned }, 'tag sync enqueued');
  } catch (err) {
    app.log.error({ err }, 'tag sync failed');
  }

  // Phase P S4: news + list categories (seeded once; editors own them after), demo
  // lists + alternate names, a reclassify only when articles predate S4, then the
  // search index and the list consensus — all as background jobs.
  try {
    await ensureNewsCategories();
    await ensureListCategories();
    // Demo lists + alternate names: again after the catalog import / ingest (a fresh volume).
    const { lists: demoLists, alternateNames } = await seedS4Demo('boot');
    const reclassifyJobId =
      (await countUnclassifiedArticles()) > 0 ? await enqueueReclassify('boot') : null;
    const searchJobId = await enqueueSearchRebuild({ reason: 'boot' });
    const consensusJobId = await enqueueConsensus({ reason: 'boot' });
    app.log.info(
      { demoLists, alternateNames, reclassifyJobId, searchJobId, consensusJobId },
      'S4 categories, lists and search enqueued',
    );
  } catch (err) {
    app.log.error({ err }, 'S4 boot steps failed');
  }

  // Game status derived from release dates (hygiene 3) — at boot and daily. A
  // hiccup here must not stop the API; the daily pass catches up.
  try {
    const derived = await syncDerivedGameStatuses();
    if (derived > 0) app.log.info({ derived }, 'game statuses derived from release dates');
    await armGameStatusSync();
  } catch (err) {
    app.log.error({ err }, 'game status sync failed');
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

    // Demo feed dates relative to boot (hygiene 3): articles already stored from
    // the mock feed move with it, so a reused volume reads as recent too.
    try {
      const moved = await realignStoredDemoFeedDates();
      if (moved) app.log.info(moved, 'demo feed dates realigned to boot');
    } catch (err) {
      app.log.error({ err }, 'demo feed date realignment failed');
    }

    // Demo player history (S2): daily mock samples ending just before boot, so
    // the By-players Δ has data in both windows.
    try {
      const history = await ensureDemoPlayerHistory();
      if (history) app.log.info(history, 'demo player history ready');
    } catch (err) {
      app.log.error({ err }, 'demo player history failed');
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

    // Compute reputation + levels + auto-badges off the request path (I6 Slice
    // 5). Idempotent; users read the pre-computed level/progress/badges.
    try {
      await enqueueReputationRecompute({ reason: 'boot' });
      app.log.info('reputation recompute job enqueued');
    } catch (err) {
      app.log.error({ err }, 'failed to enqueue reputation recompute job');
    }
  }

  // Homepage snapshots (S2): a first compute + the periodic refresh at the
  // admin cadence. Never fatal — the homepage shows "computing" meanwhile.
  try {
    await enqueueHomepageCompute({ reason: 'boot' });
    const minutes = await armHomepageRefresh();
    app.log.info({ minutes }, 'homepage snapshots enqueued + refresh armed');
  } catch (err) {
    app.log.error({ err }, 'failed to enqueue homepage snapshots');
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
