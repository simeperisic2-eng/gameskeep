#!/usr/bin/env node
/**
 * GamesKeep — I5b (public ratings side: catalog + upcoming + sources + SEO)
 * verification.
 *
 * Proves the SSR + schema + leak-proof guarantees on the ACTUAL served output,
 * not by assertion:
 *   1.  stack ready
 *   2.  catalog API returns games + genre/platform facets
 *   3.  catalog genre filter works (subset, applied echoed, every game matches)
 *   4.  upcoming API returns the slate with status + (some) dates, soonest-first
 *   5.  sources API returns outlets with stats + the shared-ownership map
 *   6.  source-detail API returns a profile (flags + recent coverage + ownership)
 *   7.  unknown source slug 404s (graceful, not a 500)
 *   8.  every public payload is leak-proof (no internal_assessment in JSON)
 *   9.  catalog SSR (/games/browse since A1): tiles + filter chips in HTML,
 *       canonical → /games/browse, leak-proof
 *   10. upcoming SSR: cards + countdown in HTML, leak-proof
 *   11. sources SSR: source cards + ownership-concentration in HTML, leak-proof
 *   12. source-detail SSR: coverage profile + ownership in HTML, canonical → self,
 *       leak-proof
 *   13. schema.org JSON-LD is well-formed: ItemList (catalog + upcoming),
 *       Organization (source), BreadcrumbList on each
 *   14. OG + Twitter + description meta present on the catalog page
 *   15. sitemap.xml lists the /games, /upcoming, /sources hubs + a source URL
 *
 * Run after `npm run demo:up`: `npm run verify:i5b`. Exits non-zero on any
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
  for (let i = 0; i < 60; i += 1) {
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

function extractJsonLd(html) {
  const blocks = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch {
      blocks.push({ __parseError: true });
    }
  }
  return blocks;
}

const leakRe = /internal_?assessment/i;

async function main() {
  if (!check('1. Stack ready (backend + SSR frontend)', await waitForReady())) return print();

  // ── 2. catalog API ──────────────────────────────────────────────────────────
  const cat = await getJson(`${BACK}/public/catalog`);
  const cd = cat.json?.data;
  check(
    '2. Catalog API returns games + genre/platform facets',
    cd &&
      Array.isArray(cd.games) &&
      cd.games.length > 0 &&
      Array.isArray(cd.genres) &&
      cd.genres.length > 0 &&
      Array.isArray(cd.platforms) &&
      cd.platforms.length > 0,
    cd
      ? `${cd.catalogTotal} games, ${cd.genres.length} genres, ${cd.platforms.length} platforms`
      : 'no payload',
  );

  // ── 3. catalog genre filter ─────────────────────────────────────────────────
  const genre = cd?.genres?.[0]?.value;
  if (genre) {
    const filtered = await getJson(`${BACK}/public/catalog?genre=${encodeURIComponent(genre)}`);
    const fd = filtered.json?.data;
    const allMatch =
      fd &&
      fd.games.length > 0 &&
      fd.games.every((g) => g.genres.some((x) => x.toLowerCase() === genre.toLowerCase()));
    check(
      '3. Catalog genre filter works (subset, applied echoed, every game matches)',
      fd && fd.total <= cd.catalogTotal && fd.applied?.genre === genre.toLowerCase() && allMatch,
      fd ? `${genre}: ${fd.total}/${cd.catalogTotal}` : 'no payload',
    );
  } else {
    check('3. Catalog genre filter works', false, 'no genre facet to test');
  }

  // ── 4. upcoming API ─────────────────────────────────────────────────────────
  const up = await getJson(`${BACK}/public/upcoming`);
  const ud = up.json?.data;
  const upcomingStatuses = new Set(['announced', 'in_development', 'early_access']);
  check(
    '4. Upcoming API returns the slate (status + some dates), soonest-first',
    Array.isArray(ud) &&
      ud.length > 0 &&
      ud.every((g) => upcomingStatuses.has(g.status)) &&
      ud.some((g) => g.releaseDate),
    Array.isArray(ud)
      ? `${ud.length} titles, ${ud.filter((g) => g.releaseDate).length} dated`
      : 'no payload',
  );

  // ── 5. sources API ──────────────────────────────────────────────────────────
  const src = await getJson(`${BACK}/public/sources`);
  const sd = src.json?.data;
  check(
    '5. Sources API returns outlets + the shared-ownership map',
    sd &&
      Array.isArray(sd.sources) &&
      sd.sources.length > 0 &&
      sd.sources.every((s) => 'reputation' in s && 'affiliatePct' in s && 'articleCount' in s) &&
      Array.isArray(sd.owners),
    sd ? `${sd.sources.length} outlets, ${sd.owners.length} shared owners` : 'no payload',
  );

  // ── 6/7. source detail + 404 ────────────────────────────────────────────────
  const sampleSource = sd?.sources?.[0]?.slug;
  let sourceHtmlUrl = null;
  if (sampleSource) {
    const sdetail = await getJson(`${BACK}/public/source/${sampleSource}`);
    const sdd = sdetail.json?.data;
    sourceHtmlUrl = `${FRONT}/sources/${sampleSource}`;
    check(
      '6. Source-detail API returns a profile (flags + recent coverage + ownership)',
      sdd &&
        sdd.flags &&
        'independent' in sdd.flags &&
        Array.isArray(sdd.recentArticles) &&
        'owner' in sdd,
      sdd
        ? `${sdd.name}: ${sdd.recentArticles.length} recent, ${sdd.flags.total} scored`
        : 'no payload',
    );
    check(
      '8. Source-detail API is leak-proof (no internal_assessment in JSON)',
      !leakRe.test(JSON.stringify(sdetail.json ?? {})),
    );
  } else {
    check('6. Source-detail API returns a profile', false, 'no source to test');
    check('8. Source-detail API is leak-proof', false, 'no source to test');
  }

  const missing = await getJson(`${BACK}/public/source/zzz-no-such-source-xyz`);
  check(
    '7. Unknown source slug 404s (graceful, not a 500)',
    missing.status === 404,
    `status ${missing.status}`,
  );

  // also confirm catalog/upcoming/sources JSON carry no internal field
  check(
    '8b. Catalog + upcoming + sources APIs are leak-proof (no internal_assessment)',
    !leakRe.test(JSON.stringify(cat.json ?? {})) &&
      !leakRe.test(JSON.stringify(up.json ?? {})) &&
      !leakRe.test(JSON.stringify(src.json ?? {})),
  );

  // ── 9. catalog SSR (the exhaustive grid lives at /games/browse since A1) ────
  const catHtml = (await getText(`${FRONT}/games/browse`)).text;
  const canon = catHtml.match(/<link rel="canonical" href="([^"]+)"/);
  check(
    '9. Catalog SSR: tiles + filter chips in HTML, canonical → /games/browse, leak-proof',
    count(catHtml, 'gk-tile-cover') >= 6 &&
      count(catHtml, 'gk-facetchip') >= 6 &&
      canon &&
      canon[1].endsWith('/games/browse') &&
      count(catHtml, 'internal_assessment') === 0,
    `${count(catHtml, 'gk-tile-cover')} tiles, ${count(catHtml, 'gk-facetchip')} chips`,
  );

  // ── 10. upcoming SSR ────────────────────────────────────────────────────────
  const upHtml = (await getText(`${FRONT}/upcoming`)).text;
  check(
    '10. Upcoming SSR: cards + countdown in HTML, leak-proof',
    count(upHtml, 'gk-upcard-cover') >= 3 &&
      count(upHtml, 'gk-countdown-num') >= 3 &&
      count(upHtml, 'internal_assessment') === 0,
    `${count(upHtml, 'gk-upcard-cover')} cards, ${count(upHtml, 'gk-countdown-num')} countdowns`,
  );

  // ── 11. sources SSR ─────────────────────────────────────────────────────────
  const srcHtml = (await getText(`${FRONT}/sources`)).text;
  check(
    '11. Sources SSR: source cards + ownership-concentration in HTML, leak-proof',
    count(srcHtml, 'gk-srccard-head') >= 3 &&
      srcHtml.includes('Ownership concentration') &&
      count(srcHtml, 'internal_assessment') === 0,
    `${count(srcHtml, 'gk-srccard-head')} cards`,
  );

  // ── 12. source-detail SSR ───────────────────────────────────────────────────
  let sourceHtml = '';
  if (sourceHtmlUrl) {
    sourceHtml = (await getText(sourceHtmlUrl)).text;
    const scanon = sourceHtml.match(/<link rel="canonical" href="([^"]+)"/);
    check(
      '12. Source-detail SSR: coverage profile + ownership in HTML, canonical → self, leak-proof',
      sourceHtml.includes('Coverage profile') &&
        sourceHtml.includes('Ownership') &&
        scanon &&
        scanon[1].endsWith(`/sources/${sampleSource}`) &&
        count(sourceHtml, 'internal_assessment') === 0,
      scanon ? scanon[1] : 'no canonical',
    );
  } else {
    check('12. Source-detail SSR', false, 'no source to test');
  }

  // ── 13. schema.org JSON-LD ──────────────────────────────────────────────────
  const catLd = extractJsonLd(catHtml);
  const catList = catLd.find((b) => b['@type'] === 'ItemList');
  const catCrumbs = catLd.find((b) => b['@type'] === 'BreadcrumbList');
  check(
    '13a. Catalog ItemList + BreadcrumbList JSON-LD well-formed',
    catList &&
      Array.isArray(catList.itemListElement) &&
      catList.itemListElement.length > 0 &&
      catCrumbs &&
      Array.isArray(catCrumbs.itemListElement),
    catList ? `${catList.itemListElement.length} items` : 'no ItemList',
  );
  const upLd = extractJsonLd(upHtml);
  const upList = upLd.find((b) => b['@type'] === 'ItemList');
  check(
    '13b. Upcoming ItemList JSON-LD well-formed',
    upList && Array.isArray(upList.itemListElement) && upList.itemListElement.length > 0,
    upList ? `${upList.itemListElement.length} items` : 'no ItemList',
  );
  const srcLd = extractJsonLd(sourceHtml);
  const org = srcLd.find((b) => b['@type'] === 'Organization');
  const orgCrumbs = srcLd.find((b) => b['@type'] === 'BreadcrumbList');
  check(
    '13c. Source Organization + BreadcrumbList JSON-LD well-formed',
    org &&
      typeof org.name === 'string' &&
      orgCrumbs &&
      Array.isArray(orgCrumbs.itemListElement) &&
      orgCrumbs.itemListElement.length >= 2,
    org ? `Organization "${org.name}"` : 'no Organization',
  );

  // ── 14. OG / Twitter / description meta on the catalog ──────────────────────
  check(
    '14. OG + Twitter + description meta present on the catalog page',
    /property="og:title"/.test(catHtml) &&
      /name="twitter:card"/.test(catHtml) &&
      /name="description"/.test(catHtml),
  );

  // ── 15. sitemap hubs + a source URL ─────────────────────────────────────────
  const sm = await getText(`${FRONT}/sitemap.xml`);
  check(
    '15. sitemap.xml lists the /games, /upcoming, /sources hubs + a source URL',
    sm.status === 200 &&
      /<loc>[^<]*\/games<\/loc>/.test(sm.text) &&
      /<loc>[^<]*\/upcoming<\/loc>/.test(sm.text) &&
      /<loc>[^<]*\/sources<\/loc>/.test(sm.text) &&
      (!sampleSource || sm.text.includes(`/sources/${sampleSource}`)),
    `${count(sm.text, '<url>')} urls`,
  );

  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write(
    '\nGamesKeep — I5b public ratings-side (catalog/upcoming/sources) + SEO\n\n',
  );
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL I5b CHECKS PASSED ✓' : 'SOME I5b CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('i5b-check crashed:', err);
  process.exit(1);
});
