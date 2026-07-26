#!/usr/bin/env node
/**
 * GamesKeep — I0 health check.
 *
 * Confirms the whole skeleton is up and the pieces talk to each other:
 *   - backend liveness + the "foundation OK" root message
 *   - Postgres reachable + pgvector extension present
 *   - Redis reachable (from the backend)
 *   - AI service reachable (direct, and from the backend)
 *   - the demo background job (heartbeat) has run
 *   - the frontend server-renders the page
 *
 * Ports are read from the environment (with demo defaults). Exits non-zero if
 * any check fails, so it doubles as a CI/verification gate. Run: `npm run health`.
 */

const BACKEND = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;
const AI = `http://localhost:${process.env.AI_PORT ?? 8000}`;
const FRONTEND = `http://localhost:${process.env.FRONTEND_PORT ?? 3000}`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function retry(fn, { tries = 30, delayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await sleep(delayMs);
    }
  }
  throw lastErr ?? new Error('retry exhausted');
}

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail: detail ?? '' });

async function safe(name, fn) {
  try {
    record(name, true, await fn());
  } catch (err) {
    record(name, false, err?.message ?? String(err));
  }
}

async function main() {
  // Wait for the backend to come up and report all dependencies ready.
  let readiness = null;
  try {
    readiness = await retry(
      async () => {
        const r = await getJson(`${BACKEND}/health/ready`);
        if (r.status !== 'ready') throw new Error('dependencies not ready yet');
        return r;
      },
      { tries: 60, delayMs: 2000 },
    );
  } catch {
    // Best-effort fetch for diagnostics even if it never became "ready".
    try {
      readiness = await getJson(`${BACKEND}/health/ready`);
    } catch {
      // Leave readiness as null; the table below reports the failures.
    }
  }

  await safe('Backend /health (liveness)', async () => {
    const h = await getJson(`${BACKEND}/health`);
    if (h.status !== 'ok') throw new Error(`status=${h.status}`);
    return `mode=${h.mode}`;
  });

  await safe('Backend / (foundation OK)', async () => {
    const body = await getText(`${BACKEND}/`);
    if (!body.includes('foundation OK')) throw new Error('"foundation OK" missing');
    return 'message present';
  });

  const pg = readiness?.dependencies?.postgres;
  record('Postgres (via backend)', !!pg?.ok, pg?.ok ? 'connected' : (pg?.error ?? 'down'));
  record(
    'pgvector extension',
    !!pg?.vectorExtension,
    pg?.vectorExtension ? 'installed' : 'MISSING',
  );

  const rd = readiness?.dependencies?.redis;
  record('Redis (via backend)', !!rd?.ok, rd?.ok ? 'connected' : (rd?.error ?? 'down'));

  const ai = readiness?.dependencies?.aiService;
  record('AI service (via backend)', !!ai?.ok, ai?.ok ? 'reachable' : (ai?.error ?? 'down'));

  await safe('Background job (heartbeat)', async () => {
    const hb = await retry(
      async () => {
        const r = await getJson(`${BACKEND}/health/ready`);
        const h = r.backgroundJobs?.heartbeat;
        if (!h?.ok || !(h.count > 0)) throw new Error('no heartbeat recorded yet');
        return h;
      },
      { tries: 30, delayMs: 2000 },
    );
    return `ran (count=${hb.count})`;
  });

  await safe('AI /health (direct)', async () => {
    const h = await getJson(`${AI}/health`);
    if (h.status !== 'ok') throw new Error(`status=${h.status}`);
    return `service=${h.service}`;
  });

  await safe('AI /ping (echo)', async () => {
    const p = await getJson(`${AI}/ping?msg=gameskeep`);
    if (p.echo !== 'gameskeep') throw new Error('echo mismatch');
    return 'echoes correctly';
  });

  await safe('Frontend SSR', async () => {
    const body = await retry(() => getText(`${FRONTEND}/`), { tries: 30, delayMs: 2000 });
    if (!body.includes('GamesKeep')) throw new Error('"GamesKeep" not in rendered HTML');
    return 'renders GamesKeep';
  });

  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write('\nGamesKeep — I0 health check\n\n');
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL CHECKS PASSED ✓' : 'SOME CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('health-check crashed:', err);
  process.exit(1);
});
