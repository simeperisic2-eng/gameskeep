/**
 * Verify-suite fixture hygiene (Phase P hygiene 3). Every suite removes what it
 * creates, so no test row ever reaches a public page (a "Disconnect Probe" in
 * Games in focus, an "I7 Nominee" topping Top Rated). Fixtures are matched by the
 * suite's OWN run token — never by a broad prefix: the seeded voters gk_voter1–8
 * share "gk_", and real demo rows must never match.
 *
 * Deletion is by SQL on purpose: users / subjects cascade to everything hanging
 * off them (votes, comments, follows, sessions, ratings, nominations), and the
 * audit trail keeps its rows (actor ids go NULL, labels stay — audit is never
 * deleted). Afterwards the derived layers (rating summaries, reputation) are
 * recomputed and AWAITED by job id, so seeded games a fixture voted on read true.
 *
 * Every cleanup write is itself AUDITED (actor `verify:cleanup`, old → new): a
 * restore that changed real state through SQL without a row would leave the
 * trail saying something the data no longer shows (the S1 → hygiene-3 lesson).
 */
import { execFileSync } from 'node:child_process';

const BACK = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;
const TOKEN = process.env.ADMIN_API_TOKEN ?? 'demo-admin-token';
const PG = process.env.GK_PG_CONTAINER ?? 'gameskeep-postgres-1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run SQL through psql's stdin (no shell quoting); returns trimmed stdout. */
export function psql(query) {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      PG,
      'psql',
      '-U',
      'gameskeep',
      '-d',
      'gameskeep',
      '-v',
      'ON_ERROR_STOP=1',
      '-tA',
    ],
    { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

/** A SQL string literal ('' escaped). */
export const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

export const CLEANUP_ACTOR = 'verify:cleanup';

/** The SQL that writes one cleanup audit row (run inside the same transaction). */
export function auditSql({ action = 'update', entityType, entityId, changes = null, summary }) {
  return `INSERT INTO audit_logs (action, entity_type, entity_id, changes, summary, actor_label) VALUES (${lit(action)}, ${lit(entityType)}, ${lit(String(entityId).slice(0, 80))}, ${changes == null ? 'NULL' : `${lit(JSON.stringify(changes))}::jsonb`}, ${lit(summary)}, ${lit(CLEANUP_ACTOR)});`;
}

/** Every pattern must carry the run token (≥ 5 chars) — a guard against a broad sweep. */
function guard(run, patterns) {
  const token = String(run ?? '');
  if (token.length < 5) throw new Error(`fixtures: run token too short ("${token}")`);
  for (const p of patterns) {
    if (!String(p).includes(token)) throw new Error(`fixtures: pattern "${p}" lacks run token`);
  }
}

/** Trigger an admin job and wait for THAT job (by id) to finish. */
export async function runJobAndWait(path, queue, body = {}, timeoutMs = 180_000) {
  const res = await fetch(`${BACK}/admin/api${path}`, {
    method: 'POST',
    headers: { 'x-admin-token': TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  const jobId = json?.jobId ?? json?.data?.jobId ?? null;
  if (!jobId) return { ok: false, state: `no job id (HTTP ${res.status})` };
  return waitForJob(queue, jobId, timeoutMs);
}

/** Poll one job's state until completed / failed (or timeout). */
export async function waitForJob(queue, jobId, timeoutMs = 180_000) {
  const until = Date.now() + timeoutMs;
  let state = 'unknown';
  while (Date.now() < until) {
    const r = await fetch(`${BACK}/admin/api/jobs/${queue}/${encodeURIComponent(jobId)}`, {
      headers: { 'x-admin-token': TOKEN },
    });
    const j = await r.json().catch(() => null);
    state = j?.data?.state ?? `HTTP ${r.status}`;
    if (state === 'completed') return { ok: true, state, jobId };
    if (state === 'failed') return { ok: false, state, jobId };
    await sleep(500);
  }
  return { ok: false, state: `timeout (${state})`, jobId };
}

/**
 * Remove one run's fixtures.
 *  - usernames:   LIKE patterns (each must contain `run`)
 *  - subjectSlugs: LIKE patterns for game/subject slugs (each must contain `run`)
 *  - tombstonesSince: ISO time — also remove `deleted_…` tombstones of accounts
 *    created since then (this run's delete-account probes)
 *  - extra:       further SQL statements (already run-scoped by the caller)
 *  - recompute:   recompute ratings + reputation afterwards (default true)
 */
export async function purgeFixtures({
  run,
  usernames = [],
  subjectSlugs = [],
  tombstonesSince = null,
  extra = [],
  recompute = true,
}) {
  guard(run, [...usernames, ...subjectSlugs]);
  const stmts = [];
  if (usernames.length || tombstonesSince) {
    const conds = usernames.map((p) => `username LIKE ${lit(p)}`);
    if (tombstonesSince) {
      conds.push(`(username LIKE 'deleted\\_%' AND created_at >= ${lit(tombstonesSince)})`);
    }
    const where = conds.join(' OR ');
    const ids = psql(`SELECT coalesce(string_agg(username, ','), '') FROM users WHERE ${where};`);
    if (ids) {
      stmts.push(
        auditSql({
          action: 'delete',
          entityType: 'users',
          entityId: `verify-run-${run}`,
          changes: { deleted: ids.split(',') },
          summary: `verify cleanup removed ${ids.split(',').length} fixture account(s) of run ${run}`,
        }),
      );
    }
    stmts.push(`DELETE FROM users WHERE ${where};`);
  }
  if (subjectSlugs.length) {
    const where = subjectSlugs.map((p) => `slug LIKE ${lit(p)}`).join(' OR ');
    const slugs = psql(`SELECT coalesce(string_agg(slug, ','), '') FROM subjects WHERE ${where};`);
    if (slugs) {
      stmts.push(
        auditSql({
          action: 'delete',
          entityType: 'subjects',
          entityId: `verify-run-${run}`,
          changes: { deleted: slugs.split(',') },
          summary: `verify cleanup removed ${slugs.split(',').length} fixture game(s) of run ${run}`,
        }),
      );
    }
    stmts.push(`DELETE FROM subjects WHERE ${where};`);
  }
  if (extra.length) {
    stmts.push(
      auditSql({
        action: 'delete',
        entityType: 'verify-run',
        entityId: `verify-run-${run}`,
        changes: { statements: extra },
        summary: `verify cleanup removed run ${run}'s other fixtures (${extra.length} statement(s))`,
      }),
      ...extra,
    );
  }
  if (stmts.length) psql(`BEGIN;\n${stmts.join('\n')}\nCOMMIT;`);
  const out = { ok: true, detail: [] };
  if (recompute) {
    const r = await runJobAndWait('/ratings/recompute', 'ratings', {});
    const p = await runJobAndWait('/reputation/recompute', 'reputation', { reason: 'fixtures' });
    out.ok = r.ok && p.ok;
    out.detail.push(`ratings=${r.state}`, `reputation=${p.state}`);
  }
  return out;
}

/** Snapshot app_settings rows (by key) so a suite restores — never deletes — them. */
export function snapshotSettings(keys) {
  const rows = psql(
    `SELECT key || E'\\t' || value::text FROM app_settings WHERE key IN (${keys.map(lit).join(',')});`,
  );
  const map = new Map();
  for (const line of rows.split('\n').filter(Boolean)) {
    const i = line.indexOf('\t');
    map.set(line.slice(0, i), line.slice(i + 1));
  }
  return { keys, map };
}

/**
 * Restore a snapshot: rows that existed get their value back; rows that didn't
 * are removed. Only keys whose value actually changed are written — each with an
 * audit row (old → new).
 */
export function restoreSettings(snap) {
  const current = snapshotSettings(snap.keys).map;
  const stmts = [];
  for (const k of snap.keys) {
    const was = snap.map.get(k) ?? null;
    const now = current.get(k) ?? null;
    if (was === now) continue;
    stmts.push(
      was !== null
        ? `INSERT INTO app_settings (key, value) VALUES (${lit(k)}, ${lit(was)}::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();`
        : `DELETE FROM app_settings WHERE key = ${lit(k)};`,
      auditSql({
        entityType: 'app-settings',
        entityId: k,
        changes: {
          value: {
            from: now === null ? null : JSON.parse(now),
            to: was === null ? null : JSON.parse(was),
          },
        },
        summary: `verify cleanup restored app setting "${k}"`,
      }),
    );
  }
  if (stmts.length) psql(`BEGIN;\n${stmts.join('\n')}\nCOMMIT;`);
}
