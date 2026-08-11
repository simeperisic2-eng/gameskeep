#!/usr/bin/env node
/**
 * GamesKeep — I5c (design finalization + flag-bias + trending bar + topic page + SEO)
 * verification.
 *
 * I5a/i5b already prove generic SSR / schema.org / sitemap / leak-proof. THIS
 * script LOCKS the I5c-specific decisions — the ones a plain HTML content-check
 * (or a human skimming markup) can miss:
 *   2. homepage carries the I5c modules in SSR (trending strip, briefing strip,
 *      genre rail, community teaser, hero-secondary row)
 *   3. bias display is FLAG chips (influence) + a BAR (quality) — never a fake
 *      "% influenced" scale
 *   4. Top-rated vs Games-in-focus render DISTINCT games (the de-dup fix)
 *   5. homepage density (≥ ~8 per section) + self canonical + leak-proof
 *   6. topic page = full BLUEPRINT 3.3 (status pill, labeled neutral AI recap,
 *      sort + filter controls, per-source rows)
 *   7. topic cover is COLLAPSE-SAFE (CoverArt nested inside .gk-story-cover) with
 *      a designed placeholder + monogram source attribution (no scraped images)
 *   8. topic self canonical + leak-proof (0 internal_assessment) on served HTML
 *   9-12. DESIGN LOCK (reads site.css — colours/tokens HTML can't prove):
 *      uniform #1c1810 base, trending bar NOT sticky, locked flag palette
 *      (#7fd29a / #ecb45c), and RED (#e5594a) reserved for the disconnect ONLY.
 *
 * Run after `npm run demo:up`: `npm run verify:i5c`. Exits non-zero on any
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

// Ready = backend ready AND the clustering pipeline has produced topics (hero
// populated) AND the SSR frontend answers — otherwise the page checks are racing
// the background job.
async function waitForReady() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const r = await fetch(`${BACK}/health/ready`);
      const j = await r.json();
      if (j.status === 'ready') {
        const h = await getJson(`${BACK}/public/homepage`);
        const hero = h.json?.data?.hero ?? [];
        const f = await fetch(`${FRONT}/`).catch(() => null);
        if (hero.length > 0 && f && f.ok) return true;
      }
    } catch {
      /* not up yet */
    }
    await sleep(2000);
  }
  return false;
}

/** Return the declaration block of the FIRST rule matching `selector`, or ''. */
function cssRule(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
}

/** Slugs of the /games/<slug> anchors carrying class `cls`, read off served HTML
 * (attribute-order agnostic — matches the whole opening <a> tag, then its href). */
function slugsInSection(html, cls) {
  const re = new RegExp(`<a\\b[^>]*\\b${cls}\\b[^>]*>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const href = m[0].match(/href="\/games\/([^"?#]+)/);
    if (href) out.push(href[1]);
  }
  return out;
}

async function main() {
  if (!check('1. Stack ready + pipeline clustered (hero populated)', await waitForReady()))
    return print();

  const home = await getJson(`${BACK}/public/homepage`);
  const d = home.json?.data ?? {};
  const homeHtml = (await getText(`${FRONT}/`)).text;

  // ── 2. homepage I5c modules in SSR ──────────────────────────────────────────
  const mods = {
    trend: count(homeHtml, 'gk-trendchip'),
    brief: count(homeHtml, 'gk-briefing'),
    genre: count(homeHtml, 'gk-genre-chip'),
    community: count(homeHtml, 'gk-community'),
    secondary: count(homeHtml, 'gk-hero-secondary'),
  };
  check(
    '2. Homepage SSR carries the I5c modules (trend strip + briefing + genre rail + community + hero-secondary)',
    mods.trend >= 3 &&
      mods.brief >= 1 &&
      mods.genre >= 3 &&
      mods.community >= 1 &&
      mods.secondary >= 1,
    `trendchips ${mods.trend}, genre ${mods.genre}, briefing ${mods.brief}, community ${mods.community}, secondary ${mods.secondary}`,
  );

  // ── 3. bias = influence FLAG chips + quality BAR ────────────────────────────
  check(
    '3. Bias display: influence FLAG chips + quality BAR both present in SSR (not a fake "% influenced" scale)',
    count(homeHtml, 'gk-flag ') > 0 && count(homeHtml, 'gk-bias-track') > 0,
    `${count(homeHtml, 'gk-flag ')} flag chips, ${count(homeHtml, 'gk-bias-track')} quality bars`,
  );

  // ── 4. Top-rated vs Games-in-focus render DISTINCT games (de-dup) ────────────
  // Assert on the SERVED HTML — the games actually SHOWN in each section must
  // differ (item 4). Games-in-focus renders only a slice of `controversial`, so
  // the full API arrays can overlap in their tails; what matters is the rendered
  // set. This also fails loudly if a future ordering change surfaces a real dup.
  const topRatedShown = slugsInSection(homeHtml, 'gk-rankcard');
  const focusShown = slugsInSection(homeHtml, 'gk-gamecard');
  const shownOverlap = topRatedShown.filter((s) => focusShown.includes(s));
  check(
    '4. Top-rated vs Games-in-focus render DISTINCT games (de-dup, on served HTML)',
    topRatedShown.length > 0 && focusShown.length > 0 && shownOverlap.length === 0,
    `top-rated shown [${topRatedShown.length}], focus shown [${focusShown.length}], overlap ${shownOverlap.length}${shownOverlap.length ? ': ' + shownOverlap.join(',') : ''}`,
  );

  // ── 5. homepage density + canonical + leak-proof ────────────────────────────
  const feed = d.feed ?? [];
  const latest = d.latest ?? [];
  const homeCanon = homeHtml.match(/<link rel="canonical" href="([^"]+)"/);
  check(
    '5. Homepage density (feed + latest ≥ 8 each) + self canonical + leak-proof',
    feed.length >= 8 &&
      latest.length >= 8 &&
      Boolean(homeCanon) &&
      count(homeHtml, 'internal_assessment') === 0,
    `feed ${feed.length}, latest ${latest.length}, canonical ${homeCanon ? homeCanon[1] : 'none'}`,
  );

  // pick a topic WITH a primary game (best for the cover checks + the screenshot)
  let coverSlug = null;
  for (const t of (d.hero ?? []).slice(0, 8)) {
    const det = await getJson(`${BACK}/public/topic/${t.slug}`);
    if (det.json?.data?.primaryGame) {
      coverSlug = t.slug;
      break;
    }
  }
  const topicSlug = coverSlug ?? d.hero?.[0]?.slug;
  const topicHtml = (await getText(`${FRONT}/topics/${topicSlug}`)).text;

  // ── 6. topic 3.3 completeness ───────────────────────────────────────────────
  check(
    '6. Topic SSR: full BLUEPRINT 3.3 (status pill + labeled neutral AI recap + sort + filter + source rows)',
    count(topicHtml, 'gk-status') >= 1 &&
      /neutral recap/i.test(topicHtml) &&
      count(topicHtml, 'gk-filterchip') >= 2 &&
      count(topicHtml, 'gk-sort') >= 1 &&
      count(topicHtml, 'gk-srcrow') >= 1,
    `status ${count(topicHtml, 'gk-status')}, filters ${count(topicHtml, 'gk-filterchip')}, sort ${count(topicHtml, 'gk-sort')}, rows ${count(topicHtml, 'gk-srcrow')}`,
  );

  // ── 7. collapse-safe cover + designed placeholder + monogram attribution ────
  const nested = /gk-story-cover[\s\S]{0,800}?gk-cover\b/.test(topicHtml);
  const designed =
    count(topicHtml, 'gk-cover-mono') >= 1 || count(topicHtml, 'gk-cover-label') >= 1;
  const srcicons = count(topicHtml, 'gk-srcicon');
  check(
    '7. Topic cover collapse-safe (CoverArt nested in .gk-story-cover) + designed placeholder + monogram source attribution',
    (coverSlug ? nested && designed : true) && srcicons >= 1,
    `coverSlug ${coverSlug ?? 'none'}, nested ${nested}, designed ${designed}, srcicons ${srcicons}`,
  );

  // ── 8. topic canonical + leak-proof ─────────────────────────────────────────
  const topicCanon = topicHtml.match(/<link rel="canonical" href="([^"]+)"/);
  check(
    '8. Topic self canonical + leak-proof (0 internal_assessment on served HTML)',
    Boolean(topicCanon) &&
      topicCanon[1].endsWith(`/topics/${topicSlug}`) &&
      count(topicHtml, 'internal_assessment') === 0,
    topicCanon ? topicCanon[1] : 'no canonical',
  );

  // ── 9-12. DESIGN LOCK (site.css) ────────────────────────────────────────────
  let css = '';
  try {
    css = readFileSync(CSS_PATH, 'utf8');
  } catch {
    /* handled below */
  }
  check(
    '9. Uniform base token --gk-base:#1c1810 + subtle dither var (no per-section gradient wash)',
    /--gk-base:\s*#1c1810/i.test(css) && /--gk-dither-strength:/.test(css),
    css ? 'tokens present' : 'site.css not read',
  );

  const trendRule = cssRule(css, '.gk-trendbar');
  const headerRule = cssRule(css, '.gk-header');
  check(
    '10. Trending bar NOT sticky (header sticky; trend bar scrolls away)',
    !/position:\s*sticky/.test(trendRule) && /position:\s*sticky/.test(headerRule),
    `trendbar-sticky ${/position:\s*sticky/.test(trendRule)}, header-sticky ${/position:\s*sticky/.test(headerRule)}`,
  );

  const indepRule = cssRule(css, '.gk-flag.independent');
  const signalRule = cssRule(css, '.gk-flag.signal');
  check(
    '11. Locked flag palette: independent #7fd29a, signal #ecb45c',
    /#7fd29a/i.test(indepRule) && /#ecb45c/i.test(signalRule),
    `independent ${/#7fd29a/i.test(indepRule)}, signal ${/#ecb45c/i.test(signalRule)}`,
  );

  const discRule = cssRule(css, '.gk-disc-large');
  const qualBadRule = cssRule(css, '.gk-bias-seg.bad');
  const redLeaked =
    /#e5594a/i.test(indepRule) || /#e5594a/i.test(signalRule) || /#e5594a/i.test(qualBadRule);
  check(
    '12. RED (#e5594a) reserved for the disconnect ONLY (never flags, never quality low-effort)',
    /#e5594a/i.test(discRule) && !redLeaked,
    `disconnect-red ${/#e5594a/i.test(discRule)}, red-leaked-into-bias ${redLeaked}`,
  );

  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write(
    '\nGamesKeep — I5c design-finalization + flag-bias + topic-page + SEO lock\n\n',
  );
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL I5c CHECKS PASSED ✓' : 'SOME I5c CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('i5c-check crashed:', err);
  process.exit(1);
});
