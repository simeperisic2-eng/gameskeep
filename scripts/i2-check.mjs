#!/usr/bin/env node
/**
 * GamesKeep — I2 (game data + seed) verification.
 *
 * Exercises the BOOTED stack end-to-end and asserts the SPEC I2 points:
 *   - the broad mock catalog loads via the background import job (reports count)
 *   - the import is idempotent (re-trigger → count unchanged)
 *   - the data-source seam reports Mock in demo (Live only in production)
 *   - auto-resolve by name works against the mock dataset (the path I3 uses),
 *     including the provider auto-create path (a resolvable-but-not-seeded game)
 *   - an unknown reference lands in the unmatched queue and an editor can clear
 *     it (link / retry / dismiss) — all audit-logged
 *   - the Upcoming subset is queryable
 *
 * Run after `docker compose up` (or `npm run demo:up`): `npm run verify:i2`.
 * Exits non-zero on any failure, so it doubles as a verification gate.
 */

const TOKEN = process.env.ADMIN_API_TOKEN ?? 'demo-admin-token';
const BASE = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;
const API = `${BASE}/admin/api`;
const RUN = Date.now();
const CATALOG_MIN = 150;

const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'x-admin-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

async function waitForReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/health/ready`);
      const json = await res.json();
      if (json.status === 'ready') return true;
    } catch {
      /* not up yet */
    }
    await sleep(2000);
  }
  return false;
}

/** Poll catalog status until the background import has loaded the catalog. */
async function waitForCatalog(min) {
  let last = 0;
  for (let i = 0; i < 60; i += 1) {
    const res = await api('GET', '/catalog/status');
    last = res.json?.totalGames ?? 0;
    if (last >= min) return last;
    await sleep(2000);
  }
  return last;
}

function check(name, cond, detail = '') {
  record(name, Boolean(cond), detail);
  return Boolean(cond);
}

async function main() {
  const ready = await waitForReady();
  if (!check('Stack ready (/health/ready)', ready)) return print();

  // 1) seam: Mock provider in demo (Live only in production)
  const status = await api('GET', '/catalog/status');
  check(
    'Data-source seam = Mock in demo (no live calls)',
    status.json?.provider?.provider === 'mock' && status.json?.provider?.live === false,
    `provider=${status.json?.provider?.provider}`,
  );

  // 2) broad catalog loaded by the background import job
  const total = await waitForCatalog(CATALOG_MIN);
  check(
    `Broad catalog loaded (≥ ${CATALOG_MIN})`,
    total >= CATALOG_MIN,
    `${total} games (provider=${status.json?.provider?.provider})`,
  );

  // 3) idempotent re-import: trigger, wait for a fresh run, count unchanged
  const before = await api('GET', '/catalog/status');
  const beforeCount = before.json?.totalGames ?? 0;
  const beforeAt = before.json?.lastImport?.finishedAt ?? '';
  const trigger = await api('POST', '/catalog/import', {});
  check('Trigger re-import (background)', trigger.status === 202, `HTTP ${trigger.status}`);
  let afterCount = beforeCount;
  for (let i = 0; i < 30; i += 1) {
    await sleep(1500);
    const s = await api('GET', '/catalog/status');
    if ((s.json?.lastImport?.finishedAt ?? '') !== beforeAt) {
      afterCount = s.json?.totalGames ?? 0;
      break;
    }
  }
  check(
    'Re-import is idempotent (count unchanged)',
    afterCount === beforeCount && beforeCount > 0,
    `${beforeCount} → ${afterCount}`,
  );

  // 4) auto-resolve by name — existing seeded game (DB hit)
  const matched = await api('POST', '/game-resolve', { name: 'Elden Ring' });
  check(
    'Auto-resolve existing game by name (matched)',
    matched.status === 200 && matched.json?.data?.status === 'matched',
    matched.json?.data?.status,
  );

  // 5) auto-resolve provider auto-create path (resolvable-but-not-seeded game).
  //    Goes through provider → defensive normalization → upsert → audit.
  const created = await api('POST', '/game-resolve', { name: 'The Witcher IV' });
  const createdOk =
    created.status === 200 && ['created', 'matched'].includes(created.json?.data?.status);
  check('Auto-resolve provider auto-create path', createdOk, created.json?.data?.status);
  const witcher4 = await api('GET', '/games');
  check(
    'Auto-created game persisted + normalized',
    (witcher4.json?.data ?? []).some((g) => g.slug === 'the-witcher-iv'),
  );

  // 6) unmatched flow: unknown reference → queue → editor resolves (link)
  const unknownName = `Phantom Title ${RUN}`;
  const queued = await api('POST', '/game-resolve', {
    name: unknownName,
    context: { via: 'i2-check', run: RUN },
  });
  const unmatchedId = queued.json?.data?.unmatchedId;
  check(
    'Unknown reference filed to unmatched queue',
    queued.json?.data?.status === 'queued' && Boolean(unmatchedId),
    queued.json?.data?.status,
  );

  // retry (still unknown → stays queued, attempts bump)
  const retried = await api('POST', `/unmatched-games/${unmatchedId}/retry`, {});
  check('Retry keeps unresolved reference queued', retried.json?.data?.status === 'queued');

  // editor links it to an existing game's Subject
  const games = await api('GET', '/games');
  const cyber = (games.json?.data ?? []).find((g) => g.slug === 'cyberpunk-2077');
  const link = await api('POST', `/unmatched-games/${unmatchedId}/resolve-link`, {
    subjectId: cyber?.subjectId,
  });
  check(
    'Editor resolves queue entry (link to existing game)',
    link.status === 200 && link.json?.data?.status === 'resolved',
    `HTTP ${link.status}`,
  );
  const queueRow = await api('GET', `/unmatched-games/${unmatchedId}`);
  check('Queue entry marked resolved', queueRow.json?.data?.status === 'resolved');

  // resolution is audit-logged
  const audit = await api('GET', `/_audit?entityType=unmatched-games&entityId=${unmatchedId}`);
  check(
    'Unmatched resolution is audit-logged',
    (audit.json?.data ?? []).length > 0,
    `${(audit.json?.data ?? []).length} audit rows`,
  );

  // dismiss path on a second queued reference
  const queued2 = await api('POST', '/game-resolve', { name: `Spam Title ${RUN}` });
  const id2 = queued2.json?.data?.unmatchedId;
  const dismissed = await api('POST', `/unmatched-games/${id2}/dismiss`, { note: 'not a game' });
  check('Editor can dismiss a queue entry', dismissed.json?.data?.status === 'dismissed');

  // 7) Upcoming subset queryable
  const upcoming = await api('GET', '/catalog/upcoming');
  const upRows = upcoming.json?.data ?? [];
  check(
    'Upcoming subset is queryable',
    upRows.length > 0 && upRows.some((g) => g.slug === 'grand-theft-auto-vi'),
    `${upRows.length} upcoming`,
  );

  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write('\nGamesKeep — I2 game-data verification\n\n');
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL I2 CHECKS PASSED ✓' : 'SOME I2 CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('i2-check crashed:', err);
  process.exit(1);
});
