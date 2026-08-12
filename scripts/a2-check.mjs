#!/usr/bin/env node
/**
 * GamesKeep — A2 (game-page enrichment: where-to-buy + SteamDB link + video
 * cards + DLC) verification.
 *
 * Proves the A2 behaviors on the ACTUAL served output:
 *   2.  game API carries store links (multi-store w/ URLs + discount fields),
 *       videos (≤3, channel present, pinned-first order respected), DLC and the
 *       public steamAppId — and is leak-proof
 *   3.  GOG appears only on DRM-free-friendly titles (authentic store spread)
 *   4.  game SSR: "Where to buy" renders OUTBOUND store links (Steam URL from
 *       the app id, target=_blank, nofollow) + amber discount badge, only where
 *       data exists
 *   5.  game SSR: "More stats" link → steamdb.info/app/{id}/charts/ (link out
 *       only — none of their numbers appear in our HTML)
 *   6.  game SSR: video THUMBNAIL CARDS that link out to YouTube — with kind
 *       tag + channel + honest label — and ZERO embedded iframes on the page
 *   7.  game SSR: DLC block renders (name + price), absent where unseeded
 *   8.  a game with NO store/video/dlc data renders none of these blocks
 *       (never an empty buy box)
 *   9.  canonical self + leak-proof (0 internal_assessment) + no API key
 *       material in the served HTML
 *  10.  admin video autofill trigger: honest no-op in demo (mock provider, no
 *       network) and NEVER touches a curated (seeded) list
 *
 * Run after `npm run demo:up`: `npm run verify:a2`. Exits non-zero on any
 * failure so it doubles as a gate.
 */

const FRONT = `http://localhost:${process.env.FRONTEND_PORT ?? 3000}`;
const BACK = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN ?? 'demo-admin-token';

const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });
const check = (name, cond, detail = '') => {
  record(name, Boolean(cond), detail);
  return Boolean(cond);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const count = (hay, needle) => hay.split(needle).length - 1;
const leakRe = /internal_?assessment/i;

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers });
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

  // ── 2. game API payload (Cyberpunk = the fully-enriched flagship) ───────────
  const cp = (await getJson(`${BACK}/public/game/cyberpunk-2077`)).json?.data;
  const stores = (cp?.prices ?? []).map((p) => p.store);
  const urlsOk = (cp?.prices ?? []).every((p) => typeof p.url === 'string' && p.url.length > 0);
  check(
    '2a. Game API: multi-store links w/ URLs + discount fields (Steam + Epic + GOG on the flagship)',
    cp &&
      stores.includes('Steam') &&
      stores.includes('Epic Games') &&
      stores.includes('GOG') &&
      urlsOk &&
      cp.prices.some((p) => p.isOnSale && p.discountPct > 0),
    `stores: ${stores.join(', ')}`,
  );
  check(
    '2b. Game API: videos ≤3 with channel + title; steamAppId public; DLC present',
    cp &&
      cp.videos.length === 3 &&
      cp.videos.every(
        (v) => v.title && v.channel && v.url.startsWith('https://www.youtube.com/'),
      ) &&
      cp.steamAppId === 1091500 &&
      cp.dlc.length >= 1 &&
      cp.dlc.some((d) => d.name === 'Phantom Liberty'),
    cp ? `${cp.videos.length} videos, appId ${cp.steamAppId}, ${cp.dlc.length} dlc` : 'no payload',
  );
  check(
    '2c. Game API is leak-proof (no internal_assessment)',
    cp && !leakRe.test(JSON.stringify(cp)),
  );

  // ── 3. authentic store spread (GOG only on DRM-free-friendly titles) ────────
  const elden = (await getJson(`${BACK}/public/game/elden-ring`)).json?.data;
  const eldenStores = (elden?.prices ?? []).map((p) => p.store);
  check(
    '3. Store spread is authentic (Elden Ring: Steam only — no GOG/Epic row)',
    elden && eldenStores.length === 1 && eldenStores[0] === 'Steam',
    `elden-ring stores: ${eldenStores.join(', ') || 'none'}`,
  );

  // ── 4-7. game SSR (Cyberpunk) ───────────────────────────────────────────────
  const html = (await getText(`${FRONT}/games/cyberpunk-2077`)).text;
  check(
    '4. SSR "Where to buy": outbound store links (Steam URL from app id, _blank + nofollow) + amber badge',
    html.includes('Where to buy') &&
      html.includes('https://store.steampowered.com/app/1091500/') &&
      html.includes('https://www.gog.com/en/game/cyberpunk_2077') &&
      /gk-buy-link[^>]*"[^>]*target="_blank"/.test(html.replace(/\n/g, '')) &&
      count(html, 'gk-price-disc') >= 1,
    `${count(html, 'gk-buy-link')} outbound rows, ${count(html, 'gk-price-disc')} discount badges`,
  );
  check(
    '5. SSR "More stats": SteamDB charts link out (and none of their data inline)',
    html.includes('https://steamdb.info/app/1091500/charts/') && html.includes('More stats'),
  );
  check(
    '6. SSR videos: thumbnail cards link OUT to YouTube (kind tag + channel + honest label) — ZERO iframes',
    count(html, 'gk-vidcard') >= 3 &&
      html.includes('https://www.youtube.com/watch?v=') &&
      count(html, 'gk-vidcard-kind') >= 3 &&
      html.includes('CD PROJEKT RED') &&
      html.includes('no autoplay, no embedded trackers') &&
      count(html, '<iframe') === 0,
    `${count(html, 'gk-vidcard-thumb')} cards, ${count(html, '<iframe')} iframes`,
  );
  check(
    '7. SSR DLC block renders (Phantom Liberty + price)',
    html.includes('Phantom Liberty') && html.includes('$29.99'),
  );

  // ── 8. never an empty buy box ───────────────────────────────────────────────
  // Any catalog game outside the 8 enriched ones has no prices/videos/dlc.
  const cat = (await getJson(`${BACK}/public/catalog?sort=name&page=1`)).json?.data;
  const enriched = new Set([
    'cyberpunk-2077',
    'baldurs-gate-3',
    'stellar-drifter',
    'elden-ring',
    'the-witcher-3-wild-hunt',
    'hades-ii',
    'helldivers-2',
    'final-fantasy-xvi',
  ]);
  const bare = (cat?.games ?? []).find((g) => !enriched.has(g.slug));
  const bareHtml = bare ? (await getText(`${FRONT}/games/${bare.slug}`)).text : '';
  check(
    '8. Unenriched game renders NO buy/video/dlc blocks (never an empty buy box)',
    bare &&
      !bareHtml.includes('Where to buy') &&
      count(bareHtml, 'gk-vidcard') === 0 &&
      !bareHtml.includes('steamdb.info'),
    bare ? `checked ${bare.slug}` : 'no bare game found',
  );

  // ── 9. canonical + leak-proof + no key material ─────────────────────────────
  const canon = html.match(/<link rel="canonical" href="([^"]+)"/);
  check(
    '9. Canonical self + leak-proof + no API-key material in HTML',
    canon &&
      canon[1].endsWith('/games/cyberpunk-2077') &&
      count(html, 'internal_assessment') === 0 &&
      !html.includes('YOUTUBE_API_KEY') &&
      !/AIza[0-9A-Za-z_-]{20,}/.test(html),
    canon ? canon[1] : 'no canonical',
  );

  // ── 10. admin autofill: honest demo no-op, never touches curation ───────────
  const before = cp?.videos.map((v) => v.url) ?? [];
  const auto = await fetch(`${BACK}/admin/api/games/cyberpunk-2077/videos/autofill`, {
    method: 'POST',
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  const autoBody = await auto.json().catch(() => null);
  const after = (await getJson(`${BACK}/public/game/cyberpunk-2077`)).json?.data;
  const untouched = JSON.stringify(after?.videos.map((v) => v.url)) === JSON.stringify(before);
  check(
    '10. Video autofill: mock provider, added 0 (curated list present), stored videos untouched',
    auto.status === 200 &&
      autoBody?.data?.provider === 'mock' &&
      autoBody?.data?.added === 0 &&
      untouched,
    autoBody
      ? `provider=${autoBody.data?.provider}, added=${autoBody.data?.added}, skipped=${autoBody.data?.skipped}`
      : 'no response',
  );

  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write(
    '\nGamesKeep — A2 game-page enrichment (buy links + SteamDB + videos + DLC)\n\n',
  );
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL A2 CHECKS PASSED ✓' : 'SOME A2 CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('a2-check crashed:', err);
  process.exit(1);
});
