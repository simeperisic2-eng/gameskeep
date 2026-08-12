#!/usr/bin/env node
/**
 * GamesKeep — B2 (Steam data structure: seam + own-history store + sweep +
 * dated time-series chart) verification.
 *
 * Proves the B2 behaviors on the ACTUAL served output:
 *   2.  readiness surfaces the Steam seam — provider=mock in demo, sweep
 *       DORMANT (armed=false) — and carries no key material
 *   3.  the history store serves ~6 months of ascending, dated, numeric
 *       weekly points (the reused game_player_counts table)
 *   4.  the seeded shape is realistic: launch spike + mid-life content bump
 *       above the settled level (the chart has a form, not a flat line)
 *   5.  chart SSR: one viewBox'd SVG with y-scale labels, ≥4 dated x ticks,
 *       per-point dots + a highlighted latest point — and ZERO iframes
 *   6.  stats row: current + "Peak (recorded)" + week change
 *   7.  honest labels: "Steam has no past-players API, we accumulate our
 *       own" + consoles caveat; the SteamDB link-out is kept
 *   8.  the Steam key NEVER leaks: no STEAM_API_KEY (or key-like value) in
 *       the served game HTML or the readiness JSON
 *   9.  chart palette: amber/neutral only (no green/red in the chart CSS —
 *       those stay reserved for bias/disconnect)
 *
 * Run after `npm run demo:up`: `npm run verify:b2`. Exits non-zero on any
 * failure so it doubles as a gate.
 */
import { readFileSync } from 'node:fs';

const FRONT = `http://localhost:${process.env.FRONTEND_PORT ?? 3000}`;
const BACK = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;
const CSS_PATH = 'apps/frontend/app/(site)/site.css';

const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });
const check = (name, cond, detail = '') => {
  record(name, Boolean(cond), detail);
  return Boolean(cond);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const count = (hay, needle) => hay.split(needle).length - 1;

async function getJson(url) {
  const res = await fetch(url);
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}
async function getText(url) {
  const res = await fetch(url);
  const text = await res.text();
  return { status: res.status, text };
}

async function waitForReady() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const r = await fetch(`${BACK}/health/ready`);
      const j = await r.json();
      if (j.status === 'ready') {
        const f = await fetch(`${FRONT}/`).catch(() => null);
        if (f && f.ok) return true;
      }
    } catch {
      /* not up yet */
    }
    await sleep(2000);
  }
  return false;
}

async function main() {
  if (!check('1. Stack ready (backend + SSR frontend)', await waitForReady())) return print();

  // ── 2. readiness: seam surfaced, sweep dormant, no key material ─────────────
  const ready = await getJson(`${BACK}/health/ready`);
  const steam = ready.json?.steam;
  const readyRaw = JSON.stringify(ready.json ?? {});
  check(
    '2. Readiness surfaces the Steam seam: provider=mock, sweep DORMANT in demo, no key material',
    steam &&
      steam.provider === 'mock' &&
      steam.live === false &&
      steam.sync &&
      steam.sync.armed === false &&
      !readyRaw.includes('STEAM_API_KEY'),
    steam ? `provider=${steam.provider}, armed=${steam.sync?.armed}` : 'no steam block',
  );

  // ── 3. history store: ascending dated numeric weekly points ─────────────────
  const game = (await getJson(`${BACK}/public/game/cyberpunk-2077`)).json?.data;
  const hist = game?.playerCountHistory ?? [];
  const ascending = hist.every(
    (p, i) =>
      i === 0 || new Date(p.capturedAt).getTime() > new Date(hist[i - 1].capturedAt).getTime(),
  );
  const numeric = hist.every((p) => typeof p.current === 'number' && p.current > 0);
  const spanDays =
    hist.length >= 2
      ? (new Date(hist[hist.length - 1].capturedAt) - new Date(hist[0].capturedAt)) / 86_400_000
      : 0;
  check(
    '3. History store serves ~6 months of ascending dated numeric points (reused game_player_counts)',
    hist.length >= 24 && ascending && numeric && spanDays >= 150,
    `${hist.length} points spanning ${Math.round(spanDays)} days`,
  );

  // ── 4. realistic seeded shape (spike + content bump over the settle) ────────
  const vals = hist.map((p) => p.current);
  const settle = vals[vals.length - 1] ?? 1;
  const spike = Math.max(...vals.slice(0, Math.floor(vals.length / 3)));
  const midStart = Math.floor(vals.length / 2);
  const midBump = Math.max(...vals.slice(midStart, vals.length - 3));
  check(
    '4. Seeded shape is realistic: launch spike ≥3× settle + a mid-life content bump ≥1.3× settle',
    spike >= settle * 3 && midBump >= settle * 1.3,
    `spike ${spike?.toLocaleString?.() ?? '?'}, bump ${midBump?.toLocaleString?.() ?? '?'}, settle ${settle?.toLocaleString?.() ?? '?'}`,
  );

  // ── 5-7. chart SSR ──────────────────────────────────────────────────────────
  const html = (await getText(`${FRONT}/games/cyberpunk-2077`)).text;
  const monthRe = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s?\d/g;
  const chartBlock = html.slice(html.indexOf('gk-chart'), html.indexOf('gk-players-foot'));
  check(
    '5. Chart SSR: one viewBox SVG, y-scale labels, ≥4 dated x ticks, dots + highlighted latest, ZERO iframes',
    html.includes('class="gk-chart"') &&
      /viewBox="0 0 \d+ \d+"/.test(html) &&
      count(html, 'gk-chart-ylabel') >= 3 &&
      (chartBlock.match(monthRe) ?? []).length >= 4 &&
      count(html, 'gk-chart-dot') >= 20 &&
      count(html, 'is-latest') >= 1 &&
      count(html, '<iframe') === 0,
    `${count(html, 'gk-chart-dot')} dots, ${(chartBlock.match(monthRe) ?? []).length} dated ticks`,
  );
  check(
    '6. Stats row: current + "Peak (recorded)" + week change',
    html.includes('Playing now') &&
      html.includes('Peak (recorded)') &&
      html.includes('Week change'),
  );
  check(
    '7. Honest labels + SteamDB link-out kept',
    html.includes('no past-players API') &&
      html.includes('we accumulate our own') &&
      /consoles don/.test(html) &&
      html.includes('steamdb.info/app/1091500/charts/'),
  );

  // ── 8. key never leaks ──────────────────────────────────────────────────────
  check(
    '8. STEAM_API_KEY never appears in served HTML or readiness JSON',
    !html.includes('STEAM_API_KEY') && !readyRaw.includes('STEAM_API_KEY'),
  );

  // ── 9. chart palette: amber/neutral only ────────────────────────────────────
  let css = '';
  try {
    css = readFileSync(CSS_PATH, 'utf8');
  } catch {
    /* handled below */
  }
  const b2Block = css.slice(
    css.indexOf('B2: PLAYER-ACTIVITY'),
    css.indexOf('player-activity footer'),
  );
  check(
    '9. Chart palette is amber/neutral only (no green/red — reserved for bias/disconnect)',
    b2Block.length > 100 &&
      b2Block.includes('var(--gk-accent)') &&
      !/#e5594a|#5bd07f|#43b768|#7fd29a/i.test(b2Block),
    `${b2Block.length} chars checked`,
  );

  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write(
    '\nGamesKeep — B2 Steam data structure (seam + history + sweep + chart)\n\n',
  );
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL B2 CHECKS PASSED ✓' : 'SOME B2 CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('b2-check crashed:', err);
  process.exit(1);
});
