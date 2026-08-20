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
 *  Slice 3 — newsletter (compose / segment / send / GDPR)
 *  16.  the newsletter admin section is RBAC-gated (moderator 403, admin 200)
 *  17.  GDPR consent-sync: withdrawing MARKETING consent via /auth/consent
 *       deactivates the subscription (segmentation can't target a withdrawer)
 *  18.  Mock send writes ONLY to the outbox (zero network): a send grows the
 *       outbox by EXACTLY recipientCount, every new row is provider=mock
 *  19.  segmentation excludes non-consented + unsubscribed: a withdrawn user and
 *       a token-unsubscribed address receive ZERO newsletter mail
 *  20.  no PII beyond the address: the subscriber list has emails but no
 *       ip / passwordHash / username / displayName; overview is aggregate
 *  21.  digest reuses EXISTING summaries (no new AI): the generated draft is
 *       kind=digest and its body carries a real topic slug + its stored summary
 *
 *  Slice 4 — list / slot configuration (nothing hardcoded)
 *  22.  the lists config section is RBAC-gated (moderator 403, admin 200) and
 *       persists (a PATCH is read back — not a hardcoded value)
 *  23.  a MANUAL game pin floats that game to the FRONT of Top Rated on the
 *       public homepage (auto ranking still runs underneath)
 *  24.  AUTO-pin promoted games: an active game promotion surfaces at the front
 *       of Top Rated when the option is on (auto default, manual override)
 *
 *  Slice 6 — phase-close security fixes (regressions for the review findings)
 *  25.  F1 (HIGH): a signed-in caller CANNOT hijack another user's subscription
 *       (userId stays the victim's, write-once) and a withdrawn victim is NOT
 *       mailed while a legit consented subscriber still is
 *  26.  F2 (MED): /_audit is rank-gated by the target entity — a rank-40 admin
 *       gets 403 on entityType=users and no user-PII leaks in a broad read;
 *       owner still reads it
 *  27.  F3 (LOW): the subscriber CSV neutralizes formula-lead cells (a +/-/=/@
 *       leading email is prefixed with an apostrophe)
 *  28.  F4 (LOW): a javascript: ctaUrl (planted past input validation) is NOT
 *       rendered as an href at the render site (creative still shows, no link)
 *  29.  F5 (LOW): the newsletter subject's CR/LF is stripped at the send seam
 *  30.  strict nonce-CSP: script-src carries a nonce + strict-dynamic and has NO
 *       'unsafe-inline'
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

  // ════════════════════════ Slice 3 — newsletter ═════════════════════════════
  // ── 16. newsletter admin section is RBAC-gated ──────────────────────────────
  const modNl = await code(BACK, '/admin/api/newsletter/overview', mod.jar);
  const admNl = await code(BACK, '/admin/api/newsletter/overview', adm.jar);
  check(
    '16. Newsletter admin section: moderator 403, admin 200',
    modNl === 403 && admNl === 200,
    `mod=${modNl} adm=${admNl}`,
  );

  // subscribe helper (public, CSRF-gated awards scope) — anonymous or a session.
  async function subscribeAs(email, jar, csrf) {
    const ctx = jar ? { jar, csrf } : await withCsrf();
    return api(BACK, '/awards/subscribe', {
      method: 'POST',
      jar: ctx.jar,
      csrf: ctx.csrf,
      body: { email, consent: true },
    });
  }
  const emailA = `i8nla_${RUN}@example.test`; // anonymous, stays consented → targeted
  const emailC = `i8nlc_${RUN}@example.test`; // anonymous, self-unsubscribes → excluded
  await subscribeAs(emailA);
  await subscribeAs(emailC);

  // subB: a registered user subscribes, then WITHDRAWS marketing consent.
  const nlB = await makeVerified('nlb');
  await subscribeAs(nlB.u.email, nlB.jar, nlB.csrf);
  await api(BACK, '/auth/consent', {
    method: 'POST',
    jar: nlB.jar,
    csrf: nlB.csrf,
    body: { consentType: 'marketing', version: 'marketing-2026-01-demo', granted: false },
  });

  // ── 17. GDPR consent-sync: the withdrawal deactivated B's subscription ──────
  const bActive = sqlOne(
    `SELECT active FROM newsletter_subscriptions WHERE email='${nlB.u.email}'`,
  );
  check(
    '17. Marketing-consent withdrawal (/auth/consent) deactivates the subscription',
    bActive === 'f',
    `B.active=${bActive || 'none'}`,
  );

  // C self-unsubscribes via the login-free capability token (public, no CSRF).
  const cToken = sqlOne(
    `SELECT unsubscribe_token FROM newsletter_subscriptions WHERE email='${emailC}'`,
  );
  const cUnsub = await api(BACK, '/public/newsletter/unsubscribe', {
    method: 'POST',
    body: { token: cToken },
  });
  const cActive = sqlOne(`SELECT active FROM newsletter_subscriptions WHERE email='${emailC}'`);

  // ── 18. Mock send writes ONLY to the outbox, exactly recipientCount rows ─────
  const outBefore = Number(sqlOne(`SELECT count(*) FROM email_outbox WHERE purpose='newsletter'`));
  const mkCampaign = await api(BACK, '/admin/api/newsletter/campaigns', {
    method: 'POST',
    jar: adm.jar,
    csrf: adm.csrf,
    body: { subject: `NL Test ${RUN}`, segment: 'all', body: `Hello from ${RUN}.` },
  });
  const campId = mkCampaign.json?.data?.id;
  const sendRes = await api(BACK, `/admin/api/newsletter/campaigns/${campId}/send`, {
    method: 'POST',
    jar: adm.jar,
    csrf: adm.csrf,
  });
  const recipientCount = sendRes.json?.data?.recipientCount ?? -1;
  const outAfter = Number(sqlOne(`SELECT count(*) FROM email_outbox WHERE purpose='newsletter'`));
  const allMock =
    sqlOne(`SELECT count(*) FROM email_outbox WHERE purpose='newsletter' AND provider<>'mock'`) ===
    '0';
  const aGotMail = Number(
    sqlOne(`SELECT count(*) FROM email_outbox WHERE purpose='newsletter' AND to_email='${emailA}'`),
  );
  check(
    '18. Mock send: outbox grew by EXACTLY recipientCount, all rows provider=mock (zero network)',
    sendRes.status === 200 &&
      recipientCount >= 1 &&
      outAfter - outBefore === recipientCount &&
      allMock &&
      aGotMail === 1,
    `recip=${recipientCount} delta=${outAfter - outBefore} mockOnly=${allMock} A=${aGotMail}`,
  );

  // ── 19. segmentation excludes withdrawn (B) + unsubscribed (C) ──────────────
  const bMail = Number(
    sqlOne(
      `SELECT count(*) FROM email_outbox WHERE purpose='newsletter' AND to_email='${nlB.u.email}'`,
    ),
  );
  const cMail = Number(
    sqlOne(`SELECT count(*) FROM email_outbox WHERE purpose='newsletter' AND to_email='${emailC}'`),
  );
  check(
    '19. Segmentation excludes non-consented (withdrawn B) + token-unsubscribed C',
    cUnsub.status === 200 && cActive === 'f' && bMail === 0 && cMail === 0,
    `cUnsub=${cUnsub.status} cActive=${cActive} B=${bMail} C=${cMail}`,
  );

  // ── 20. no PII beyond the address ───────────────────────────────────────────
  const subs = await api(BACK, '/admin/api/newsletter/subscribers', { jar: adm.jar });
  const subsRaw = JSON.stringify(subs.json ?? {});
  check(
    '20. Subscriber list: address only — no ip / passwordHash / username / displayName',
    subs.status === 200 &&
      /@/.test(subsRaw) &&
      !/passwordHash|\$argon2|"ip"|"username"|"displayName"/i.test(subsRaw),
    'address-only PII',
  );

  // ── 21. digest reuses EXISTING summaries (no new AI) ────────────────────────
  const digSlug = sqlOne(
    `SELECT slug FROM topics WHERE (tldr IS NOT NULL OR ai_summary IS NOT NULL) ORDER BY last_activity_at DESC NULLS LAST LIMIT 1`,
  );
  const digSummary = sqlOne(
    `SELECT coalesce(tldr, ai_summary) FROM topics WHERE slug='${digSlug}'`,
  );
  const mkDigest = await api(BACK, '/admin/api/newsletter/digest', {
    method: 'POST',
    jar: adm.jar,
    csrf: adm.csrf,
  });
  const digestId = mkDigest.json?.data?.id;
  const digestBody = digestId
    ? sqlOne(`SELECT body FROM newsletter_campaigns WHERE id='${digestId}'`)
    : '';
  const digestKind = digestId
    ? sqlOne(`SELECT kind FROM newsletter_campaigns WHERE id='${digestId}'`)
    : '';
  check(
    '21. Digest reuses existing summaries: kind=digest + body carries a real topic slug + summary',
    mkDigest.status === 201 &&
      digestKind === 'digest' &&
      Boolean(digSlug) &&
      digestBody.includes(digSlug) &&
      (digSummary === '' || digestBody.includes(digSummary.slice(0, 40))),
    `kind=${digestKind} slug=${digestBody.includes(digSlug)} summary=${digSummary ? digestBody.includes(digSummary.slice(0, 40)) : 'n/a'}`,
  );

  // cleanup the newsletter test data (campaigns + the three test subscriptions)
  sqlOne(`DELETE FROM newsletter_campaigns WHERE subject LIKE 'NL Test ${RUN}' OR kind='digest'`);
  sqlOne(
    `DELETE FROM newsletter_subscriptions WHERE email IN ('${emailA}','${emailC}','${nlB.u.email}')`,
  );
  sqlOne(`DELETE FROM email_outbox WHERE purpose='newsletter'`);

  // ════════════════════════ Slice 4 — list / slot configuration ═══════════════
  // ── 22. lists config section RBAC-gated + persists (not hardcoded) ──────────
  const modCfg = await code(BACK, '/admin/api/lists/config', mod.jar);
  const patchCfg = await api(BACK, '/admin/api/lists/config', {
    method: 'PATCH',
    jar: adm.jar,
    csrf: adm.csrf,
    body: { heroCount: 11 },
  });
  const readCfg = await api(BACK, '/admin/api/lists/config', { jar: adm.jar });
  check(
    '22. Lists config: moderator 403, admin PATCH persists (heroCount read back = 11)',
    modCfg === 403 && patchCfg.status === 200 && readCfg.json?.data?.config?.heroCount === 11,
    `mod=${modCfg} patch=${patchCfg.status} heroCount=${readCfg.json?.data?.config?.heroCount}`,
  );

  // ── 23. a MANUAL game pin floats to the FRONT of Top Rated ──────────────────
  const home1 = await api(BACK, '/public/homepage');
  const top1 = (home1.json?.data?.topRated ?? []).map((g) => g.slug);
  const pinTarget = top1.length >= 2 ? top1[top1.length - 1] : top1[0];
  await api(BACK, '/admin/api/lists/config', {
    method: 'PATCH',
    jar: adm.jar,
    csrf: adm.csrf,
    body: { pinnedGameSlugs: [pinTarget], pinPromotedGames: false },
  });
  const home2 = await api(BACK, '/public/homepage');
  const top2 = (home2.json?.data?.topRated ?? []).map((g) => g.slug);
  check(
    '23. Manual game pin floats the game to the FRONT of Top Rated',
    Boolean(pinTarget) && top2[0] === pinTarget,
    `pin=${pinTarget} front=${top2[0]}`,
  );

  // ── 24. AUTO-pin promoted games surfaces at the FRONT of Top Rated ──────────
  // Promote a DIFFERENT scored game (must be in the ranked set → pick from top1).
  const promoTarget = top1.find((s) => s !== pinTarget) ?? top1[0];
  const promoSubjectId = sqlOne(`SELECT id FROM subjects WHERE slug='${promoTarget}'`);
  const slotIdForPromo = sqlOne(`SELECT id FROM ad_slots WHERE key='home'`);
  const promoPlacement = await api(BACK, '/admin/api/ad-placements', {
    method: 'POST',
    jar: adm.jar,
    csrf: adm.csrf,
    body: {
      slotId: slotIdForPromo,
      advertiserName: `Lists Promo ${RUN}`,
      headline: `Featured ${RUN}`,
      promotedSubjectId: promoSubjectId,
      status: 'active',
    },
  });
  // Clear the manual pin so the ONLY thing pulling promoTarget forward is the auto-pin.
  await api(BACK, '/admin/api/lists/config', {
    method: 'PATCH',
    jar: adm.jar,
    csrf: adm.csrf,
    body: { pinnedGameSlugs: [], pinPromotedGames: true },
  });
  const home3 = await api(BACK, '/public/homepage');
  const top3 = (home3.json?.data?.topRated ?? []).map((g) => g.slug);
  check(
    '24. Auto-pin: an active game promotion floats to the FRONT of Top Rated',
    promoPlacement.status < 300 && Boolean(promoTarget) && top3[0] === promoTarget,
    `promo=${promoTarget} front=${top3[0]}`,
  );

  // cleanup: remove the promo placement + reset the lists config to defaults
  const promoPid = promoPlacement.json?.data?.id;
  if (promoPid)
    await api(BACK, `/admin/api/ad-placements/${promoPid}`, {
      method: 'DELETE',
      jar: adm.jar,
      csrf: adm.csrf,
    });
  sqlOne(`DELETE FROM app_settings WHERE key='lists'`);

  // ════════════════════════ Slice 6 — phase-close security fixes ══════════════
  // ── 25. F1: signed-in subscribe cannot hijack another user's subscription ────
  const vB = await makeVerified('f1v'); // victim (registered)
  await api(BACK, '/awards/subscribe', {
    method: 'POST',
    jar: vB.jar,
    csrf: vB.csrf,
    body: { email: vB.u.email, consent: true },
  });
  await api(BACK, '/auth/consent', {
    method: 'POST',
    jar: vB.jar,
    csrf: vB.csrf,
    body: { consentType: 'marketing', version: 'marketing-2026-01-demo', granted: false },
  }); // B withdraws
  const aA = await makeVerified('f1a'); // attacker
  await api(BACK, '/awards/subscribe', {
    method: 'POST',
    jar: aA.jar,
    csrf: aA.csrf,
    body: { email: vB.u.email, consent: true },
  }); // attacker subscribes the victim's email
  const cC = await makeVerified('f1c'); // legit consented recipient
  await api(BACK, '/awards/subscribe', {
    method: 'POST',
    jar: cC.jar,
    csrf: cC.csrf,
    body: { email: cC.u.email, consent: true },
  });
  const bLink = sqlOne(`SELECT user_id FROM newsletter_subscriptions WHERE email='${vB.u.email}'`);
  const bId = sqlOne(`SELECT id FROM users WHERE email='${vB.u.email}'`);
  const aId = sqlOne(`SELECT id FROM users WHERE email='${aA.u.email}'`);
  const mk1 = await api(BACK, '/admin/api/newsletter/campaigns', {
    method: 'POST',
    jar: adm.jar,
    csrf: adm.csrf,
    body: { subject: `F1 ${RUN}`, segment: 'all', body: 'x' },
  });
  const snd1 = await api(BACK, `/admin/api/newsletter/campaigns/${mk1.json?.data?.id}/send`, {
    method: 'POST',
    jar: adm.jar,
    csrf: adm.csrf,
  });
  const bMailed = Number(
    sqlOne(
      `SELECT count(*) FROM email_outbox WHERE purpose='newsletter' AND to_email='${vB.u.email}'`,
    ),
  );
  const cMailed = Number(
    sqlOne(
      `SELECT count(*) FROM email_outbox WHERE purpose='newsletter' AND to_email='${cC.u.email}'`,
    ),
  );
  check(
    "25. F1: signed-in subscribe can't hijack another user's row; withdrawn victim not mailed, legit one is",
    bLink === bId && bLink !== aId && bMailed === 0 && cMailed === 1,
    `linkedTo=${bLink === bId ? 'B(ok)' : 'A(HIJACKED)'} bMailed=${bMailed} cMailed=${cMailed} sent=${snd1.json?.data?.recipientCount}`,
  );
  sqlOne(`DELETE FROM newsletter_campaigns WHERE subject LIKE 'F1 ${RUN}'`);
  sqlOne(`DELETE FROM email_outbox WHERE purpose='newsletter'`);
  sqlOne(`DELETE FROM newsletter_subscriptions WHERE email IN ('${vB.u.email}','${cC.u.email}')`);
  sqlOne(`DELETE FROM users WHERE email IN ('${vB.u.email}','${aA.u.email}','${cC.u.email}')`);

  // ── 26. F2: /_audit is rank-gated by the target entityType ──────────────────
  const roleReg = sqlOne(`SELECT id FROM roles WHERE key='registered'`);
  const secretEmail = `f2_${RUN}@secret.example`;
  const cu = await api(BACK, '/admin/api/users', {
    method: 'POST',
    jar: own.jar,
    csrf: own.csrf,
    body: { username: `f2_${RUN}`, email: secretEmail, roleId: roleReg },
  });
  const f2uid = cu.json?.data?.id;
  const admAuditUsers = await code(BACK, '/admin/api/_audit?entityType=users', adm.jar);
  const admBroad = await api(BACK, '/admin/api/_audit?limit=200', { jar: adm.jar });
  const ownAuditUsers = await code(BACK, '/admin/api/_audit?entityType=users', own.jar);
  check(
    '26. F2: _audit rank-gated by entity — admin 403 on users audit + no PII leak; owner 200',
    admAuditUsers === 403 && !admBroad.text.includes(secretEmail) && ownAuditUsers === 200,
    `admUsers=${admAuditUsers} broadLeak=${admBroad.text.includes(secretEmail)} ownUsers=${ownAuditUsers}`,
  );
  if (f2uid)
    await api(BACK, `/admin/api/users/${f2uid}`, {
      method: 'DELETE',
      jar: own.jar,
      csrf: own.csrf,
    });
  sqlOne(`DELETE FROM audit_logs WHERE entity_id='${f2uid}'`);
  sqlOne(`DELETE FROM users WHERE email='${secretEmail}'`);

  // ── 27. F3: CSV export neutralizes formula-lead cells ───────────────────────
  const f3email = `+f3${RUN}@evil.example`;
  const f3ctx = await withCsrf();
  await api(BACK, '/awards/subscribe', {
    method: 'POST',
    jar: f3ctx.jar,
    csrf: f3ctx.csrf,
    body: { email: f3email, consent: true },
  });
  const csvRes = await api(BACK, '/admin/api/newsletter/subscribers/export', { jar: adm.jar });
  const f3line = csvRes.text.split('\n').find((l) => l.includes(f3email)) ?? '';
  check(
    '27. F3: CSV neutralizes formula-lead cells (+/-/=/@ prefixed with an apostrophe)',
    csvRes.status === 200 && f3line.includes(`"'${f3email}"`),
    `line=${f3line.slice(0, 40)}`,
  );
  sqlOne(`DELETE FROM newsletter_subscriptions WHERE email='${f3email}'`);

  // ── 28. F4: a javascript: ctaUrl is not rendered as an href at the render site
  const homeSlotF4 = sqlOne(`SELECT id FROM ad_slots WHERE key='home'`);
  sqlOne(
    `INSERT INTO ad_placements (slot_id, advertiser_name, headline, cta_url, cta_label, status) VALUES ('${homeSlotF4}','F4 Adv','F4 Headline ${RUN}','javascript:alert(1)','Click','active')`,
  );
  const homeF4 = await pageText('/');
  const jsHref = /href=["']javascript:/i.test(homeF4);
  const f4Creative = homeF4.includes(`F4 Headline ${RUN}`);
  check(
    '28. F4: javascript: ctaUrl not rendered as href (creative shows, no link)',
    f4Creative && !jsHref,
    `creative=${f4Creative} jsHref=${jsHref}`,
  );
  sqlOne(`DELETE FROM ad_placements WHERE headline='F4 Headline ${RUN}'`);

  // ── 29. F5: newsletter subject CR/LF stripped at the send seam ──────────────
  const rc = await makeVerified('f5');
  await api(BACK, '/awards/subscribe', {
    method: 'POST',
    jar: rc.jar,
    csrf: rc.csrf,
    body: { email: rc.u.email, consent: true },
  });
  const mk5 = await api(BACK, '/admin/api/newsletter/campaigns', {
    method: 'POST',
    jar: adm.jar,
    csrf: adm.csrf,
    body: { subject: `Hi ${RUN}\r\nBcc: evil@x.com`, segment: 'all', body: 'x' },
  });
  await api(BACK, `/admin/api/newsletter/campaigns/${mk5.json?.data?.id}/send`, {
    method: 'POST',
    jar: adm.jar,
    csrf: adm.csrf,
  });
  const storedSubj = sqlOne(
    `SELECT subject FROM email_outbox WHERE purpose='newsletter' AND to_email='${rc.u.email}' ORDER BY created_at DESC LIMIT 1`,
  );
  check(
    '29. F5: newsletter subject CR/LF stripped at the send seam (no header injection)',
    storedSubj.length > 0 && !/[\r\n]/.test(storedSubj),
    `stored=${JSON.stringify(storedSubj).slice(0, 50)}`,
  );
  sqlOne(`DELETE FROM newsletter_campaigns WHERE subject LIKE 'Hi ${RUN}%'`);
  sqlOne(`DELETE FROM email_outbox WHERE purpose='newsletter'`);
  sqlOne(`DELETE FROM newsletter_subscriptions WHERE email='${rc.u.email}'`);
  sqlOne(`DELETE FROM users WHERE email='${rc.u.email}'`);

  // ── 30. strict nonce-CSP ────────────────────────────────────────────────────
  const cspRes = await fetch(`${FRONT}/`, { cache: 'no-store' });
  const csp = cspRes.headers.get('content-security-policy') ?? '';
  const scriptSrc = (csp.match(/script-src[^;]*/) || [''])[0];
  check(
    "30. Strict nonce-CSP: script-src has a nonce + strict-dynamic and NO 'unsafe-inline'",
    /nonce-/.test(scriptSrc) &&
      /strict-dynamic/.test(scriptSrc) &&
      !/unsafe-inline/.test(scriptSrc),
    scriptSrc.replace(/nonce-[^']*/, 'nonce-<N>'),
  );

  print();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
