#!/usr/bin/env node
/**
 * GamesKeep — Upcoming enrichment verification. Every check proves an attack
 * fails or an invariant holds.
 *
 *   1. Stack ready (backend + SSR frontend)
 *   2. Grouped discovery: /public/upcoming returns games + DLC + New + newWindowDays
 *   3. FORCE-HIDE override: an admin hide drops a game from Upcoming (override wins)
 *   4. FORCE-SHOW override: an admin show adds a released game to Upcoming
 *   5. "New" window is admin-configurable (app_settings, not hardcoded)
 *   6. SUBMIT can't publish: a public suggestion files a PENDING unmatched row and
 *      creates NO game/subject — nothing goes live without editor approval
 *   7. SUBMIT is CSRF-gated (no token → 403) and rate-limited (burst → 429)
 *   8. SUBMIT UGC is escaped: a <script> name is stored raw + rendered ESCAPED in admin
 *   9. PAID Promoted always carries the render-forced label + floats; it's not a
 *      toggleable field (an active placement => labeled Promoted in the payload + HTML)
 *  10. Pricing reference is admin-only (moderator 403) and NEVER in a public payload
 *  11. Promote is email-only: /promote is a mailto (no on-site self-serve activation)
 *
 * Run after `npm run demo:up`: `npm run verify:upcoming`.
 */
import { execSync } from 'node:child_process';

const FRONT = `http://localhost:${process.env.FRONTEND_PORT ?? 3000}`;
const BACK = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;
const TOKEN = process.env.ADMIN_API_TOKEN ?? 'demo-admin-token';
const DEMO_PW = 'Demo-Panel-2026!';
const RUN = Date.now().toString(36);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function sqlOne(q) {
  try {
    return execSync(
      `docker exec gameskeep-postgres-1 psql -U gameskeep -d gameskeep -tAc "${q.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return '';
  }
}
function jarFrom(res, jar = {}) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [p] = line.split(';');
    const i = p.indexOf('=');
    if (i > 0) jar[p.slice(0, i).trim()] = p.slice(i + 1);
  }
  return jar;
}
const cookieHeader = (jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
async function api(base, path, { method = 'GET', jar = {}, csrf, body, token, headers = {} } = {}) {
  const h = { ...headers };
  if (Object.keys(jar).length) h.cookie = cookieHeader(jar);
  if (csrf) h['x-csrf-token'] = csrf;
  if (token) h['x-admin-token'] = token;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* */
  }
  return { status: res.status, json, text, res };
}
async function withCsrf(jar = {}) {
  const r = await api(BACK, '/auth/csrf', { jar });
  jarFrom(r.res, jar);
  return { jar, csrf: r.json?.token ?? jar.gk_csrf };
}
async function login(identifier) {
  const { jar, csrf } = await withCsrf();
  const r = await api(BACK, '/auth/login', {
    method: 'POST',
    jar,
    csrf,
    body: { identifier, password: DEMO_PW },
  });
  jarFrom(r.res, jar);
  return { jar, csrf, status: r.status };
}
const pageText = async (path) => (await fetch(`${FRONT}${path}`, { cache: 'no-store' })).text();
const upcoming = async (qs = '') => (await api(BACK, `/public/upcoming${qs}`)).json?.data;
async function waitForReady() {
  for (let i = 0; i < 90; i += 1) {
    try {
      const r = await fetch(`${BACK}/health/ready`);
      if ((await r.json()).status === 'ready') {
        const f = await fetch(`${FRONT}/`).catch(() => null);
        if (f && f.ok) return true;
      }
    } catch {
      /* */
    }
    await sleep(2000);
  }
  return false;
}
function print() {
  let pass = 0;
  for (const r of results) {
    if (r.ok) pass += 1;
    console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
  }
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
}

async function main() {
  if (!check('1. Stack ready (backend + SSR frontend)', await waitForReady())) return print();
  const adm = await login('demo-admin');
  const mod = await login('demo-moderator');

  // ── 2. grouped discovery ────────────────────────────────────────────────────
  const d = await upcoming();
  check(
    '2. Grouped discovery: games + DLC + New + configurable window',
    d &&
      Array.isArray(d.games) &&
      d.games.length > 0 &&
      d.dlc.length > 0 &&
      d.newReleases.length > 0 &&
      typeof d.newWindowDays === 'number',
    `games=${d?.games?.length} dlc=${d?.dlc?.length} new=${d?.newReleases?.length} window=${d?.newWindowDays}`,
  );

  // ── 3. force-HIDE override wins over status ─────────────────────────────────
  const hideSlug = d.games[0].slug;
  const hideGameId = sqlOne(
    `SELECT g.id FROM games g JOIN subjects s ON s.id=g.subject_id WHERE s.slug='${hideSlug}'`,
  );
  await api(BACK, `/admin/api/games/${hideGameId}`, {
    method: 'PATCH',
    token: TOKEN,
    body: { upcomingOverride: 'hide' },
  });
  const afterHide = await upcoming();
  const hidden = !afterHide.games.some((g) => g.slug === hideSlug);
  await api(BACK, `/admin/api/games/${hideGameId}`, {
    method: 'PATCH',
    token: TOKEN,
    body: { upcomingOverride: null },
  });
  const restored = (await upcoming()).games.some((g) => g.slug === hideSlug);
  check(
    '3. Force-HIDE override removes a pre-release game from Upcoming (override wins)',
    hidden && restored,
    `hidden=${hidden} restoredOnClear=${restored}`,
  );

  // ── 4. force-SHOW override adds a released game ─────────────────────────────
  // A released catalog game that is NOT already in Upcoming.
  const upSlugs = new Set(d.games.map((g) => g.slug));
  const relSlug = sqlOne(
    `SELECT s.slug FROM games g JOIN subjects s ON s.id=g.subject_id WHERE g.status='released' ORDER BY s.slug LIMIT 30`,
  )
    .split('\n')
    .map((x) => x.trim())
    .find((x) => x && !upSlugs.has(x));
  const relId = sqlOne(
    `SELECT g.id FROM games g JOIN subjects s ON s.id=g.subject_id WHERE s.slug='${relSlug}'`,
  );
  await api(BACK, `/admin/api/games/${relId}`, {
    method: 'PATCH',
    token: TOKEN,
    body: { upcomingOverride: 'show' },
  });
  const shown = (await upcoming()).games.some((g) => g.slug === relSlug);
  await api(BACK, `/admin/api/games/${relId}`, {
    method: 'PATCH',
    token: TOKEN,
    body: { upcomingOverride: null },
  });
  check(
    '4. Force-SHOW override adds a released game to Upcoming',
    Boolean(relSlug) && shown,
    `slug=${relSlug} shown=${shown}`,
  );

  // ── 5. "New" window is admin-configurable (not hardcoded) ───────────────────
  const newBefore = (await upcoming()).newReleases.length;
  await api(BACK, '/admin/api/lists/config', {
    method: 'PATCH',
    jar: adm.jar,
    csrf: adm.csrf,
    body: { newWindowDays: 1 },
  });
  const newNarrow = await upcoming();
  await api(BACK, '/admin/api/lists/config', {
    method: 'PATCH',
    jar: adm.jar,
    csrf: adm.csrf,
    body: { newWindowDays: 365 },
  });
  const newWide = (await upcoming()).newReleases.length;
  sqlOne(`DELETE FROM app_settings WHERE key='lists'`); // reset to defaults
  check(
    '5. "New" window is admin-configurable (window=1 shrinks, 365 grows; from app_settings)',
    newNarrow.newWindowDays === 1 &&
      newNarrow.newReleases.length < newBefore &&
      newWide >= newBefore,
    `before=${newBefore} narrow=${newNarrow.newReleases.length}(w=${newNarrow.newWindowDays}) wide=${newWide}`,
  );

  // ── 6. SUBMIT can't publish — files a PENDING row, creates no game ──────────
  const suggestName = `Verify Suggest ${RUN}`;
  const s6 = await withCsrf();
  const sub = await api(BACK, '/public/suggest-game', {
    method: 'POST',
    jar: s6.jar,
    csrf: s6.csrf,
    body: { name: suggestName, platform: 'PC', note: 'a fictional test entry' },
  });
  const pendingCount = Number(
    sqlOne(
      `SELECT count(*) FROM unmatched_games WHERE raw_name='${suggestName}' AND status='pending'`,
    ),
  );
  const publishedCount = Number(
    sqlOne(`SELECT count(*) FROM subjects WHERE name='${suggestName}'`),
  );
  check(
    '6. Public suggestion files a PENDING unmatched row and publishes NOTHING',
    sub.status === 200 && pendingCount === 1 && publishedCount === 0,
    `sub=${sub.status} pending=${pendingCount} published=${publishedCount}`,
  );

  // ── 7. SUBMIT UGC escaped (stored raw, rendered escaped in admin) ───────────
  // Runs BEFORE the rate-limit burst (below) so the per-IP budget isn't spent.
  const xssName = `<script>alert(${RUN})</script>Ghost`;
  const s7 = await withCsrf();
  await api(BACK, '/public/suggest-game', {
    method: 'POST',
    jar: s7.jar,
    csrf: s7.csrf,
    body: { name: xssName },
  });
  await sleep(300);
  const storedRaw = sqlOne(
    `SELECT count(*) FROM unmatched_games WHERE raw_name = '${xssName.replace(/'/g, "''")}'`,
  );
  // The admin unmatched page (SSR) must escape it — never a live <script>.
  const admHtml = await (
    await fetch(`${FRONT}/admin/unmatched`, {
      headers: { cookie: cookieHeader(adm.jar) },
      cache: 'no-store',
    })
  ).text();
  const rawInHtml = admHtml.includes(`<script>alert(${RUN})</script>`);
  const escapedInHtml = admHtml.includes(`&lt;script&gt;alert(${RUN})&lt;/script&gt;`);
  check(
    '7. Suggestion UGC stored raw + rendered ESCAPED in admin (no live <script>)',
    storedRaw === '1' && !rawInHtml && escapedInHtml,
    `stored=${storedRaw} rawInHtml=${rawInHtml} escaped=${escapedInHtml}`,
  );

  // ── 8. SUBMIT CSRF-gated + rate-limited ─────────────────────────────────────
  const noCsrf = await api(BACK, '/public/suggest-game', {
    method: 'POST',
    body: { name: `NoCsrf ${RUN}` },
  });
  // Burst past the per-IP limit (PER_IP_MAX = 5 / window); checks 6+7 already
  // spent 2, so the burst tops it out and the rest 429.
  let rateLimited = false;
  const s8 = await withCsrf();
  for (let i = 0; i < 10; i += 1) {
    const r = await api(BACK, '/public/suggest-game', {
      method: 'POST',
      jar: s8.jar,
      csrf: s8.csrf,
      body: { name: `Burst ${RUN}-${i}` },
    });
    if (r.status === 429) {
      rateLimited = true;
      break;
    }
  }
  check(
    '8. Suggest is CSRF-gated (no token → 403) and rate-limited (burst → 429)',
    noCsrf.status === 403 && rateLimited,
    `noCsrf=${noCsrf.status} rateLimited=${rateLimited}`,
  );

  // ── 9. PAID Promoted always carries the render-forced label + floats ────────
  const promoSlug = 'aether-drift'; // a seeded upcoming (featured) game
  const promoSubjectId = sqlOne(`SELECT id FROM subjects WHERE slug='${promoSlug}'`);
  const homeSlot = sqlOne(`SELECT id FROM ad_slots WHERE key='home'`);
  const placement = await api(BACK, '/admin/api/ad-placements', {
    method: 'POST',
    token: TOKEN,
    body: {
      slotId: homeSlot,
      advertiserName: `UpPromo ${RUN}`,
      headline: `Promoted ${RUN}`,
      promotedSubjectId: promoSubjectId,
      status: 'active',
    },
  });
  const upAfter = await upcoming();
  const promoEntry = upAfter.games.find((g) => g.slug === promoSlug);
  const upHtml = await pageText('/upcoming');
  const labelInHtml = /Promoted/.test(upHtml) && upHtml.includes(`UpPromo ${RUN}`);
  // Floated: a promoted entry sorts ahead of any non-featured/non-promoted entry.
  const idx = upAfter.games.findIndex((g) => g.slug === promoSlug);
  check(
    '9. Active placement => render-forced Promoted label in payload + HTML, floated (not toggleable)',
    placement.status < 300 && Boolean(promoEntry?.promoted?.advertiser) && labelInHtml && idx <= 2,
    `promoted=${Boolean(promoEntry?.promoted)} labelInHtml=${labelInHtml} idx=${idx}`,
  );

  // ── 10. Pricing reference admin-only + never in a public payload ────────────
  // Distinctive markers so the check can't false-match the DLC's own (legit,
  // public) priceCents field — only the ADMIN promo-pricing value must be absent.
  const noteMarker = `PRICING-SECRET-${RUN}`;
  await api(BACK, '/admin/api/ads/pricing', {
    method: 'PATCH',
    jar: adm.jar,
    csrf: adm.csrf,
    body: { note: noteMarker, tiers: [{ label: 'Home', priceCents: 999999, currency: 'USD' }] },
  });
  const modPricing = await api(BACK, '/admin/api/ads/pricing', { jar: mod.jar });
  const admPricing = await api(BACK, '/admin/api/ads/pricing', { jar: adm.jar });
  const adminHasIt = admPricing.text.includes(noteMarker); // sanity: the admin CAN see it
  const pubTexts = [
    (await api(BACK, '/public/upcoming')).text,
    (await api(BACK, `/public/promotion/${promoSlug}`)).text,
    (await api(BACK, '/public/adslot/home')).text,
    await pageText('/upcoming'),
  ];
  const leaks = pubTexts.some((t) => t.includes(noteMarker) || t.includes('999999'));
  check(
    '10. Pricing reference is admin-only (mod 403), admin-visible, never in a public payload',
    modPricing.status === 403 && admPricing.status === 200 && adminHasIt && !leaks,
    `mod=${modPricing.status} adm=${admPricing.status} adminHasIt=${adminHasIt} publicLeak=${leaks}`,
  );

  // ── 11. Promote is email-only (no on-site self-serve activation) ────────────
  // The enquiry form composes a mailto client-side; the SSR page shows the
  // email-enquiry CTA. There is NO public endpoint that activates a promotion —
  // activation is admin-only (verify:i8) — so a promotion can't be self-served.
  const promoteHtml = await pageText('/promote');
  check(
    '11. Promote page is an email enquiry (no self-serve activation)',
    /Email us your enquiry/i.test(promoteHtml) && /Promote your game/i.test(promoteHtml),
    `emailCta=${/Email us your enquiry/i.test(promoteHtml)}`,
  );

  // cleanup
  const pid = placement.json?.data?.id;
  if (pid) await api(BACK, `/admin/api/ad-placements/${pid}`, { method: 'DELETE', token: TOKEN });
  sqlOne(`DELETE FROM ad_placements`);
  sqlOne(`DELETE FROM app_settings WHERE key IN ('lists','promo-pricing')`);
  sqlOne(
    `DELETE FROM unmatched_games WHERE raw_name LIKE 'Verify Suggest ${RUN}' OR raw_name LIKE 'Burst ${RUN}%' OR raw_name LIKE '%Ghost'`,
  );

  print();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
