#!/usr/bin/env node
/**
 * GamesKeep — I6 verification (grows slice by slice; SLICES 1–2: auth core +
 * email flows). Every check PROVES AN ATTACK FAILS on the live stack — not that
 * a page renders:
 *
 *  Slice 1 — auth core
 *   2.  register: generic 202, NO auto-login (no session cookie)
 *   3.  enumeration-safe register: taken email → byte-identical 202; only the
 *       public username 409s
 *   4.  DB truth: password stored ONLY as $argon2id$ + password_algo recorded
 *   5.  login: HttpOnly+SameSite=Lax SIGNED session cookie; payload carries no
 *       hash/internal fields
 *   6.  DB truth: sessions hold sha256(token), never the raw token; sliding
 *       expiry ≤ absolute cap (+90d)
 *   7.  /auth/me: 200 with cookie, 401 without
 *   8.  CSRF double-submit: mutation without/with-wrong header → 403
 *   9.  logout revokes; logout-all revokes every session
 *  10.  uid-keyed lockout: 5 MIXED-FORM failures (bob/BOB/email) share ONE
 *       budget → even the CORRECT password is then blocked (429)
 *  11.  enumeration-safe login: unknown-user vs wrong-password → identical
 *       bodies AND comparable timing (dummy Argon2 burn)
 *  12.  BFF: cookie relay works end-to-end; `.`/`..` path segments → 400
 *
 *  Slice 2 — email flows
 *  13.  register emails a verify link to the outbox; DB truth: user_tokens
 *       holds sha256(token) ≠ raw, TTL ~24h, unconsumed; no token in the reply
 *  14.  verify-email consumes the token (single-use), flips is_email_verified,
 *       signs the user in; a REPLAY of the same token → 400
 *  15.  taken-email register: the "account exists" notice goes to the REAL
 *       owner's address — the requester's reply is byte-identical & tokenless
 *  16.  password reset: request → outbox reset link → reset-password sets a new
 *       working password AND revokes ALL sessions (old cookie → 401)
 *  17.  reset token is single-use (replay → 400); reset is enumeration-safe (a
 *       ghost email → identical 202 and NO outbox row)
 *  18.  send throttle (per-email): repeated resets to ONE address are capped —
 *       a real inbox cannot be flooded; tokens hashed at rest, never in a reply
 *  19.  send throttle (per-IP): distinct-email registers from ONE host cap at
 *       sendMaxPerIp — a spammer cannot dodge the cap by rotating recipients
 *
 *  Hardening / retention (run last — the flood locks this host's IP)
 *  20.  spoofable-IP hardening: a flood with ROTATING X-Forwarded-For still
 *       trips the per-IP lockout (header ignored while TRUST_PROXY=false)
 *  21.  admin redaction: no $argon2 anywhere in admin CRUD or audit payloads
 *  22.  the x-admin-token service credential still authorizes (retention is a
 *       hard constraint — automation and verify:i1…b2 depend on it)
 *
 * Run after `npm run demo:up`: `npm run verify:i6`. Uses docker exec for
 * DB/Redis TRUTH checks (hash-at-rest can't be proven through the API alone)
 * and cleans ONLY its own gk:auth:* / gk:email:send:* keys (never flushall).
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const FRONT = `http://localhost:${process.env.FRONTEND_PORT ?? 3000}`;
const BACK = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN ?? 'demo-admin-token';
const RUN = Date.now().toString(36);

const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });
const check = (name, cond, detail = '') => {
  record(name, Boolean(cond), detail);
  return Boolean(cond);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── docker-based TRUTH helpers (DB/Redis state the API must never expose) ────
function sqlOne(query) {
  try {
    return execSync(
      `docker exec gameskeep-postgres-1 psql -U gameskeep -d gameskeep -tAc "${query.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return '';
  }
}

/** Targeted cleanup of this check's Redis keys — NEVER flushall. */
function cleanRedisKeys(pattern) {
  try {
    execSync(
      `docker exec gameskeep-redis-1 sh -c "redis-cli --scan --pattern '${pattern}' | xargs -r redis-cli del"`,
      { encoding: 'utf8' },
    );
  } catch {
    /* best-effort */
  }
}
const cleanAuthKeys = () => cleanRedisKeys('gk:auth:*');
const cleanEmailThrottle = () => cleanRedisKeys('gk:email:send:*');

// ── email outbox (dev mailbox) TRUTH helpers ─────────────────────────────────
function outboxLatestBody(email, purpose) {
  return sqlOne(
    `SELECT body_text FROM email_outbox WHERE to_email='${email}' AND purpose='${purpose}' ORDER BY created_at DESC LIMIT 1`,
  );
}
function outboxCount(email, purpose) {
  return Number(outboxCountRaw(email, purpose)) || 0;
}
function outboxCountRaw(email, purpose) {
  return sqlOne(
    `SELECT count(*) FROM email_outbox WHERE to_email='${email}' AND purpose='${purpose}'`,
  );
}
/** Pull the 64-hex single-use token out of an emailed link. */
function extractToken(body) {
  const m = (body ?? '').match(/token=([a-f0-9]{64})/);
  return m ? m[1] : '';
}

// ── cookie jar ───────────────────────────────────────────────────────────────
function jarFrom(res, jar = {}) {
  for (const line of res.headers.getSetCookie?.() ?? []) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1);
  }
  return jar;
}
const cookieHeader = (jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

async function api(base, path, { method = 'GET', jar = {}, csrf, body, headers = {} } = {}) {
  const h = { ...headers };
  if (Object.keys(jar).length > 0) h.cookie = cookieHeader(jar);
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
    /* non-JSON */
  }
  return { status: res.status, json, text, res };
}

/** Fresh CSRF cookie+token pair for a jar. */
async function withCsrf(base, jar = {}) {
  const r = await api(base, '/auth/csrf', { jar });
  jarFrom(r.res, jar);
  return { jar, csrf: r.json?.token ?? jar.gk_csrf };
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
  cleanAuthKeys();
  cleanEmailThrottle();
  if (!check('1. Stack ready (backend + SSR frontend)', await waitForReady())) return print();

  const userA = {
    username: `gk_a_${RUN}`,
    email: `a_${RUN}@example.test`,
    password: 'Str0ng-pass-A!',
  };
  const userB = {
    username: `gk_b_${RUN}`,
    email: `b_${RUN}@example.test`,
    password: 'Str0ng-pass-B!',
  };
  const userC = {
    username: `gk_c_${RUN}`,
    email: `c_${RUN}@example.test`,
    password: 'Str0ng-pass-C!',
  };
  // Slice 2 — dedicated users so the email flows don't collide with the Slice 1
  // sessions/lockouts above.
  const userE = {
    username: `gk_e_${RUN}`,
    email: `e_${RUN}@example.test`,
    password: 'Str0ng-pass-E!',
  };
  const userF = {
    username: `gk_f_${RUN}`,
    email: `f_${RUN}@example.test`,
    password: 'Str0ng-pass-F!',
  };

  // ── 2. register: generic 202, NO auto-login ─────────────────────────────────
  const { jar: regJar, csrf: regCsrf } = await withCsrf(BACK);
  const regA = await api(BACK, '/auth/register', {
    method: 'POST',
    jar: regJar,
    csrf: regCsrf,
    body: userA,
  });
  const regACookies = regA.res.headers.getSetCookie?.() ?? [];
  check(
    '2. Register: generic 202 and NO auto-login (no session cookie issued)',
    regA.status === 202 &&
      regA.json?.status === 'pending_verification' &&
      !regACookies.some((c) => c.startsWith('gk_session=')),
    `status ${regA.status}`,
  );

  // ── 3. enumeration-safe register ────────────────────────────────────────────
  const dupName = await api(BACK, '/auth/register', {
    method: 'POST',
    jar: regJar,
    csrf: regCsrf,
    body: { ...userA, email: `other_${RUN}@example.test` },
  });
  const dupEmail = await api(BACK, '/auth/register', {
    method: 'POST',
    jar: regJar,
    csrf: regCsrf,
    body: { ...userA, username: `gk_x_${RUN}` },
  });
  check(
    '3. Enumeration-safe register: taken email → IDENTICAL generic 202; only the public username 409s',
    dupName.status === 409 &&
      dupName.json?.error === 'username_taken' &&
      dupEmail.status === 202 &&
      dupEmail.text === regA.text,
    `name ${dupName.status}, email ${dupEmail.status}`,
  );

  // ── 4. DB truth: hash-only storage + algo recorded ──────────────────────────
  const storedHash = sqlOne(`SELECT password_hash FROM users WHERE username='${userA.username}'`);
  const storedAlgo = sqlOne(`SELECT password_algo FROM users WHERE username='${userA.username}'`);
  check(
    '4. DB truth: password stored ONLY as $argon2id$ hash + password_algo recorded',
    storedHash.startsWith('$argon2id$') &&
      !storedHash.includes(userA.password) &&
      storedAlgo.startsWith('argon2id'),
    `algo=${storedAlgo}`,
  );

  // ── 5. login: cookie flags + clean payload ──────────────────────────────────
  const { jar: aJar, csrf: aCsrf } = await withCsrf(BACK);
  const loginA = await api(BACK, '/auth/login', {
    method: 'POST',
    jar: aJar,
    csrf: aCsrf,
    body: { identifier: userA.username, password: userA.password },
  });
  const sessCookieLine = (loginA.res.headers.getSetCookie?.() ?? []).find((c) =>
    c.startsWith('gk_session='),
  );
  jarFrom(loginA.res, aJar);
  const payloadStr = JSON.stringify(loginA.json ?? {});
  check(
    '5. Login: SIGNED HttpOnly SameSite=Lax session cookie; payload has NO hash/internal fields',
    loginA.status === 200 &&
      Boolean(sessCookieLine) &&
      /httponly/i.test(sessCookieLine ?? '') &&
      /samesite=lax/i.test(sessCookieLine ?? '') &&
      decodeURIComponent(aJar.gk_session ?? '').includes('.') &&
      !payloadStr.includes('passwordHash') &&
      !payloadStr.includes('voteWeight') &&
      !payloadStr.includes('levelPoints') &&
      !payloadStr.includes('$argon2'),
    sessCookieLine ? 'flags ok' : 'no session cookie',
  );

  // ── 6. DB truth: session hashed at rest + expiry discipline ─────────────────
  const rawToken = decodeURIComponent(aJar.gk_session ?? '').split('.')[0] ?? '';
  const expectedHash = createHash('sha256').update(rawToken).digest('hex');
  const dbHash = sqlOne(
    `SELECT s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.username='${userA.username}' ORDER BY s.created_at DESC LIMIT 1`,
  );
  const expirySane = sqlOne(
    `SELECT (expires_at <= absolute_expires_at AND absolute_expires_at <= now() + interval '91 days')::text FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.username='${userA.username}' ORDER BY s.created_at DESC LIMIT 1`,
  );
  check(
    '6. DB truth: session stores sha256(token) ≠ raw; sliding expiry ≤ absolute 90-day cap',
    /^[a-f0-9]{64}$/.test(rawToken) &&
      dbHash === expectedHash &&
      dbHash !== rawToken &&
      expirySane === 'true',
    `hash match=${dbHash === expectedHash}`,
  );

  // ── 7. /auth/me with vs without the cookie ──────────────────────────────────
  const meYes = await api(BACK, '/auth/me', { jar: aJar });
  const meNo = await api(BACK, '/auth/me');
  check(
    '7. /auth/me: 200 with the session cookie, 401 without',
    meYes.status === 200 && meYes.json?.user?.username === userA.username && meNo.status === 401,
    `${meYes.status}/${meNo.status}`,
  );

  // ── 8. CSRF double-submit ───────────────────────────────────────────────────
  const noHeader = await api(BACK, '/auth/logout', { method: 'POST', jar: aJar });
  const wrongHeader = await api(BACK, '/auth/logout', {
    method: 'POST',
    jar: aJar,
    csrf: 'f'.repeat(64),
  });
  check(
    '8. CSRF: mutation without header → 403; mismatched header → 403 (double-submit enforced)',
    noHeader.status === 403 && wrongHeader.status === 403,
    `${noHeader.status}/${wrongHeader.status}`,
  );

  // ── 9. logout revokes; logout-all revokes every session ─────────────────────
  const out = await api(BACK, '/auth/logout', { method: 'POST', jar: aJar, csrf: aJar.gk_csrf });
  const meAfterOut = await api(BACK, '/auth/me', { jar: aJar });
  // two fresh sessions, then logout-all from the second
  const { jar: s1, csrf: c1 } = await withCsrf(BACK);
  await api(BACK, '/auth/login', {
    method: 'POST',
    jar: s1,
    csrf: c1,
    body: { identifier: userA.email, password: userA.password },
  }).then((r) => jarFrom(r.res, s1));
  const { jar: s2, csrf: c2 } = await withCsrf(BACK);
  await api(BACK, '/auth/login', {
    method: 'POST',
    jar: s2,
    csrf: c2,
    body: { identifier: userA.email, password: userA.password },
  }).then((r) => jarFrom(r.res, s2));
  const outAll = await api(BACK, '/auth/logout-all', { method: 'POST', jar: s2, csrf: s2.gk_csrf });
  const s1After = await api(BACK, '/auth/me', { jar: s1 });
  const s2After = await api(BACK, '/auth/me', { jar: s2 });
  check(
    '9. Logout revokes the session; logout-all revokes EVERY session',
    out.status === 200 &&
      meAfterOut.status === 401 &&
      outAll.status === 200 &&
      s1After.status === 401 &&
      s2After.status === 401,
    `revoked=${outAll.json?.revoked}`,
  );

  // ── 10. uid-keyed lockout: mixed forms share ONE budget ─────────────────────
  const { jar: bJar, csrf: bCsrf } = await withCsrf(BACK);
  await api(BACK, '/auth/register', { method: 'POST', jar: bJar, csrf: bCsrf, body: userB });
  const forms = [
    userB.username,
    userB.username.toUpperCase(),
    userB.email,
    userB.email.toUpperCase(),
    userB.username,
  ];
  for (const identifier of forms) {
    await api(BACK, '/auth/login', {
      method: 'POST',
      jar: bJar,
      csrf: bCsrf,
      body: { identifier, password: 'definitely-wrong' },
    });
  }
  const correctBlocked = await api(BACK, '/auth/login', {
    method: 'POST',
    jar: bJar,
    csrf: bCsrf,
    body: { identifier: userB.username, password: userB.password },
  });
  check(
    '10. Lockout: 5 MIXED-FORM failures (name/NAME/email) share one uid budget → CORRECT password now 429',
    correctBlocked.status === 429 && correctBlocked.json?.error === 'too_many_attempts',
    `status ${correctBlocked.status}`,
  );

  // ── 11. enumeration-safe login (body + timing) ──────────────────────────────
  // Uses a DEDICATED throwaway user (userD) for the wrong-password samples, so
  // repeated wrong attempts here can't lock the account used elsewhere. Only 3
  // wrong-password samples (< userMaxAttempts=5), and clean this user's counter
  // afterwards so nothing leaks into later checks.
  const userD = {
    username: `gk_d_${RUN}`,
    email: `d_${RUN}@example.test`,
    password: 'Str0ng-pass-D!',
  };
  const { jar: cJar, csrf: cCsrf } = await withCsrf(BACK);
  await api(BACK, '/auth/register', { method: 'POST', jar: cJar, csrf: cCsrf, body: userD });
  // Warm-up: the FIRST unknown-user login pays the one-time dummy-hash setup —
  // burn one of each so the samples measure steady state.
  await api(BACK, '/auth/login', {
    method: 'POST',
    jar: cJar,
    csrf: cCsrf,
    body: { identifier: `warmup_${RUN}@example.test`, password: 'whatever-wrong' },
  });
  const times = { unknown: [], wrong: [] };
  let unknownBody = '';
  let wrongBody = '';
  for (let i = 0; i < 3; i += 1) {
    let t = Date.now();
    const u = await api(BACK, '/auth/login', {
      method: 'POST',
      jar: cJar,
      csrf: cCsrf,
      body: { identifier: `ghost_${RUN}_${i}@example.test`, password: 'whatever-wrong' },
    });
    times.unknown.push(Date.now() - t);
    unknownBody = u.text;
    t = Date.now();
    const w = await api(BACK, '/auth/login', {
      method: 'POST',
      jar: cJar,
      csrf: cCsrf,
      body: { identifier: userD.username, password: 'whatever-wrong' },
    });
    times.wrong.push(Date.now() - t);
    wrongBody = w.text;
  }
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const mu = median(times.unknown);
  const mw = median(times.wrong);
  check(
    '11. Enumeration-safe login: unknown-user vs wrong-password → IDENTICAL body + comparable timing (dummy Argon2)',
    unknownBody === wrongBody && mu >= mw * 0.35 && mu <= mw * 3,
    `medians unknown=${mu}ms wrong=${mw}ms`,
  );
  // userC must be pristine for the BFF login below — clear any incidental
  // counters and this run's IP lock so check 12 tests the relay, not a lock.
  cleanAuthKeys();

  // ── 12. BFF relay + path traversal ──────────────────────────────────────────
  // Register userC (fresh, never wrong-password'd → unlocked) THROUGH the BFF.
  const { jar: fJar } = await withCsrf(FRONT.replace(/$/, '') + '/api', {});
  const bffReg = await api(FRONT, '/api/auth/register', {
    method: 'POST',
    jar: fJar,
    csrf: fJar.gk_csrf,
    body: userC,
  });
  const bffLogin = await api(FRONT, '/api/auth/login', {
    method: 'POST',
    jar: fJar,
    csrf: fJar.gk_csrf,
    body: { identifier: userC.email, password: userC.password },
  });
  jarFrom(bffLogin.res, fJar);
  const bffMe = await api(FRONT, '/api/auth/me', { jar: fJar });
  // `%2e%2e` may be neutralized by Next's router (404 — never reaches any
  // handler) or by OUR allowlist (400): both prove the traversal fails. The
  // mixed segment `csrf%2e` DOES reach the handler — that one must be OUR 400,
  // proving the allowlist actively rejects dot-bearing segments.
  const trav1 = await fetch(`${FRONT}/api/auth/%2e%2e`);
  const trav2 = await fetch(`${FRONT}/api/auth/csrf%2e`);
  check(
    '12. BFF: register+login+me relay end-to-end (Set-Cookie both ways); `.`/`..` cannot traverse',
    bffReg.status === 202 &&
      bffLogin.status === 200 &&
      Boolean(fJar.gk_session) &&
      bffMe.status === 200 &&
      bffMe.json?.user?.username === userC.username &&
      (trav1.status === 400 || trav1.status === 404) &&
      trav2.status === 400,
    `login ${bffLogin.status}, me ${bffMe.status}, trav ${trav1.status}/${trav2.status}`,
  );

  // ══ SLICE 2 — EMAIL FLOWS ═══════════════════════════════════════════════════

  // ── 13. register emails a hashed, TTL'd verify token to the dev outbox ──────
  const { jar: eJar, csrf: eCsrf } = await withCsrf(BACK);
  const regE = await api(BACK, '/auth/register', {
    method: 'POST',
    jar: eJar,
    csrf: eCsrf,
    body: userE,
  });
  const verifyToken = extractToken(outboxLatestBody(userE.email, 'verify_email'));
  const vtHash = verifyToken ? createHash('sha256').update(verifyToken).digest('hex') : '';
  const dbVtHash = sqlOne(
    `SELECT token_hash FROM user_tokens WHERE user_id=(SELECT id FROM users WHERE email='${userE.email}') AND purpose='verify_email' ORDER BY created_at DESC LIMIT 1`,
  );
  const vtTtlOk = sqlOne(
    `SELECT (consumed_at IS NULL AND expires_at > now() + interval '23 hours' AND expires_at < now() + interval '25 hours')::text FROM user_tokens WHERE user_id=(SELECT id FROM users WHERE email='${userE.email}') AND purpose='verify_email' ORDER BY created_at DESC LIMIT 1`,
  );
  check(
    '13. Register → verify link in outbox; DB truth: user_tokens = sha256(token) ≠ raw, ~24h TTL, unconsumed; reply is tokenless',
    regE.status === 202 &&
      /^[a-f0-9]{64}$/.test(verifyToken) &&
      dbVtHash === vtHash &&
      dbVtHash !== verifyToken &&
      vtTtlOk === 'true' &&
      !/[a-f0-9]{64}/.test(regE.text),
    `token=${verifyToken.slice(0, 8)}… ttlOk=${vtTtlOk}`,
  );

  // ── 14. verify-email: single-use consume, flips verified, signs in ──────────
  const { jar: evJar, csrf: evCsrf } = await withCsrf(BACK);
  const verify1 = await api(BACK, '/auth/verify-email', {
    method: 'POST',
    jar: evJar,
    csrf: evCsrf,
    body: { token: verifyToken },
  });
  jarFrom(verify1.res, evJar);
  const verifyReplay = await api(BACK, '/auth/verify-email', {
    method: 'POST',
    jar: evJar,
    csrf: evCsrf,
    body: { token: verifyToken },
  });
  const dbVerified = sqlOne(
    `SELECT is_email_verified::text FROM users WHERE email='${userE.email}'`,
  );
  check(
    '14. verify-email: token consumed (single-use) → verified + signed in; REPLAY of the same token → 400',
    verify1.status === 200 &&
      verify1.json?.verified === true &&
      Boolean(evJar.gk_session) &&
      dbVerified === 'true' &&
      verifyReplay.status === 400 &&
      verifyReplay.json?.error === 'invalid_or_expired_token' &&
      !/[a-f0-9]{64}/.test(verify1.text),
    `verify ${verify1.status}, replay ${verifyReplay.status}, dbVerified=${dbVerified}`,
  );

  // ── 15. taken-email register → notice to the REAL owner, not the requester ──
  const noticeBefore = outboxCount(userE.email, 'account_exists');
  const { jar: dupJar, csrf: dupCsrf } = await withCsrf(BACK);
  const dupE = await api(BACK, '/auth/register', {
    method: 'POST',
    jar: dupJar,
    csrf: dupCsrf,
    body: { username: `gk_e2_${RUN}`, email: userE.email, password: 'Different-pass-9!' },
  });
  const noticeAfter = outboxCount(userE.email, 'account_exists');
  const dupCookies = dupE.res.headers.getSetCookie?.() ?? [];
  check(
    '15. Taken email: "account exists" notice goes to the REAL owner; requester gets a byte-identical, tokenless, cookieless 202',
    dupE.status === 202 &&
      dupE.text === regA.text &&
      noticeAfter === noticeBefore + 1 &&
      !dupCookies.some((c) => c.startsWith('gk_session=')) &&
      !/[a-f0-9]{64}/.test(dupE.text),
    `notices ${noticeBefore}→${noticeAfter}`,
  );

  // ── 16. password reset revokes ALL sessions + sets a new working password ───
  const { jar: fReg, csrf: fRegCsrf } = await withCsrf(BACK);
  await api(BACK, '/auth/register', { method: 'POST', jar: fReg, csrf: fRegCsrf, body: userF });
  const { jar: fSess, csrf: fSessCsrf } = await withCsrf(BACK);
  await api(BACK, '/auth/login', {
    method: 'POST',
    jar: fSess,
    csrf: fSessCsrf,
    body: { identifier: userF.email, password: userF.password },
  }).then((r) => jarFrom(r.res, fSess));
  const fMeBefore = await api(BACK, '/auth/me', { jar: fSess });
  const { jar: fReq, csrf: fReqCsrf } = await withCsrf(BACK);
  const reqReset = await api(BACK, '/auth/request-password-reset', {
    method: 'POST',
    jar: fReq,
    csrf: fReqCsrf,
    body: { email: userF.email },
  });
  const resetToken = extractToken(outboxLatestBody(userF.email, 'password_reset'));
  const newPass = 'Rotated-pass-Z9!';
  const { jar: rpJar, csrf: rpCsrf } = await withCsrf(BACK);
  const doReset = await api(BACK, '/auth/reset-password', {
    method: 'POST',
    jar: rpJar,
    csrf: rpCsrf,
    body: { token: resetToken, password: newPass },
  });
  const fMeAfter = await api(BACK, '/auth/me', { jar: fSess }); // old session must be dead
  const { jar: lo, csrf: loCsrf } = await withCsrf(BACK);
  const loginOld = await api(BACK, '/auth/login', {
    method: 'POST',
    jar: lo,
    csrf: loCsrf,
    body: { identifier: userF.email, password: userF.password },
  });
  const { jar: ln, csrf: lnCsrf } = await withCsrf(BACK);
  const loginNew = await api(BACK, '/auth/login', {
    method: 'POST',
    jar: ln,
    csrf: lnCsrf,
    body: { identifier: userF.email, password: newPass },
  });
  check(
    '16. Password reset: NEW password works, OLD fails, and EVERY prior session is revoked (old cookie → 401)',
    reqReset.status === 202 &&
      /^[a-f0-9]{64}$/.test(resetToken) &&
      doReset.status === 200 &&
      (doReset.json?.revoked ?? 0) >= 1 &&
      fMeBefore.status === 200 &&
      fMeAfter.status === 401 &&
      loginOld.status === 401 &&
      loginNew.status === 200,
    `revoked=${doReset.json?.revoked}, oldSession ${fMeAfter.status}, oldPw ${loginOld.status}, newPw ${loginNew.status}`,
  );

  // ── 17. reset token single-use + reset enumeration-safe ─────────────────────
  const { jar: rp2, csrf: rp2Csrf } = await withCsrf(BACK);
  const resetReplay = await api(BACK, '/auth/reset-password', {
    method: 'POST',
    jar: rp2,
    csrf: rp2Csrf,
    body: { token: resetToken, password: 'Another-pass-1!' },
  });
  const ghostEmail = `ghost_${RUN}@example.test`;
  const { jar: gh, csrf: ghCsrf } = await withCsrf(BACK);
  const ghostReq = await api(BACK, '/auth/request-password-reset', {
    method: 'POST',
    jar: gh,
    csrf: ghCsrf,
    body: { email: ghostEmail },
  });
  const ghostRows = outboxCount(ghostEmail, 'password_reset');
  check(
    '17. Reset token single-use (replay → 400); reset enumeration-safe (ghost email → identical 202, NO outbox row)',
    resetReplay.status === 400 &&
      resetReplay.json?.error === 'invalid_or_expired_token' &&
      ghostReq.status === 202 &&
      ghostReq.text === reqReset.text &&
      ghostRows === 0,
    `replay ${resetReplay.status}, ghostRows ${ghostRows}`,
  );

  // ── 18. send throttle caps outbound email per recipient address ─────────────
  // Fresh counters, then 8 reset requests to ONE address: the per-email cap
  // (default 5) trips before the per-IP cap (20), so exactly 5 land in the
  // outbox — a real inbox can't be flooded via the enumeration-safe endpoint.
  cleanEmailThrottle();
  const throttleBefore = outboxCount(userF.email, 'password_reset');
  const { jar: tj, csrf: tc } = await withCsrf(BACK);
  for (let i = 0; i < 8; i += 1) {
    await api(BACK, '/auth/request-password-reset', {
      method: 'POST',
      jar: tj,
      csrf: tc,
      body: { email: userF.email },
    });
  }
  const sent = outboxCount(userF.email, 'password_reset') - throttleBefore;
  check(
    '18. Send throttle (per-email): 8 resets to one address yield only 5 sends (a real inbox cannot be flooded)',
    sent === 5,
    `sent ${sent}/8 (per-email cap 5)`,
  );

  // ── 19. send throttle also caps per CLIENT IP (distinct addresses) ──────────
  // The per-email cap alone can't stop a spammer who cycles addresses. Register
  // sendMaxPerIp+2 accounts, each with a DISTINCT email (so the per-email cap of
  // 5 never trips) from ONE socket peer: verify sends cut off at sendMaxPerIp,
  // so a single host cannot flood the mailer by rotating recipients. The cap is
  // read from app_settings (the "everything configurable from admin" rule), not
  // a hardcoded 20.
  //
  // These POSTs carry x-admin-token ONLY to opt out of the anonymous 100/min
  // global limiter (plugins/security.ts allowList) — that unrelated request
  // counter would otherwise mask the email throttle AND spend the shared budget
  // check 20's flood relies on. The token does NOT bypass canSend(): the per-IP
  // EMAIL throttle is route logic keyed on req.ip, so this isolates exactly it.
  cleanEmailThrottle();
  const perIpCap =
    Number(
      sqlOne(`SELECT (value->>'sendMaxPerIp')::int FROM app_settings WHERE key='email'`) || '',
    ) || 20;
  const ipFlood = perIpCap + 2;
  const svc = { 'x-admin-token': ADMIN_TOKEN };
  const { jar: ij, csrf: ic } = await withCsrf(BACK); // one CSRF pair, reused
  let ipSends = 0;
  for (let i = 0; i < ipFlood; i += 1) {
    const em = `ipcap_${RUN}_${i}@example.test`;
    await api(BACK, '/auth/register', {
      method: 'POST',
      jar: ij,
      csrf: ic,
      headers: svc,
      body: { username: `gk_ipc_${RUN}_${i}`, email: em, password: 'Str0ng-pass-Q9!' },
    });
    ipSends += outboxCount(em, 'verify_email');
  }
  check(
    `19. Send throttle (per-IP): ${ipFlood} distinct-email registers from one host cap at sendMaxPerIp verify sends`,
    ipSends === perIpCap,
    `sent ${ipSends}/${ipFlood} (per-IP cap ${perIpCap})`,
  );

  // ══ HARDENING / RETENTION (run last — the flood locks this host's IP) ════════
  cleanAuthKeys(); // clear any incidental auth counters before the flood

  // ── 20. spoofed X-Forwarded-For cannot dodge the per-IP lockout ─────────────
  // With TRUST_PROXY=false the socket peer is the identity; if the header were
  // trusted, every rotated XFF would get a fresh budget and no lock would EVER
  // appear. Run LAST — it locks this host's IP for lockSec.
  let ipLockedAt = -1;
  for (let i = 0; i < 35; i += 1) {
    const r = await api(BACK, '/auth/login', {
      method: 'POST',
      jar: cJar,
      csrf: cCsrf,
      headers: { 'x-forwarded-for': `198.51.100.${i + 1}` },
      body: { identifier: `flood_${RUN}_${i}@example.test`, password: 'wrong' },
    });
    if (r.status === 429 && r.json?.error === 'too_many_attempts') {
      ipLockedAt = i;
      break;
    }
  }
  check(
    '20. Spoofable-IP hardening: rotating X-Forwarded-For flood STILL trips the per-IP lock (header ignored)',
    ipLockedAt >= 0,
    ipLockedAt >= 0
      ? `locked at flood attempt ${ipLockedAt + 1}`
      : 'never locked — header trusted?',
  );

  // ── 21. admin redaction: no hash anywhere ───────────────────────────────────
  const adminUsers = await api(BACK, '/admin/api/users', {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  const auditRows = await api(BACK, '/admin/api/_audit?limit=200', {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  const userRow = (adminUsers.json?.data ?? []).find((u) => u.username === userA.username);
  check(
    '21. Admin redaction: CRUD + audit payloads carry NO $argon2 material; hashes read [REDACTED]',
    adminUsers.status === 200 &&
      !adminUsers.text.includes('$argon2') &&
      userRow?.passwordHash === '[REDACTED]' &&
      !auditRows.text.includes('$argon2'),
    `users=${adminUsers.status}, audit=${auditRows.status}`,
  );

  // ── 22. the service credential is retained ──────────────────────────────────
  const metaYes = await api(BACK, '/admin/api/_meta', {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  const metaNo = await api(BACK, '/admin/api/_meta');
  check(
    '22. x-admin-token retained for automation: with token 200, without 401 (i1…b2 depend on this)',
    metaYes.status === 200 && metaNo.status === 401,
    `${metaYes.status}/${metaNo.status}`,
  );

  cleanAuthKeys(); // targeted — so an immediate rerun starts clean
  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write(
    '\nGamesKeep — I6 auth core + email flows (Slices 1–2): prove-the-attack-fails\n\n',
  );
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL I6 CHECKS PASSED ✓' : 'SOME I6 CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('i6-check crashed:', err);
  process.exit(1);
});
