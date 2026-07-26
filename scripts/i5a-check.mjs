#!/usr/bin/env node
/**
 * GamesKeep — I5a (public frontend: homepage + topic page + SEO) verification.
 *
 * Proves the SEO + leak-proof guarantees on the ACTUAL served output, not by
 * assertion:
 *   1. stack ready
 *   2. homepage API carries the public flag data (topic + per-article)
 *   3. topic-detail API returns a full story (articles + distribution + flags)
 *   4. topic-detail API is leak-proof (no internal_assessment anywhere in JSON)
 *   5. an unknown slug 404s (route renders notFound, not a 500/shell)
 *   6. homepage SSR: full content in the served HTML (spotlight + flag chips),
 *      leak-proof (0 internal_assessment)
 *   7. topic SSR: full content (title, every source's row, bias flags, AI summary)
 *   8. topic SSR leak-proof (0 internal_assessment) — bias renders next to content
 *   9. canonical tag on the topic page points to itself (duplicate-content guard)
 *  10. OG + Twitter + description meta present on the topic page
 *  11. schema.org JSON-LD is WELL-FORMED and carries the required fields:
 *      NewsArticle (headline/datePublished/publisher), BreadcrumbList
 *      (itemListElement), AggregateRating (ratingValue/ratingCount) where present
 *  12. sitemap.xml is served and lists the homepage + topic URLs
 *  13. robots.txt is served, points at the sitemap, and disallows /admin
 *
 * Run after `npm run demo:up`: `npm run verify:i5a`. Exits non-zero on any
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
        // also wait for the SSR frontend to answer
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

async function main() {
  if (!check('1. Stack ready (backend + SSR frontend)', await waitForReady())) return print();

  // ── 2. homepage API carries the public flag data ────────────────────────────
  const home = await getJson(`${BACK}/public/homepage`);
  const heroList = home.json?.data?.hero ?? [];
  const latestList = home.json?.data?.latest ?? [];
  const heroHasFlags =
    heroList.length > 0 && heroList.every((t) => t.flags && 'independent' in t.flags);
  const latestHasFlags = latestList.length > 0 && latestList.every((a) => Array.isArray(a.flags));
  check(
    '2. Homepage API exposes flag data (topic tally + per-article flags)',
    heroHasFlags && latestHasFlags,
    `${heroList.length} hero, ${latestList.length} latest`,
  );

  const slug = heroList[0]?.slug;
  if (!slug) {
    check('3. Topic-detail API returns a story', false, 'no hero slug to test');
    return print();
  }

  // ── 3/4. topic-detail API ───────────────────────────────────────────────────
  const topic = await getJson(`${BACK}/public/topic/${slug}`);
  const td = topic.json?.data;
  check(
    '3. Topic-detail API returns a full story (articles + distribution + flags)',
    td && Array.isArray(td.articles) && td.articles.length >= 1 && td.distribution && td.flags,
    td ? `${td.articles.length} articles, ${td.sourceCount} sources` : 'no payload',
  );
  check(
    '4. Topic-detail API is leak-proof (no internal_assessment in JSON)',
    !JSON.stringify(topic.json ?? {}).match(/internal_?assessment/i),
  );

  // ── 5. unknown slug 404s ────────────────────────────────────────────────────
  const missing = await getJson(`${BACK}/public/topic/zzz-no-such-topic-xyz`);
  check(
    '5. Unknown topic slug 404s (graceful, not a 500)',
    missing.status === 404,
    `status ${missing.status}`,
  );

  // ── 6. homepage SSR + leak-proof ────────────────────────────────────────────
  const homeHtml = (await getText(`${FRONT}/`)).text;
  check(
    '6a. Homepage SSR has full content (spotlight panels + flag chips in HTML)',
    count(homeHtml, 'gk-spot-panel') >= 3 && count(homeHtml, 'gk-flag ') > 0,
    `${count(homeHtml, 'gk-spot-panel')} panels, ${count(homeHtml, 'gk-flag ')} flag chips`,
  );
  check(
    '6b. Homepage SSR is leak-proof (0 internal_assessment)',
    count(homeHtml, 'internal_assessment') === 0,
  );

  // ── 7/8. topic SSR + leak-proof ─────────────────────────────────────────────
  const topicUrl = `${FRONT}/topics/${slug}`;
  const topicHtml = (await getText(topicUrl)).text;
  const rows = count(topicHtml, 'gk-srcrow');
  check(
    '7. Topic SSR has full content (title + per-source rows + bias flags + AI summary)',
    topicHtml.includes(td.title.slice(0, 24)) &&
      rows >= 1 &&
      count(topicHtml, 'gk-flag ') > 0 &&
      topicHtml.includes('AI summary'),
    `${rows} source rows, ${count(topicHtml, 'gk-flag ')} flag chips`,
  );
  check(
    '8. Topic SSR is leak-proof (0 internal_assessment in served HTML)',
    count(topicHtml, 'internal_assessment') === 0,
  );

  // ── 9. canonical ────────────────────────────────────────────────────────────
  const canonMatch = topicHtml.match(/<link rel="canonical" href="([^"]+)"/);
  check(
    '9. Canonical tag points to the topic itself (duplicate-content guard)',
    canonMatch && canonMatch[1].endsWith(`/topics/${slug}`),
    canonMatch ? canonMatch[1] : 'no canonical',
  );

  // ── 10. OG / Twitter / description meta ─────────────────────────────────────
  check(
    '10. OG + Twitter + description meta present on the topic page',
    /property="og:title"/.test(topicHtml) &&
      /property="og:type" content="article"/.test(topicHtml) &&
      /name="twitter:card"/.test(topicHtml) &&
      /name="description"/.test(topicHtml),
  );

  // ── 11. schema.org JSON-LD validates structurally ───────────────────────────
  const ld = extractJsonLd(topicHtml);
  const news = ld.find((b) => b['@type'] === 'NewsArticle');
  const crumbs = ld.find((b) => b['@type'] === 'BreadcrumbList');
  const game = ld.find((b) => b['@type'] === 'VideoGame');
  const noParseErrors = !ld.some((b) => b.__parseError);
  check(
    '11a. NewsArticle JSON-LD is well-formed with required fields',
    noParseErrors &&
      news &&
      typeof news.headline === 'string' &&
      typeof news.datePublished === 'string' &&
      news.publisher &&
      news.publisher.name === 'GamesKeep',
    news ? `headline="${String(news.headline).slice(0, 36)}…"` : 'no NewsArticle',
  );
  check(
    '11b. BreadcrumbList JSON-LD lists the trail',
    crumbs && Array.isArray(crumbs.itemListElement) && crumbs.itemListElement.length >= 2,
    crumbs ? `${crumbs.itemListElement.length} crumbs` : 'no BreadcrumbList',
  );
  // AggregateRating is conditional ("where ratings appear") — validate IF present.
  if (game) {
    const ar = game.aggregateRating;
    check(
      '11c. AggregateRating (where present) has ratingValue + ratingCount',
      ar && ar['@type'] === 'AggregateRating' && ar.ratingValue && Number(ar.ratingCount) >= 1,
      ar ? `${ar.ratingValue}/10 from ${ar.ratingCount}` : 'malformed',
    );
  } else {
    record(
      '11c. AggregateRating (where present) has ratingValue + ratingCount',
      true,
      'n/a — no rated game on this story',
    );
  }

  // ── 12. sitemap.xml ─────────────────────────────────────────────────────────
  const sm = await getText(`${FRONT}/sitemap.xml`);
  check(
    '12. sitemap.xml served, lists homepage + topic URLs',
    sm.status === 200 &&
      sm.text.includes('<urlset') &&
      sm.text.includes(`/topics/${slug}`) &&
      /<loc>[^<]*\/<\/loc>/.test(sm.text),
    `${count(sm.text, '<url>')} urls`,
  );

  // ── 13. robots.txt ──────────────────────────────────────────────────────────
  const robots = await getText(`${FRONT}/robots.txt`);
  check(
    '13. robots.txt served, points at sitemap, disallows /admin',
    robots.status === 200 &&
      /Sitemap:\s*http/i.test(robots.text) &&
      /Disallow:\s*\/admin/i.test(robots.text),
  );

  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write('\nGamesKeep — I5a public-frontend + SEO verification\n\n');
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL I5a CHECKS PASSED ✓' : 'SOME I5a CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('i5a-check crashed:', err);
  process.exit(1);
});
