#!/usr/bin/env node
/**
 * GamesKeep — B1 (clickable titles + tag filters) verification.
 *
 * Proves the B1 behaviors on the ACTUAL served output:
 *   2.  the mock feed now carries realistic per-source permalinks — every
 *       aggregated article in the topic payload links to
 *       {source.website}/articles/{title-slug}
 *   3.  NO NESTED ANCHORS anywhere — max <a> depth is 1 across every public
 *       surface (home, discovery, browse, game, upcoming, topic, sources,
 *       source detail) — the restructured cards are valid HTML
 *   4.  homepage: trending rows are real links to their stories (and still
 *       carry the selection classes); feed-card titles link to topics; game
 *       chips on cards link to game pages
 *   5.  homepage latest column: rows are OUTBOUND article links (excerpt+link)
 *   6.  browse tiles: name links to the game, genre chips deep-link into
 *       ?genre= (reusing the A1 filter URLs)
 *   7.  game page: genre → ?genre=, platform → ?platform=, MODE chips stay
 *       plain labels (no mode facet exists — nothing pretends to filter)
 *   8.  topic coverage rows: headline links out to the original + "Read at"
 *       present; upcoming cards: taxonomy chips deep-link
 *   9.  chip destinations actually resolve: a genre chip's URL returns the
 *       filtered catalog with that genre applied
 *  10.  leak-proof + canonical unchanged on the touched pages
 *
 * Run after `npm run demo:up`: `npm run verify:b1`. Exits non-zero on any
 * failure so it doubles as a gate.
 */

const FRONT = `http://localhost:${process.env.FRONTEND_PORT ?? 3000}`;
const BACK = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;

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
        const h = await getJson(`${BACK}/public/homepage`);
        const f = await fetch(`${FRONT}/`).catch(() => null);
        if ((h.json?.data?.hero ?? []).length > 0 && f && f.ok) return true;
      }
    } catch {
      /* not up yet */
    }
    await sleep(2000);
  }
  return false;
}

/**
 * Deepest <a> nesting in served HTML. Literal tag scan — Next's RSC flight
 * payload escapes `<` as < inside its <script> blocks, so only real
 * rendered anchors are counted.
 */
function maxAnchorDepth(html) {
  let depth = 0;
  let max = 0;
  const re = /<a[\s>]|<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[0].startsWith('</')) depth = Math.max(0, depth - 1);
    else {
      depth += 1;
      if (depth > max) max = depth;
    }
  }
  return max;
}

/** All hrefs of anchors whose class list contains `cls`. */
function hrefsOf(html, cls) {
  const out = [];
  const re = new RegExp(`<a\\b[^>]*\\bclass="[^"]*\\b${cls}\\b[^"]*"[^>]*>`, 'g');
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[0].match(/href="([^"]+)"/);
    if (href) out.push(href[1]);
  }
  return out;
}

async function main() {
  if (!check('1. Stack ready (backend + SSR + pipeline)', await waitForReady())) return print();

  const home = await getJson(`${BACK}/public/homepage`);
  const hero = home.json?.data?.hero ?? [];
  const topicSlug = hero[0]?.slug;

  // ── 2. per-source permalinks in the data ────────────────────────────────────
  const topic = (await getJson(`${BACK}/public/topic/${topicSlug}`)).json?.data;
  const aggRows = (topic?.articles ?? []).filter((a) => a.origin === 'aggregated');
  const permalinkRe = /^https:\/\/[^/]+\/articles\/[a-z0-9-]+$/;
  check(
    '2. Every aggregated coverage row carries a per-source permalink ({site}/articles/{slug})',
    aggRows.length > 0 &&
      aggRows.every((a) => typeof a.url === 'string' && permalinkRe.test(a.url)),
    aggRows[0]?.url ?? 'no rows',
  );

  // ── 3. nested-anchor audit across every public surface ──────────────────────
  const surfaces = [
    ['/', 'home'],
    ['/games', 'discovery'],
    ['/games/browse', 'browse'],
    ['/games/cyberpunk-2077', 'game'],
    ['/upcoming', 'upcoming'],
    [`/topics/${topicSlug}`, 'topic'],
    ['/sources', 'sources'],
    ['/sources/ign', 'source-detail'],
  ];
  const pages = {};
  const depths = [];
  for (const [path, label] of surfaces) {
    const html = (await getText(`${FRONT}${path}`)).text;
    pages[label] = html;
    depths.push([label, maxAnchorDepth(html)]);
  }
  check(
    '3. NO nested anchors anywhere (max <a> depth = 1 on all 8 public surfaces)',
    depths.every(([, d]) => d === 1),
    depths.map(([l, d]) => `${l}:${d}`).join(' '),
  );

  // ── 4. homepage links ───────────────────────────────────────────────────────
  const homeHtml = pages.home;
  const trendHrefs = hrefsOf(homeHtml, 'gk-trend-item');
  const titleHrefs = hrefsOf(homeHtml, 'gk-title-link');
  const chipHrefs = hrefsOf(homeHtml, 'gk-chip-link');
  check(
    '4. Homepage: trending rows link to stories; card titles link to topics; game chips link to game pages',
    trendHrefs.length >= 5 &&
      trendHrefs.every((h) => h.startsWith('/topics/')) &&
      titleHrefs.filter((h) => h.startsWith('/topics/')).length >= 3 &&
      chipHrefs.some((h) => h.startsWith('/games/')),
    `${trendHrefs.length} trend links, ${titleHrefs.length} title links, ${chipHrefs.length} chip links`,
  );

  // ── 5. latest column links out ──────────────────────────────────────────────
  const artrowHrefs = hrefsOf(homeHtml, 'gk-artrow');
  check(
    '5. Latest column rows are OUTBOUND article links (excerpt + link posture)',
    artrowHrefs.length >= 5 && artrowHrefs.every((h) => h.startsWith('https://')),
    `${artrowHrefs.length} outbound rows`,
  );

  // ── 6. browse tiles ─────────────────────────────────────────────────────────
  const browseHtml = pages.browse;
  const tileNames = hrefsOf(browseHtml, 'gk-title-link');
  const tileGenres = hrefsOf(browseHtml, 'gk-tile-genre-link');
  check(
    '6. Browse tiles: names link to games, genre chips deep-link into ?genre= (A1 URLs)',
    tileNames.length >= 30 &&
      tileNames.every((h) => h.startsWith('/games/')) &&
      tileGenres.length >= 30 &&
      tileGenres.every((h) => h.startsWith('/games/browse?genre=')),
    `${tileNames.length} names, ${tileGenres.length} genre chips`,
  );

  // ── 7. game page chips ──────────────────────────────────────────────────────
  const gameHtml = pages.game;
  const gameChips = hrefsOf(gameHtml, 'gk-chip-link');
  const hasGenre = gameChips.some((h) => h.startsWith('/games/browse?genre='));
  const hasPlatform = gameChips.some((h) => h.startsWith('/games/browse?platform='));
  // Mode chips must stay PLAIN — "singleplayer" appears as a span chip, never an anchor.
  const modeAsLink = /<a\b[^>]*>[^<]*singleplayer[^<]*<\/a>/i.test(gameHtml);
  const modeAsSpan = /<span\b[^>]*gk-chip[^>]*>singleplayer<\/span>/i.test(gameHtml);
  check(
    '7. Game page: genre → ?genre=, platform → ?platform=, mode chips stay plain labels',
    hasGenre && hasPlatform && !modeAsLink && modeAsSpan,
    `genre ${hasGenre}, platform ${hasPlatform}, mode-linked ${modeAsLink}`,
  );

  // ── 8. topic coverage headlines + upcoming chips ────────────────────────────
  const topicHtml = pages.topic;
  const coverageTitles = hrefsOf(topicHtml, 'gk-title-link').filter((h) =>
    h.startsWith('https://'),
  );
  const upHtml = pages.upcoming;
  // Upcoming enrichment added a genre/platform FILTER bar (also `gk-chip-link`,
  // linking within /upcoming?…); the CARD taxonomy chips still deep-link OUT to
  // the browse catalog. Assert the card chips deep-link (≥3) rather than that
  // EVERY chip does (the filter chips legitimately stay on /upcoming).
  const upChips = hrefsOf(upHtml, 'gk-chip-link');
  const browseChips = upChips.filter((h) => h.startsWith('/games/browse?'));
  check(
    '8. Coverage headlines link OUT to the original (+ "Read at" kept); upcoming taxonomy chips deep-link',
    coverageTitles.length >= 3 && topicHtml.includes('Read at') && browseChips.length >= 3,
    `${coverageTitles.length} outbound headlines, ${browseChips.length}/${upChips.length} browse chips`,
  );

  // ── 9. a chip destination actually resolves to the filtered catalog ─────────
  const sampleGenre = tileGenres[0];
  const filtered = sampleGenre ? await getText(`${FRONT}${sampleGenre}`) : null;
  const genreVal = sampleGenre ? decodeURIComponent(sampleGenre.split('=')[1]) : '';
  check(
    '9. A genre chip URL resolves to the filtered catalog (chip marked active)',
    filtered &&
      filtered.status === 200 &&
      count(filtered.text, 'gk-facetchip is-active') >= 1 &&
      filtered.text.toLowerCase().includes(genreVal.toLowerCase()),
    sampleGenre ?? 'no chip to follow',
  );

  // ── 10. leak-proof + canonical unchanged ────────────────────────────────────
  const topicCanon = topicHtml.match(/<link rel="canonical" href="([^"]+)"/);
  const gameCanon = gameHtml.match(/<link rel="canonical" href="([^"]+)"/);
  check(
    '10. Leak-proof + canonical unchanged on the touched pages',
    count(homeHtml, 'internal_assessment') === 0 &&
      count(topicHtml, 'internal_assessment') === 0 &&
      count(gameHtml, 'internal_assessment') === 0 &&
      topicCanon &&
      topicCanon[1].endsWith(`/topics/${topicSlug}`) &&
      gameCanon &&
      gameCanon[1].endsWith('/games/cyberpunk-2077'),
  );

  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write('\nGamesKeep — B1 clickable titles + tag filters (no nested anchors)\n\n');
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL B1 CHECKS PASSED ✓' : 'SOME B1 CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('b1-check crashed:', err);
  process.exit(1);
});
