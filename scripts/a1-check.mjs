#!/usr/bin/env node
/**
 * GamesKeep — A1 (discovery entry + catalog pagination + landscape covers)
 * verification.
 *
 * Proves the A1 behaviors on the ACTUAL served output:
 *   2.  discovery API returns every section + is leak-proof
 *   3.  catalog API paginates server-side (page slice ≤ perPage, meta consistent,
 *       page 2 differs from page 1, malformed/out-of-range pages clamp — never
 *       a broken page)
 *   4.  pagination composes with filters (filtered total < catalog total, slice
 *       respects perPage, applied echoed)
 *   5.  /games discovery SSR: all four sections + the "Browse all N games" CTA
 *       into /games/browse, canonical → /games, leak-proof
 *   6.  /games/browse SSR page 1: exactly perPage tiles, range line, pagination
 *       nav with real ?page=N anchors, canonical → /games/browse, leak-proof
 *   7.  /games/browse?page=2 SSR: different games than page 1, range line
 *       advances, self canonical (…?page=2 — the crawl path to every game)
 *   8.  filtered browse SSR: re-titled heading + "X of N" count, active chip
 *       marked, filter+page canonical consolidates to /games/browse
 *   9.  every game is reachable by walking pages (last page non-empty,
 *       totalPages × perPage covers the catalog)
 *  10.  sitemap lists BOTH hubs (/games discovery + /games/browse catalog)
 *  11.  homepage cover slots are landscape (16/10 topic-card cover token in CSS,
 *       no fixed min-height square slot left)
 *
 * Run after `npm run demo:up`: `npm run verify:a1`. Exits non-zero on any
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
const leakRe = /internal_?assessment/i;

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

/** Slugs of /games/<slug> tile anchors in served HTML (attribute-order agnostic). */
function tileSlugs(html) {
  const out = [];
  const re = /<a\b[^>]*\bgk-tile\b[^>]*>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[0].match(/href="\/games\/([^"?#]+)"/);
    if (href) out.push(href[1]);
  }
  return out;
}

async function main() {
  if (!check('1. Stack ready (backend + SSR frontend)', await waitForReady())) return print();

  // ── 2. discovery API ────────────────────────────────────────────────────────
  const disco = await getJson(`${BACK}/public/discovery`);
  const dd = disco.json?.data;
  check(
    '2a. Discovery API returns every section (topRated + mostDiscussed + genres + comingSoon + catalogTotal)',
    dd &&
      Array.isArray(dd.topRated) &&
      dd.topRated.length > 0 &&
      Array.isArray(dd.mostDiscussed) &&
      dd.mostDiscussed.length > 0 &&
      dd.mostDiscussed.every((g) => g.articleCount > 0 && g.sourceCount > 0 && g.slug) &&
      Array.isArray(dd.genres) &&
      dd.genres.length > 0 &&
      Array.isArray(dd.comingSoon) &&
      dd.comingSoon.length > 0 &&
      dd.catalogTotal > 0,
    dd
      ? `${dd.topRated.length} top, ${dd.mostDiscussed.length} discussed (max ${dd.mostDiscussed[0]?.articleCount ?? 0} articles), ${dd.genres.length} genres, ${dd.comingSoon.length} soon, ${dd.catalogTotal} total`
      : 'no payload',
  );
  check(
    '2b. Discovery API is leak-proof (no internal_assessment in JSON)',
    !leakRe.test(JSON.stringify(disco.json ?? {})),
  );

  // ── 3. catalog API pagination ───────────────────────────────────────────────
  const p1 = (await getJson(`${BACK}/public/catalog`)).json?.data;
  const p2 = (await getJson(`${BACK}/public/catalog?page=2`)).json?.data;
  const clampHi = (await getJson(`${BACK}/public/catalog?page=9999`)).json?.data;
  const clampBad = (await getJson(`${BACK}/public/catalog?page=banana`)).json?.data;
  const meta =
    p1 &&
    p1.games.length === Math.min(p1.perPage, p1.total) &&
    p1.page === 1 &&
    p1.totalPages === Math.ceil(p1.total / p1.perPage) &&
    p1.total === p1.catalogTotal; // unfiltered: every game counted
  check(
    '3a. Catalog API returns ONE page slice + consistent meta (never the full set)',
    meta && p1.total > p1.perPage,
    p1
      ? `page 1: ${p1.games.length}/${p1.total} games, perPage ${p1.perPage}, ${p1.totalPages} pages`
      : 'no payload',
  );
  check(
    '3b. Page 2 returns the NEXT slice (different games, same meta)',
    p2 &&
      p2.page === 2 &&
      p2.games.length > 0 &&
      p1 &&
      p2.games[0].slug !== p1.games[0].slug &&
      !p2.games.some((g) => p1.games.some((h) => h.slug === g.slug)),
    p2 ? `page 2 starts at ${p2.games[0]?.slug}` : 'no payload',
  );
  check(
    '3c. Out-of-range + malformed pages clamp (never a broken/empty page)',
    clampHi &&
      clampHi.page === clampHi.totalPages &&
      clampHi.games.length > 0 &&
      clampBad &&
      clampBad.page === 1 &&
      clampBad.games.length > 0,
    `page=9999 → ${clampHi?.page}, page=banana → ${clampBad?.page}`,
  );

  // ── 4. pagination composes with filters ─────────────────────────────────────
  const genre = p1?.genres?.[0]?.value;
  const fp = genre
    ? (await getJson(`${BACK}/public/catalog?genre=${encodeURIComponent(genre)}&page=1`)).json?.data
    : null;
  check(
    '4. Filter + pagination compose (filtered subset, slice ≤ perPage, applied echoed)',
    fp &&
      fp.total < fp.catalogTotal &&
      fp.games.length <= fp.perPage &&
      fp.applied.genre === genre.toLowerCase() &&
      fp.totalPages === Math.ceil(fp.total / fp.perPage),
    fp
      ? `${genre}: ${fp.total}/${fp.catalogTotal} over ${fp.totalPages} pages`
      : 'no facet to test',
  );

  // ── 5. /games discovery SSR ─────────────────────────────────────────────────
  const discoHtml = (await getText(`${FRONT}/games`)).text;
  const discoCanon = discoHtml.match(/<link rel="canonical" href="([^"]+)"/);
  // React SSR inserts <!-- --> between text and {expression} children — match
  // across those comment nodes ("Browse all <!-- -->199<!-- --> games").
  const ctaRe = /Browse all(?:\s|<!-- -->)+\d+(?:\s|<!-- -->)+games/;
  check(
    '5a. Discovery SSR: Top rated + Most discussed + genres + Coming soon + "Browse all N games" CTA → /games/browse',
    count(discoHtml, 'Top rated') >= 1 &&
      count(discoHtml, 'Most discussed') >= 1 &&
      count(discoHtml, 'gk-genre-chip') >= 3 &&
      count(discoHtml, 'gk-upcard') >= 1 &&
      ctaRe.test(discoHtml) &&
      count(discoHtml, 'href="/games/browse"') >= 1 &&
      count(discoHtml, 'gk-tile-note') >= 1,
    `${count(discoHtml, 'class="gk-tile"')} tiles, ${count(discoHtml, 'gk-genre-chip')} genre chips, ${count(discoHtml, 'gk-upcard')} upcoming cards`,
  );
  check(
    '5b. Discovery canonical → /games + leak-proof',
    discoCanon && discoCanon[1].endsWith('/games') && count(discoHtml, 'internal_assessment') === 0,
    discoCanon ? discoCanon[1] : 'no canonical',
  );

  // ── 6. /games/browse SSR page 1 ─────────────────────────────────────────────
  const b1Html = (await getText(`${FRONT}/games/browse`)).text;
  const b1Canon = b1Html.match(/<link rel="canonical" href="([^"]+)"/);
  const b1Slugs = tileSlugs(b1Html);
  check(
    '6. Browse SSR page 1: perPage tiles + range line + ?page=N anchors + canonical → /games/browse + leak-proof',
    p1 &&
      b1Slugs.length === p1.perPage &&
      b1Html.includes('Showing') &&
      b1Html.includes(`of <b>${p1.total}</b>`) &&
      count(b1Html, 'href="/games/browse?page=2"') >= 1 &&
      b1Canon &&
      b1Canon[1].endsWith('/games/browse') &&
      count(b1Html, 'internal_assessment') === 0,
    `${b1Slugs.length} tiles, canonical ${b1Canon ? b1Canon[1] : 'none'}`,
  );

  // ── 7. /games/browse?page=2 SSR ─────────────────────────────────────────────
  const b2Html = (await getText(`${FRONT}/games/browse?page=2`)).text;
  const b2Canon = b2Html.match(/<link rel="canonical" href="([^"]+)"/);
  const b2Slugs = tileSlugs(b2Html);
  check(
    '7. Browse SSR page 2: different games, range advances, SELF canonical (crawl path to every game)',
    b2Slugs.length > 0 &&
      !b2Slugs.some((s) => b1Slugs.includes(s)) &&
      p1 &&
      b2Html.includes(`Showing <b>${p1.perPage + 1}</b>`) &&
      b2Canon &&
      b2Canon[1].endsWith('/games/browse?page=2'),
    `${b2Slugs.length} tiles, canonical ${b2Canon ? b2Canon[1] : 'none'}`,
  );

  // ── 8. filtered browse SSR ──────────────────────────────────────────────────
  const fbHtml = genre
    ? (await getText(`${FRONT}/games/browse?genre=${encodeURIComponent(genre)}&page=1`)).text
    : '';
  const fbCanon = fbHtml.match(/<link rel="canonical" href="([^"]+)"/);
  // "of 199" renders as "of <!-- -->199" (React comment between text + expression).
  const ofTotalRe = fp ? new RegExp(`of(?:\\s|<!-- -->)+${fp.catalogTotal}`) : null;
  check(
    '8. Filtered browse SSR: re-titled + re-counted, active chip marked, filter canonical → /games/browse',
    fp &&
      fbHtml.includes(`${genre.length <= 3 ? genre.toUpperCase() : genre} games`.slice(0, 12)) &&
      ofTotalRe.test(fbHtml) &&
      count(fbHtml, 'gk-facetchip is-active') >= 1 &&
      fbCanon &&
      fbCanon[1].endsWith('/games/browse'),
    fbCanon ? `"${genre} games", canonical ${fbCanon[1]}` : 'no facet to test',
  );

  // ── 9. every game reachable by walking pages ────────────────────────────────
  const lastHtml = p1 ? (await getText(`${FRONT}/games/browse?page=${p1.totalPages}`)).text : '';
  const lastSlugs = tileSlugs(lastHtml);
  const expectedLast = p1 ? p1.total - (p1.totalPages - 1) * p1.perPage : 0;
  check(
    '9. Page walk covers the whole catalog (last page holds exactly the remainder)',
    p1 && lastSlugs.length === expectedLast && p1.totalPages * p1.perPage >= p1.catalogTotal,
    `last page ${p1?.totalPages}: ${lastSlugs.length} tiles (expected ${expectedLast})`,
  );

  // ── 10. sitemap lists both hubs ─────────────────────────────────────────────
  const sm = await getText(`${FRONT}/sitemap.xml`);
  check(
    '10. sitemap.xml lists BOTH hubs (/games discovery + /games/browse catalog)',
    sm.status === 200 &&
      /<loc>[^<]*\/games<\/loc>/.test(sm.text) &&
      /<loc>[^<]*\/games\/browse<\/loc>/.test(sm.text),
    `${count(sm.text, '<url>')} urls`,
  );

  // ── 11. homepage cover slots are landscape (design lock, CSS) ───────────────
  let css = '';
  try {
    css = readFileSync(CSS_PATH, 'utf8');
  } catch {
    /* handled below */
  }
  const coverRule = css.match(/\.gk-topiccard-cover\s*\{([^}]*)\}/)?.[1] ?? '';
  check(
    '11. Homepage topic-card cover slot is LANDSCAPE (aspect-ratio 16/10, no fixed square min-height)',
    /aspect-ratio:\s*16\s*\/\s*10/.test(coverRule) && !/min-height/.test(coverRule),
    coverRule ? 'landscape token present' : 'rule not found',
  );

  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write('\nGamesKeep — A1 discovery + catalog pagination + landscape covers\n\n');
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL A1 CHECKS PASSED ✓' : 'SOME A1 CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('a1-check crashed:', err);
  process.exit(1);
});
