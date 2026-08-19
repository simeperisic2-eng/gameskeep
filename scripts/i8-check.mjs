#!/usr/bin/env node
/**
 * GamesKeep — I8 (Control Panel + Monetization + Newsletter) verification.
 * Slice 1: the Control Panel is now behind STAFF-SESSION RBAC — the blanket
 * browser admin-token proxy is retired. Every check proves an attack fails.
 *
 *  Slice 1 — Control Panel shell + Dashboard (session RBAC)
 *   2.  BLANKET-ACCESS FIX: anon → the FRONTEND /admin/api/* BFF is 401, NOT a
 *       token-proxied 200 (the old blanket browser access is gone)
 *   3.  anon → backend /admin/api/dashboard → 401
 *   4.  a signed-in NON-STAFF (registered) user → dashboard → 403
 *   5.  moderator (30): dashboard 200; but users/roles (owner) 403 and games
 *       (admin) 403 — the panel is RBAC-filtered, not all-or-nothing
 *   6.  admin (40): dashboard + games 200; but users (owner) 403
 *   7.  owner (50): users + roles 200
 *   8.  the Control Panel BFF forwards the SESSION (a logged-in admin reaches the
 *       dashboard THROUGH the frontend BFF — session, not token)
 *   9.  session mutations require CSRF (admin create WITHOUT the header → 403,
 *       WITH it → ok) — the retired token path skipped CSRF; the session path can't
 *  10.  the dashboard is aggregate/anonymous — no email / hash / per-user rows
 *
 *  Slice 2 — ad / promotion management (no payment gateway)
 *  11.  the ads admin section is RBAC-gated (moderator 403, admin 200)
 *  12.  placement creative is UGC — stored raw, rendered ESCAPED on the public
 *       page; and activation is admins-only (moderator 403, admin 200)
 *  13.  an ACTIVE placement always carries the Promoted label (transparency)
 *  14.  the public ad slot is leak-proof (creative only — no price/contact/notes)
 *  15.  promoted-game badge: the promotion resolves + the game page shows Promoted
 *
 * Run after `npm run demo:up`: `npm run verify:i8`.
 */
import { execSync } from 'node:child_process';

const FRONT = `http://localhost:${process.env.FRONTEND_PORT ?? 3000}`;
const BACK = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;
const RUN = Date.now().toString(36);
const DEMO_PW = 'Demo-Panel-2026!';

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
async function api(base, path, { method = 'GET', jar = {}, csrf, body, headers = {} } = {}) {
  const h = { ...headers };
  if (Object.keys(jar).length) h.cookie = cookieHeader(jar);
  if (csrf) h['x-csrf-token'] = csrf;
  if (body !== undefined) h['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  const text = await res.text();
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
async function login(identifier, password) {
  const { jar, csrf } = await withCsrf();
  const r = await api(BACK, '/auth/login', {
    method: 'POST',
    jar,
    csrf,
    body: { identifier, password },
  });
  jarFrom(r.res, jar);
  return { jar, csrf, status: r.status };
}
async function makeVerified(tag) {
  const u = {
    username: `i8_${tag}_${RUN}`,
    email: `i8_${tag}_${RUN}@example.test`,
    password: `Str0ng-pass-${tag}9!`,
  };
  const { jar, csrf } = await withCsrf();
  await api(BACK, '/auth/register', { method: 'POST', jar, csrf, body: u });
  const tok = (sqlOne(
    `SELECT body_text FROM email_outbox WHERE to_email='${u.email}' AND purpose='verify_email' ORDER BY created_at DESC LIMIT 1`,
  ).match(/token=([a-f0-9]{64})/) || [])[1];
  const v = await api(BACK, '/auth/verify-email', {
    method: 'POST',
    jar,
    csrf,
    body: { token: tok },
  });
  jarFrom(v.res, jar);
  return { u, jar, csrf };
}
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
const code = (base, path, jar) => api(base, path, { jar }).then((r) => r.status);

async function main() {
  if (!check('1. Stack ready (backend + SSR frontend)', await waitForReady())) return print();

  // ── 2. blanket-access fix: anon through the FRONTEND BFF is 401, not 200 ─────
  const anonBff = await code(FRONT, '/admin/api/dashboard', {});
  check(
    '2. Blanket-access fix: anon via the frontend BFF → 401 (token proxy retired)',
    anonBff === 401,
    `status ${anonBff}`,
  );

  // ── 3. anon on the backend → 401 ────────────────────────────────────────────
  check(
    '3. Anon → backend /admin/api/dashboard → 401',
    (await code(BACK, '/admin/api/dashboard', {})) === 401,
  );

  // ── 4. signed-in NON-STAFF → 403 ────────────────────────────────────────────
  const reg = await makeVerified('reg');
  check(
    '4. Signed-in non-staff (registered) → dashboard → 403',
    (await code(BACK, '/admin/api/dashboard', reg.jar)) === 403,
  );

  // ── 5. moderator (30): RBAC-filtered ────────────────────────────────────────
  const mod = await login('demo-moderator', DEMO_PW);
  const modDash = await code(BACK, '/admin/api/dashboard', mod.jar);
  const modUsers = await code(BACK, '/admin/api/users', mod.jar);
  const modGames = await code(BACK, '/admin/api/games', mod.jar);
  check(
    '5. Moderator: dashboard 200, but games (admin) + users (owner) 403',
    mod.status === 200 && modDash === 200 && modGames === 403 && modUsers === 403,
    `dash=${modDash} games=${modGames} users=${modUsers}`,
  );

  // ── 6. admin (40) ───────────────────────────────────────────────────────────
  const adm = await login('demo-admin', DEMO_PW);
  const admGames = await code(BACK, '/admin/api/games', adm.jar);
  const admUsers = await code(BACK, '/admin/api/users', adm.jar);
  check(
    '6. Admin: dashboard + games 200, but users (owner) 403',
    (await code(BACK, '/admin/api/dashboard', adm.jar)) === 200 &&
      admGames === 200 &&
      admUsers === 403,
    `games=${admGames} users=${admUsers}`,
  );

  // ── 7. owner (50) ───────────────────────────────────────────────────────────
  const own = await login('demo-owner', DEMO_PW);
  const ownUsers = await code(BACK, '/admin/api/users', own.jar);
  const ownRoles = await code(BACK, '/admin/api/roles', own.jar);
  check(
    '7. Owner: users + roles 200',
    ownUsers === 200 && ownRoles === 200,
    `users=${ownUsers} roles=${ownRoles}`,
  );

  // ── 8. the Control Panel BFF forwards the SESSION ───────────────────────────
  const admViaBff = await code(FRONT, '/admin/api/dashboard', adm.jar);
  check(
    '8. Control Panel BFF forwards the session (admin reaches dashboard via the BFF)',
    admViaBff === 200,
    `status ${admViaBff}`,
  );

  // ── 9. session mutations require CSRF ───────────────────────────────────────
  const noCsrf = await api(FRONT, '/admin/api/badges', {
    method: 'POST',
    jar: adm.jar,
    body: { key: `i8_${RUN}`, label: 'I8 Test Badge' },
  });
  const withCsrfReq = await api(FRONT, '/admin/api/badges', {
    method: 'POST',
    jar: adm.jar,
    csrf: adm.csrf,
    body: { key: `i8_${RUN}`, label: 'I8 Test Badge' },
  });
  check(
    '9. Session admin mutation: no CSRF → 403, with CSRF → ok',
    noCsrf.status === 403 && withCsrfReq.status >= 200 && withCsrfReq.status < 300,
    `noCsrf=${noCsrf.status} withCsrf=${withCsrfReq.status}`,
  );
  // cleanup the test badge
  const badgeId = withCsrfReq.json?.data?.id;
  if (badgeId)
    await api(FRONT, `/admin/api/badges/${badgeId}`, {
      method: 'DELETE',
      jar: adm.jar,
      csrf: adm.csrf,
    });

  // ── 10. dashboard is aggregate/anonymous ────────────────────────────────────
  const dash = await api(BACK, '/admin/api/dashboard', { jar: adm.jar });
  const raw = JSON.stringify(dash.json ?? {});
  check(
    '10. Dashboard is aggregate/anonymous (no email / hash / per-user rows)',
    dash.status === 200 && !/@|passwordHash|\$argon2|"username"|"userId"/i.test(raw),
    'no per-user data',
  );

  // ════════════════════════ Slice 2 — ad / promotion management ═══════════════
  const homeSlotId = sqlOne(`SELECT id FROM ad_slots WHERE key='home'`);
  const gameSubjectId = sqlOne(`SELECT id FROM subjects WHERE slug='cyberpunk-2077'`);
  const pageText = async (path) => (await fetch(`${FRONT}${path}`, { cache: 'no-store' })).text();

  // ── 11. ads admin section is RBAC-gated ─────────────────────────────────────
  const modInv = await code(BACK, '/admin/api/ads/inventory', mod.jar);
  const admInv = await code(BACK, '/admin/api/ads/inventory', adm.jar);
  check(
    '11. Ads admin section: moderator 403, admin 200',
    modInv === 403 && admInv === 200,
    `mod=${modInv} adm=${admInv}`,
  );

  // ── 12. UGC creative escaped + activation is admins-only ────────────────────
  const xss = `<script>alert(${RUN})</script>Buy`;
  const createP = await api(BACK, '/admin/api/ad-placements', {
    method: 'POST',
    jar: adm.jar,
    csrf: adm.csrf,
    body: {
      slotId: homeSlotId,
      advertiserName: `Sec Adv ${RUN}`,
      headline: xss,
      ctaUrl: 'https://example.com',
      status: 'draft',
    },
  });
  const pid = createP.json?.data?.id;
  const modActivate = await api(BACK, `/admin/api/ads/placements/${pid}/status`, {
    method: 'POST',
    jar: mod.jar,
    csrf: mod.csrf,
    body: { status: 'active' },
  });
  const admActivate = await api(BACK, `/admin/api/ads/placements/${pid}/status`, {
    method: 'POST',
    jar: adm.jar,
    csrf: adm.csrf,
    body: { status: 'active' },
  });
  const homeHtml = await pageText('/');
  const rawScript = homeHtml.includes(`<script>alert(${RUN})</script>`);
  const escaped = homeHtml.includes(`&lt;script&gt;alert(${RUN})&lt;/script&gt;`);
  check(
    '12. Placement creative rendered ESCAPED + activation admins-only',
    createP.status < 300 &&
      modActivate.status === 403 &&
      admActivate.status === 200 &&
      !rawScript &&
      escaped,
    `create=${createP.status} modAct=${modActivate.status} admAct=${admActivate.status} raw=${rawScript} escaped=${escaped}`,
  );

  // ── 13. an active placement ALWAYS carries the Promoted label ───────────────
  check(
    '13. Active placement carries the Promoted label',
    /Promoted/.test(homeHtml),
    `promoted=${/Promoted/.test(homeHtml)}`,
  );

  // ── 14. the public ad slot is leak-proof (no price / contact / notes) ───────
  const adslot = await api(BACK, '/public/adslot/home');
  const adslotRaw = JSON.stringify(adslot.json ?? {});
  check(
    '14. Public ad slot is leak-proof (creative only — no price/contact/notes)',
    Boolean(adslot.json?.data?.placement) && !/price|contact|notes/i.test(adslotRaw),
    'creative-only',
  );

  // ── 15. promoted game badge: promotion resolves + game page shows Promoted ──
  const createG = await api(BACK, '/admin/api/ad-placements', {
    method: 'POST',
    jar: adm.jar,
    csrf: adm.csrf,
    body: {
      slotId: homeSlotId,
      advertiserName: `Sec Game ${RUN}`,
      headline: `Play ${RUN}`,
      promotedSubjectId: gameSubjectId,
      status: 'active',
    },
  });
  const gpid = createG.json?.data?.id;
  const promo = await api(BACK, '/public/promotion/cyberpunk-2077');
  const gameHtml = await pageText('/games/cyberpunk-2077');
  check(
    '15. Promoted game badge: promotion resolves + game page shows Promoted',
    createG.status < 300 && Boolean(promo.json?.data?.advertiser) && /Promoted/.test(gameHtml),
    `promo=${Boolean(promo.json?.data?.advertiser)} badge=${/Promoted/.test(gameHtml)}`,
  );

  // cleanup the test placements
  for (const del of [pid, gpid])
    if (del)
      await api(BACK, `/admin/api/ad-placements/${del}`, {
        method: 'DELETE',
        jar: adm.jar,
        csrf: adm.csrf,
      });

  print();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
