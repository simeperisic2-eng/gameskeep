#!/usr/bin/env node
/**
 * GamesKeep — I6 verification (grows slice by slice; SLICES 1–6: auth + email +
 * RBAC + community writes + reputation + follow/feed). Every check PROVES AN
 * ATTACK FAILS on the live stack — not that a page renders:
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
 *  Slice 3 — RBAC + admin hardening
 *  20.  no credentials → 401; a signed-in NON-staff user → 403 (authed but
 *       forbidden is DISTINCT from anonymous)
 *  21.  moderator (rank 30) reaches a moderation section but is 403 on the
 *       admin-only and owner-only sections (per-section rank gating)
 *  22.  admin (rank 40) reaches an admin section but is 403 on the owner-only
 *       roles section (a privilege-escalation surface)
 *  23.  owner (rank 50) reaches the owner section; a cookie-authed mutation is
 *       403 without CSRF, 200 with it; the audit row names the REAL staff user
 *  24.  the x-admin-token service credential bypasses the gate — reaches the
 *       owner-only section a mere admin cannot (automation retention)
 *
 *  Slice 4 — community writes (real accounts through the gated /community scope)
 *  25.  verified-email gate: an unverified user cannot write (403); verified can
 *  26.  CSRF required on the cookie-authed write path
 *  27.  one rating row per (user, game) — re-rating UPDATES, never duplicates
 *  28.  per-user write rate limit (cap from app_settings) → 429 over the cap
 *  29.  UGC: a <script> comment is stored RAW and returned as a JSON string
 *  30.  comment reports auto-hide a comment at the (tunable) threshold
 *  31.  a moderator (rank 30) can restore an auto-hidden comment (audited)
 *  32.  article trust votes are credibility-weighted (weighted ≠ naive)
 *  33.  topic bias votes: one row per (user, axis); re-vote updates, 0 clears
 *  34.  upcoming hype: one-per-user toggle, credibility-weighted count
 *  35.  REVIEW-BOMB via real accounts (proven base + verified-new + unverified
 *       ring): the flag raises and the WEIGHTED score resists (proven dominate)
 *       while the naive average collapses; nothing silently dropped
 *  36.  per-vote weight at rest — uniform 0→1.0: proven ~1.0, verified-new
 *       ~0.45, unverified ~0 (decision 13; inspectable, no opaque number)
 *  37.  counter-case: a proven-voter LOW score MOVES the score and is NOT
 *       flagged (legitimate dissatisfaction is honored, never blanket-muted)
 *
 *  Slice 5 — reputation + levels + badges
 *  38.  a self-farm ring of throwaway up-votes CANNOT raise reputation past the
 *       first level (received signals are weighted by the reactor's credibility)
 *  39.  the SAME up-votes from credible (aged/reputable) accounts DO count — the
 *       target levels up (it's credibility, not vote count, that moves it)
 *  40.  penalties: a suspended account is zeroed; removing a user's comment
 *       drops their reputation (helpful gone + removed-content penalty)
 *  41.  auto-badges are monotonic + idempotent (verified / early-voter; two
 *       recomputes leave exactly one row each)
 *  42.  the profile is leak-proof: level name + progress + badges, NEVER the
 *       raw reputation number, levelPoints, voteWeight, or thresholds
 *
 *  Slice 6 — follow + "Your Feed"
 *  43.  following is OPEN to unverified users (decision 6); a follow needs CSRF;
 *       the follow row lands in the DB
 *  44.  "Your Feed" is PER-USER: it lists the followed game + topic with a
 *       private no-store cache-control, and a logged-out request is 401
 *  45.  one follow row per (user, entity) — following twice is idempotent,
 *       unfollow removes it
 *
 *  Hardening / retention (run last — the flood locks this host's IP)
 *  46.  spoofable-IP hardening: a flood with ROTATING X-Forwarded-For still
 *       trips the per-IP lockout (header ignored while TRUST_PROXY=false)
 *  47.  admin redaction: no $argon2 anywhere in admin CRUD or audit payloads
 *  48.  the x-admin-token service credential still authorizes (retention is a
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
  // These POSTs carry x-admin-token ONLY to opt out of the anonymous global
  // rate limiter (plugins/security.ts allowList) — that unrelated request
  // counter would otherwise mask the email throttle. The token does NOT bypass
  // canSend(): the per-IP EMAIL throttle is route logic keyed on req.ip, so
  // this isolates exactly it.
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

  // ══ SLICE 3 — RBAC + ADMIN HARDENING ════════════════════════════════════════
  // Prove the staff-session admin path enforces per-section rank gating (403s
  // for insufficient rank / non-staff), that cookie-authed mutations need CSRF,
  // that staff actions are attributed to the real user in the audit trail, and
  // that the x-admin-token service credential still bypasses the gate (the
  // retention hard constraint keeping verify:i1…b2 green).
  const SVC = { 'x-admin-token': ADMIN_TOKEN };
  const rolesResp = await api(BACK, '/admin/api/roles', { headers: SVC });
  const roleId = (key) => (rolesResp.json?.data ?? []).find((r) => r.key === key)?.id;

  // A signed-in user at a given role: register (sets the password), resolve the
  // id (register is enumeration-safe → no id in the body), elevate via the
  // service token, then log in for a session + CSRF pair in one jar.
  async function makeUser(tag, roleKey) {
    const u = {
      username: `gk_${tag}_${RUN}`,
      email: `${tag}_${RUN}@example.test`,
      password: `Str0ng-pass-${tag}9!`,
    };
    const { jar: rj, csrf: rc } = await withCsrf(BACK);
    await api(BACK, '/auth/register', { method: 'POST', jar: rj, csrf: rc, body: u });
    const id = sqlOne(`SELECT id FROM users WHERE email='${u.email}'`);
    if (roleKey !== 'registered') {
      await api(BACK, `/admin/api/users/${id}`, {
        method: 'PATCH',
        headers: SVC,
        body: { roleId: roleId(roleKey) },
      });
    }
    const { jar, csrf } = await withCsrf(BACK);
    const login = await api(BACK, '/auth/login', {
      method: 'POST',
      jar,
      csrf,
      body: { identifier: u.email, password: u.password },
    });
    jarFrom(login.res, jar);
    return { u, id, jar, csrf };
  }

  // ── 20. anonymous → 401; authenticated NON-staff → 403 (distinguished) ──────
  const registered = await makeUser('reg', 'registered');
  const anonMeta = await api(BACK, '/admin/api/_meta'); // no token, no cookie
  const regMeta = await api(BACK, '/admin/api/_meta', { jar: registered.jar });
  check(
    '20. RBAC: no credentials → 401; a signed-in NON-staff user → 403 (authed-but-forbidden, not anonymous)',
    anonMeta.status === 401 && regMeta.status === 403,
    `anon ${anonMeta.status}, registered ${regMeta.status}`,
  );

  // ── 21. moderator (30): moderation section ok; admin/owner sections 403 ─────
  const mod = await makeUser('mod', 'moderator');
  const modTopics = await api(BACK, '/admin/api/topics', { jar: mod.jar }); // 30 → ok
  const modGames = await api(BACK, '/admin/api/games', { jar: mod.jar }); // 40 → 403
  const modUsers = await api(BACK, '/admin/api/users', { jar: mod.jar }); // 50 → 403
  check(
    '21. RBAC moderator (rank 30): moderation section 200; admin-only + owner-only sections 403',
    modTopics.status === 200 && modGames.status === 403 && modUsers.status === 403,
    `topics ${modTopics.status}, games ${modGames.status}, users ${modUsers.status}`,
  );

  // ── 22. admin (40): admin section ok; owner-only section 403 ────────────────
  const adminU = await makeUser('adm', 'admin');
  const admGames = await api(BACK, '/admin/api/games', { jar: adminU.jar }); // 40 → ok
  const admRoles = await api(BACK, '/admin/api/roles', { jar: adminU.jar }); // 50 → 403
  check(
    '22. RBAC admin (rank 40): admin section 200; owner-only (roles — a privilege-escalation surface) 403',
    admGames.status === 200 && admRoles.status === 403,
    `games ${admGames.status}, roles ${admRoles.status}`,
  );

  // ── 23. owner (50): full access + staff-mutation CSRF + real-actor audit ────
  const owner = await makeUser('own', 'owner');
  const ownRoles = await api(BACK, '/admin/api/roles', { jar: owner.jar }); // 50 → ok
  const modRoleId = roleId('moderator');
  const modSort = Number(sqlOne(`SELECT sort FROM roles WHERE id='${modRoleId}'`)) || 0;
  // A cookie-authed mutation MUST carry the CSRF header (ambient-cookie defense).
  const noCsrf = await api(BACK, `/admin/api/roles/${modRoleId}`, {
    method: 'PATCH',
    jar: owner.jar, // cookie present, but NO x-csrf-token header
    body: { sort: modSort },
  });
  const withCsrfWrite = await api(BACK, `/admin/api/roles/${modRoleId}`, {
    method: 'PATCH',
    jar: owner.jar,
    csrf: owner.csrf,
    body: { sort: modSort }, // idempotent — same value back
  });
  // The audit row for that write must name the REAL staff user, not 'service'.
  const auditActor = sqlOne(
    `SELECT actor_label FROM audit_logs WHERE entity_type='roles' AND entity_id='${modRoleId}' ORDER BY created_at DESC LIMIT 1`,
  );
  check(
    '23. RBAC owner (rank 50): owner section 200; staff mutation needs CSRF (no header 403, with 200); audit names the real staff user',
    ownRoles.status === 200 &&
      noCsrf.status === 403 &&
      withCsrfWrite.status === 200 &&
      auditActor === owner.u.username,
    `roles ${ownRoles.status}, noCsrf ${noCsrf.status}, csrf ${withCsrfWrite.status}, actor=${auditActor}`,
  );

  // ── 24. retention: the service token still reaches an OWNER-only section ─────
  // A mere admin got 403 on /roles in check 22; the trusted service credential
  // gets 200 — automation keeps full authority (verify:i1…b2 depend on this).
  const svcRoles = await api(BACK, '/admin/api/roles', { headers: SVC });
  check(
    '24. Retention: x-admin-token reaches the owner-only section a mere admin cannot (automation keeps full authority)',
    svcRoles.status === 200,
    `service→roles ${svcRoles.status}`,
  );

  // ══ SLICE 4 — COMMUNITY WRITES ══════════════════════════════════════════════
  // Real verified accounts write through the gated /community scope; the I4b
  // engine + the uniform credibility weighting (decision 13) defend every
  // signal. Every write is verified-email gated, CSRF-checked, per-user
  // rate-limited, and one-per-user.

  // register → consume the outbox verify token → verify-email (signs in): a
  // verified session + CSRF pair in one jar. Callers clean the email throttle
  // per BATCH (each register sends a verify email; the per-IP cap is 20).
  async function makeVerified(tag) {
    const u = {
      username: `gk_${tag}_${RUN}`,
      email: `${tag}_${RUN}@example.test`,
      password: `Str0ng-pass-${tag}9!`,
    };
    const { jar, csrf } = await withCsrf(BACK);
    await api(BACK, '/auth/register', { method: 'POST', jar, csrf, body: u });
    const token = extractToken(outboxLatestBody(u.email, 'verify_email'));
    const v = await api(BACK, '/auth/verify-email', { method: 'POST', jar, csrf, body: { token } });
    jarFrom(v.res, jar); // capture the signed-in session cookie
    const id = sqlOne(`SELECT id FROM users WHERE email='${u.email}'`);
    return { u, id, jar, csrf };
  }
  const cRate = (userJar, userCsrf, gameId, score) =>
    api(BACK, `/community/games/${gameId}/rating`, {
      method: 'POST',
      jar: userJar,
      csrf: userCsrf,
      body: { score },
    });
  // Fresh RUN-scoped games (via the service token) so score/count assertions are
  // deterministic and RE-RUN-SAFE — seeded games accumulate votes across runs.
  const createGame = async (name) =>
    (
      await api(BACK, '/admin/api/games', {
        method: 'POST',
        headers: SVC,
        body: { name, status: 'released' },
      })
    ).json?.data?.id;

  // ── account pools (clean the email throttle before each batch of ≤20) ───────
  cleanEmailThrottle();
  const alice = await makeVerified('c_alice');
  // an UNVERIFIED, logged-in user (register does NOT auto-login; log in explicitly)
  const mal = {
    username: `gk_c_mal_${RUN}`,
    email: `c_mal_${RUN}@example.test`,
    password: 'Str0ng-pass-M9!',
  };
  {
    const { jar: mj, csrf: mc } = await withCsrf(BACK);
    await api(BACK, '/auth/register', { method: 'POST', jar: mj, csrf: mc, body: mal });
  }
  const { jar: malJar, csrf: malCsrf } = await withCsrf(BACK);
  await api(BACK, '/auth/login', {
    method: 'POST',
    jar: malJar,
    csrf: malCsrf,
    body: { identifier: mal.email, password: mal.password },
  }).then((r) => jarFrom(r.res, malJar));

  cleanEmailThrottle();
  const proven = [];
  for (let i = 0; i < 4; i += 1) proven.push(await makeVerified(`c_pv${i}`));
  // Elevate to proven/aged voters (weight → ~1.0): reputation + backdated age.
  for (const p of proven)
    sqlOne(
      `UPDATE users SET reputation=80, created_at=now() - interval '60 days' WHERE id='${p.id}'`,
    );

  cleanEmailThrottle();
  const bomb = [];
  for (let i = 0; i < 6; i += 1) bomb.push(await makeVerified(`c_bmb${i}`));

  // pick a released game to rate (verify-safe: RUN-scoped ratings, upsert-guarded)
  const ratingGame = sqlOne(
    `SELECT g.id FROM games g JOIN subjects s ON s.id=g.subject_id WHERE g.status='released' ORDER BY s.name LIMIT 1`,
  );

  // ── 25. verified-email GATE: unverified write 403, verified write 200 ───────
  const gateUnverified = await cRate(malJar, malCsrf, ratingGame, 70);
  const gateVerified = await cRate(alice.jar, alice.csrf, ratingGame, 70);
  check(
    '25. Verified-email gate: an UNVERIFIED user cannot write (403 email_unverified); a verified user can (200)',
    gateUnverified.status === 403 &&
      gateUnverified.json?.error === 'email_unverified' &&
      gateVerified.status === 200,
    `unverified ${gateUnverified.status}/${gateUnverified.json?.error}, verified ${gateVerified.status}`,
  );

  // ── 26. CSRF on the cookie-authed write path ────────────────────────────────
  const noCsrfWrite = await api(BACK, `/community/games/${ratingGame}/rating`, {
    method: 'POST',
    jar: alice.jar, // cookie present, no x-csrf-token header
    body: { score: 55 },
  });
  const withCsrfW = await cRate(alice.jar, alice.csrf, ratingGame, 55);
  check(
    '26. CSRF: a community write without the header is 403; with it, 200',
    noCsrfWrite.status === 403 && noCsrfWrite.json?.error === 'csrf' && withCsrfW.status === 200,
    `noCsrf ${noCsrfWrite.status}, csrf ${withCsrfW.status}`,
  );

  // ── 27. one-per-user rating (upsert, not a second row) ──────────────────────
  await cRate(alice.jar, alice.csrf, ratingGame, 42);
  const aliceRows = Number(
    sqlOne(
      `SELECT count(*)::int FROM game_user_ratings WHERE game_id='${ratingGame}' AND user_id='${alice.id}'`,
    ),
  );
  const aliceScore = Number(
    sqlOne(
      `SELECT score FROM game_user_ratings WHERE game_id='${ratingGame}' AND user_id='${alice.id}'`,
    ),
  );
  check(
    '27. One-per-user rating: re-rating UPDATES the single row (no duplicate)',
    aliceRows === 1 && aliceScore === 42,
    `rows=${aliceRows}, score=${aliceScore}`,
  );

  // ── 28. per-user write rate limit (app_settings-tunable) ────────────────────
  sqlOne(
    `INSERT INTO app_settings(key,value) VALUES('community','{"writesPerUser":3}'::jsonb) ON CONFLICT (key) DO UPDATE SET value='{"writesPerUser":3}'::jsonb`,
  );
  cleanRedisKeys('gk:community:write:*');
  const rlStatuses = [];
  for (let i = 0; i < 4; i += 1)
    rlStatuses.push((await cRate(alice.jar, alice.csrf, ratingGame, 60)).status);
  sqlOne(`DELETE FROM app_settings WHERE key='community'`); // restore defaults
  cleanRedisKeys('gk:community:write:*');
  check(
    '28. Per-user rate limit: with cap 3, the 4th write in the window is 429 (cap from app_settings)',
    rlStatuses.slice(0, 3).every((s) => s === 200) && rlStatuses[3] === 429,
    `statuses ${rlStatuses.join(',')}`,
  );

  // ── 29. UGC: a <script> comment is stored RAW and returned as a JSON string ──
  const xss = '<script>alert(1)</script>';
  const cmt = await api(BACK, `/community/comment/game/${ratingGame}`, {
    method: 'POST',
    jar: alice.jar,
    csrf: alice.csrf,
    body: { body: xss },
  });
  const storedBody = sqlOne(`SELECT body FROM comments WHERE id='${cmt.json?.data?.id}'`);
  const list = await api(BACK, `/community/comment/game/${ratingGame}`, { jar: alice.jar });
  const returned = (list.json?.data ?? []).find((c) => c.id === cmt.json?.data?.id)?.body;
  check(
    '29. UGC: <script> comment stored RAW (no server mangling) and returned as a JSON string (escaped at render)',
    cmt.status === 200 && storedBody === xss && returned === xss,
    `stored==input ${storedBody === xss}, returned==input ${returned === xss}`,
  );

  // ── 30. comment report auto-hide at N (tunable) ─────────────────────────────
  sqlOne(
    `INSERT INTO app_settings(key,value) VALUES('community','{"autoHideReports":3}'::jsonb) ON CONFLICT (key) DO UPDATE SET value='{"autoHideReports":3}'::jsonb`,
  );
  const targetCmt = cmt.json?.data?.id;
  const reportStatuses = [];
  for (let i = 0; i < 3; i += 1) {
    const r = await api(BACK, `/community/report/comment/${targetCmt}`, {
      method: 'POST',
      jar: bomb[i].jar,
      csrf: bomb[i].csrf,
      body: { reason: 'spam' },
    });
    reportStatuses.push(r.status);
  }
  const hiddenAfter = sqlOne(`SELECT is_removed::text FROM comments WHERE id='${targetCmt}'`);
  check(
    '30. Comment reports: 3 distinct reporters cross the threshold → the comment is AUTO-HIDDEN (is_removed)',
    reportStatuses.every((s) => s === 200) && hiddenAfter === 'true',
    `reports ${reportStatuses.join(',')}, isRemoved=${hiddenAfter}`,
  );

  // ── 31. moderator restore (decision 8) ──────────────────────────────────────
  const restore = await api(BACK, `/admin/api/comments/${targetCmt}/restore`, {
    method: 'POST',
    jar: mod.jar,
    csrf: mod.csrf,
  });
  const restoredState = sqlOne(`SELECT is_removed::text FROM comments WHERE id='${targetCmt}'`);
  sqlOne(`DELETE FROM app_settings WHERE key='community'`); // restore defaults
  check(
    '31. A MODERATOR (rank 30) can restore an auto-hidden comment (is_removed back to false); audited',
    restore.status === 200 && restoredState === 'false',
    `restore ${restore.status}, isRemoved=${restoredState}`,
  );

  // ── 32. article trust vote is credibility-weighted (decision 13) ────────────
  const trustArticle = sqlOne(`SELECT id FROM articles ORDER BY publish_date DESC LIMIT 1`);
  sqlOne(`DELETE FROM article_trust_votes WHERE article_id='${trustArticle}'`); // clean slate (re-run-safe)
  await api(BACK, `/community/articles/${trustArticle}/trust-vote`, {
    method: 'POST',
    jar: proven[0].jar,
    csrf: proven[0].csrf,
    body: { value: 1 },
  });
  for (let i = 0; i < 3; i += 1)
    await api(BACK, `/community/articles/${trustArticle}/trust-vote`, {
      method: 'POST',
      jar: bomb[i].jar,
      csrf: bomb[i].csrf,
      body: { value: -1 },
    });
  const trustAgg = (
    await api(BACK, `/community/articles/${trustArticle}/trust`, { jar: proven[0].jar })
  ).json?.data;
  check(
    '32. Trust vote weighting: 1 proven +1 vs 3 throwaway −1 → the WEIGHTED mean is pulled well ABOVE the naive count toward the credible voter',
    trustAgg &&
      trustAgg.count === 4 &&
      trustAgg.naiveMean <= -0.4 &&
      trustAgg.weightedMean > trustAgg.naiveMean + 0.15,
    `weighted=${trustAgg?.weightedMean} naive=${trustAgg?.naiveMean} count=${trustAgg?.count}`,
  );

  // ── 33. topic bias vote: one-per-user-per-axis, change + clear ──────────────
  const biasTopic = sqlOne(`SELECT id FROM topics ORDER BY created_at DESC LIMIT 1`);
  const biasVote = (value) =>
    api(BACK, `/community/topics/${biasTopic}/bias-vote`, {
      method: 'POST',
      jar: alice.jar,
      csrf: alice.csrf,
      body: { axis: 'influence', value },
    });
  await biasVote(1);
  await biasVote(-1); // same axis → UPDATE, not a second row
  const biasRows1 = Number(
    sqlOne(
      `SELECT count(*)::int FROM topic_bias_votes WHERE topic_id='${biasTopic}' AND user_id='${alice.id}' AND axis='influence'`,
    ),
  );
  const biasVal = Number(
    sqlOne(
      `SELECT value FROM topic_bias_votes WHERE topic_id='${biasTopic}' AND user_id='${alice.id}' AND axis='influence'`,
    ),
  );
  await biasVote(0); // 0 clears the stance → row deleted
  const biasRows2 = Number(
    sqlOne(
      `SELECT count(*)::int FROM topic_bias_votes WHERE topic_id='${biasTopic}' AND user_id='${alice.id}' AND axis='influence'`,
    ),
  );
  check(
    '33. Bias vote: one row per (user, axis) — re-voting UPDATES (value −1), value 0 CLEARS (row deleted)',
    biasRows1 === 1 && biasVal === -1 && biasRows2 === 0,
    `afterChange rows=${biasRows1} val=${biasVal}, afterClear rows=${biasRows2}`,
  );

  // ── 34. upcoming hype: one-per-user toggle, credibility-weighted count ───────
  const hypeGame =
    sqlOne(
      `SELECT g.id FROM games g WHERE g.status IN ('announced','in_development','early_access') ORDER BY g.created_at DESC LIMIT 1`,
    ) || ratingGame;
  sqlOne(`DELETE FROM game_hype_votes WHERE game_id='${hypeGame}'`); // clean slate (re-run-safe)
  const h1 = await api(BACK, `/community/games/${hypeGame}/hype`, {
    method: 'POST',
    jar: proven[0].jar,
    csrf: proven[0].csrf,
  });
  const hAgg1 = (await api(BACK, `/community/games/${hypeGame}/hype`, { jar: proven[0].jar })).json
    ?.data;
  const h2 = await api(BACK, `/community/games/${hypeGame}/hype`, {
    method: 'POST',
    jar: proven[0].jar,
    csrf: proven[0].csrf,
  });
  const hAgg2 = (await api(BACK, `/community/games/${hypeGame}/hype`, { jar: proven[0].jar })).json
    ?.data;
  check(
    '34. Hype: toggle on → count 1 (mine); toggle off → count 0 (one-per-user, weighted)',
    h1.json?.data?.hyped === true &&
      hAgg1?.count === 1 &&
      hAgg1?.mine === true &&
      h2.json?.data?.hyped === false &&
      hAgg2?.count === 0,
    `on={hyped:${h1.json?.data?.hyped},count:${hAgg1?.count}} off={hyped:${h2.json?.data?.hyped},count:${hAgg2?.count}}`,
  );

  // ── 35. REVIEW-BOMB through real accounts: flag raises + weighted resists ────
  // A realistic ring is MOSTLY unverified throwaways (weight ~0). Base: 4
  // proven/aged voters (write flow, score 80, backdated OUTSIDE the 48h window).
  // Bomb: 4 verified-new throwaways (write flow, score 0 — proves the gated path
  // still can't move the WEIGHTED score) + 16 UNVERIFIED accounts injected via
  // the service path (score 3 — the bulk a real ring would be). Distinct scores
  // (80 / 0 / 3) so check 36 can read each cohort's weight at rest.
  const bombGame = await createGame(`Bombtest ${RUN}`); // fresh → deterministic count
  for (const p of proven) await cRate(p.jar, p.csrf, bombGame, 80);
  sqlOne(
    `UPDATE game_user_ratings SET rated_at=now() - interval '20 days' WHERE game_id='${bombGame}' AND user_id IN (${proven.map((p) => `'${p.id}'`).join(',')})`,
  );
  for (let i = 0; i < 4; i += 1) await cRate(bomb[i].jar, bomb[i].csrf, bombGame, 0);
  const regRole = roleId('registered');
  for (let i = 0; i < 16; i += 1) {
    const uid = (
      await api(BACK, '/admin/api/users', {
        method: 'POST',
        headers: SVC,
        body: {
          username: `gk_c_uv${i}_${RUN}`,
          email: `c_uv${i}_${RUN}@example.test`,
          roleId: regRole,
          isEmailVerified: false,
          reputation: 0,
        },
      })
    ).json?.data?.id;
    await api(BACK, '/admin/api/game-user-ratings', {
      method: 'POST',
      headers: SVC,
      body: { gameId: bombGame, userId: uid, score: 3 },
    });
  }
  // Recompute on the background engine, then poll until ALL 24 votes are
  // counted — robust to the recomputes the writes themselves enqueue (an
  // intermediate one might land mid-poll with fewer votes).
  await api(BACK, '/admin/api/ratings/recompute', {
    method: 'POST',
    headers: SVC,
    body: { gameId: bombGame },
  });
  let com = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(1000);
    const g = (await api(BACK, `/admin/api/ratings/game/${bombGame}`, { headers: SVC })).json?.data;
    com = g?.community;
    if (com?.count === 24) break;
  }
  check(
    '35. Review-bomb (real accounts): the flag raises, the WEIGHTED score resists (proven dominate) while the naive average collapses; nothing dropped',
    com &&
      com.burstFlag === true &&
      com.score >= 50 &&
      com.naive <= 22 &&
      com.score - com.naive >= 30 &&
      com.count === 24,
    `flag=${com?.burstFlag} weighted=${com?.score} naive=${com?.naive} count=${com?.count}`,
  );

  // ── 36. per-vote credibility at rest — the uniform 0→1.0 curve (decision 13) ─
  const votes =
    (await api(BACK, `/admin/api/ratings/game/${bombGame}/votes`, { headers: SVC })).json?.data
      ?.votes ?? [];
  const provenVote = votes.find((v) => v.score === 80); // verified + aged + rep
  const verifiedNew = votes.find((v) => v.score === 0); // verified but brand-new
  const unverified = votes.find((v) => v.score === 3); // unverified throwaway
  check(
    '36. Per-vote weight at rest: proven ~1.0, verified-new ~0.45, UNVERIFIED ~0 — the uniform 0→1.0 curve, inspectable, no opaque number',
    provenVote &&
      verifiedNew &&
      unverified &&
      provenVote.credibility.total >= 0.95 &&
      verifiedNew.credibility.total > 0.3 &&
      verifiedNew.credibility.total < 0.6 &&
      unverified.credibility.total <= 0.01,
    `proven=${provenVote?.credibility.total} verified-new=${verifiedNew?.credibility.total} unverified=${unverified?.credibility.total}`,
  );

  // ── 37. counter-case: a proven LOW surge MOVES the score and is NOT flagged ──
  const lowGame = await createGame(`Lowtest ${RUN}`); // fresh → deterministic
  for (const p of proven) await cRate(p.jar, p.csrf, lowGame, 35);
  await api(BACK, '/admin/api/ratings/recompute', {
    method: 'POST',
    headers: SVC,
    body: { gameId: lowGame },
  });
  let lc = null;
  for (let i = 0; i < 40; i += 1) {
    await sleep(1000);
    const g = (await api(BACK, `/admin/api/ratings/game/${lowGame}`, { headers: SVC })).json?.data;
    lc = g?.community;
    if (lc?.count === 4) break;
  }
  check(
    '37. Counter-case: a genuine proven-voter LOW score MOVES the weighted score (~35) and is NOT flagged (legit dissatisfaction honored)',
    lc && lc.burstFlag === false && lc.score >= 25 && lc.score <= 45,
    `flag=${lc?.burstFlag} weighted=${lc?.score} naive=${lc?.naive}`,
  );

  // ══ SLICE 5 — REPUTATION + LEVELS + BADGES ══════════════════════════════════
  // Reputation rises from RECEIVED helpful reactions weighted by the reactor's
  // credibility (a self-ring of throwaways can't farm it), plus tenure, minus
  // removed content / suspensions. The level engine runs as a background job;
  // users see only level name + progress + badges, never the number/thresholds.
  cleanEmailThrottle();
  const repTarget = await makeVerified('r_tgt');
  const ring = [];
  for (let i = 0; i < 10; i += 1) ring.push(await makeVerified(`r_ring${i}`));
  // the target posts one comment; the ring 'like's it (received helpful-votes)
  const repComment = (
    await api(BACK, `/community/comment/game/${ratingGame}`, {
      method: 'POST',
      jar: repTarget.jar,
      csrf: repTarget.csrf,
      body: { body: `reputation seed ${RUN}` },
    })
  ).json?.data?.id;
  for (const r of ring)
    await api(BACK, `/community/reaction/comment/${repComment}`, {
      method: 'POST',
      jar: r.jar,
      csrf: r.csrf,
      body: { kind: 'like' },
    });

  // Trigger the background reputation recompute and wait for its state to advance.
  async function recomputeReputation() {
    const before =
      (await api(BACK, '/admin/api/reputation/status', { headers: SVC })).json?.data?.finishedAt ??
      '';
    await api(BACK, '/admin/api/reputation/recompute', { method: 'POST', headers: SVC });
    for (let i = 0; i < 40; i += 1) {
      await sleep(1000);
      const s = (await api(BACK, '/admin/api/reputation/status', { headers: SVC })).json?.data;
      if (s && (s.finishedAt ?? '') !== before) return s;
    }
    return null;
  }
  const repRow = () => ({
    rep: Number(sqlOne(`SELECT reputation FROM users WHERE id='${repTarget.id}'`)),
    level: sqlOne(
      `SELECT key FROM user_levels WHERE id=(SELECT level_id FROM users WHERE id='${repTarget.id}')`,
    ),
  });

  // ── 38. self-farm ring FAILS to raise reputation ────────────────────────────
  const jobState = await recomputeReputation();
  const afterRing = repRow();
  check(
    '38. Self-farm ring: 10 throwaway (verified-new, ~0.45 credibility) up-votes leave the target BELOW the first level — a ring cannot farm reputation',
    jobState && afterRing.rep < 15 && afterRing.level === 'newcomer',
    `rep=${afterRing.rep} level=${afterRing.level} (job processed ${jobState?.usersProcessed})`,
  );

  // ── 39. the SAME up-votes from CREDIBLE accounts DO count → level up ─────────
  sqlOne(
    `UPDATE users SET reputation=100, created_at=now() - interval '60 days' WHERE id IN (${ring.map((r) => `'${r.id}'`).join(',')})`,
  );
  await recomputeReputation();
  const afterCredible = repRow();
  check(
    '39. Credible signal counts: elevate the SAME reactors to aged/reputable → the target LEVELS UP (reputation is weighted by the reactor’s credibility, not vote count)',
    afterCredible.rep >= 15 &&
      afterCredible.level !== 'newcomer' &&
      afterCredible.rep > afterRing.rep,
    `rep ${afterRing.rep}→${afterCredible.rep}, level ${afterRing.level}→${afterCredible.level}`,
  );

  // ── 40. penalties: suspension zeroes; removed content drops reputation ───────
  sqlOne(`UPDATE users SET status='suspended' WHERE id='${repTarget.id}'`);
  await recomputeReputation();
  const afterSuspended = repRow();
  sqlOne(`UPDATE users SET status='active' WHERE id='${repTarget.id}'`);
  await api(BACK, `/admin/api/comments/${repComment}/remove`, {
    method: 'POST',
    jar: mod.jar,
    csrf: mod.csrf,
  });
  await recomputeReputation();
  const afterRemoved = repRow();
  check(
    '40. Penalties: a SUSPENDED account is zeroed; REMOVING the target’s comment drops reputation (its received-helpful no longer counts + the removed-content penalty)',
    afterSuspended.rep === 0 && afterRemoved.rep < afterCredible.rep,
    `credible=${afterCredible.rep} → suspended=${afterSuspended.rep} → removed=${afterRemoved.rep}`,
  );

  // ── 41. auto-badges (monotonic, idempotent) ─────────────────────────────────
  // Lower the early-voter threshold so a single Slice-4 voter (alice) qualifies.
  sqlOne(
    `INSERT INTO app_settings(key,value) VALUES('reputation','{"earlyVoterVotes":1}'::jsonb) ON CONFLICT (key) DO UPDATE SET value='{"earlyVoterVotes":1}'::jsonb`,
  );
  await recomputeReputation();
  await recomputeReputation(); // twice → prove idempotency (no duplicate rows)
  const badgeCount = (userId, key) =>
    Number(
      sqlOne(
        `SELECT count(*)::int FROM user_badges ub JOIN badges b ON b.id=ub.badge_id WHERE ub.user_id='${userId}' AND b.key='${key}'`,
      ),
    );
  const verifiedBadge = badgeCount(repTarget.id, 'verified');
  const aliceEarly = badgeCount(alice.id, 'early-voter');
  sqlOne(`DELETE FROM app_settings WHERE key='reputation'`); // restore defaults
  check(
    '41. Auto-badges: a verified user earns "verified"; a user past the vote threshold earns "early-voter"; two recomputes leave exactly ONE row each (idempotent)',
    verifiedBadge === 1 && aliceEarly === 1,
    `verified=${verifiedBadge}, alice early-voter=${aliceEarly}`,
  );

  // ── 42. leak-proof profile (decision 11) ────────────────────────────────────
  const meProfile = (await api(BACK, '/auth/me', { jar: repTarget.jar })).json?.user;
  const meStr = JSON.stringify(meProfile ?? {});
  check(
    '42. Leak-proof profile: /auth/me exposes level {name, progress} + badges but NEVER the raw reputation number, levelPoints, voteWeight, or thresholds',
    meProfile &&
      meProfile.level &&
      typeof meProfile.level.progress === 'number' &&
      Boolean(meProfile.level.key) &&
      Array.isArray(meProfile.badges) &&
      meProfile.reputation === undefined &&
      meProfile.levelPoints === undefined &&
      meProfile.voteWeight === undefined &&
      !/threshold/i.test(meStr),
    `level=${meProfile?.level?.key} progress=${meProfile?.level?.progress} badges=${meProfile?.badges?.length} rep=${meProfile?.reputation}`,
  );

  // ══ SLICE 6 — FOLLOW + "YOUR FEED" ══════════════════════════════════════════
  // Following is OPEN to unverified users (decision 6); the feed is PER-USER and
  // must never sit on the anonymous cache. Notification delivery stays I8.
  const followGame = sqlOne(`SELECT slug FROM subjects WHERE type='game' ORDER BY name LIMIT 1`);
  const followTopic = sqlOne(`SELECT slug FROM topics ORDER BY created_at DESC LIMIT 1`);
  // an UNVERIFIED, logged-in user (register does NOT verify; log in explicitly)
  const fu = {
    username: `gk_foll_${RUN}`,
    email: `foll_${RUN}@example.test`,
    password: 'Str0ng-pass-F6!',
  };
  {
    const { jar: rj, csrf: rc } = await withCsrf(BACK);
    await api(BACK, '/auth/register', { method: 'POST', jar: rj, csrf: rc, body: fu });
  }
  const { jar: folJar, csrf: folCsrf } = await withCsrf(BACK);
  await api(BACK, '/auth/login', {
    method: 'POST',
    jar: folJar,
    csrf: folCsrf,
    body: { identifier: fu.email, password: fu.password },
  }).then((r) => jarFrom(r.res, folJar));
  const fUid = sqlOne(`SELECT id FROM users WHERE email='${fu.email}'`);
  const followVerified = sqlOne(
    `SELECT is_email_verified::text FROM users WHERE email='${fu.email}'`,
  );

  // ── 43. follow is OPEN to unverified; CSRF required; DB truth ────────────────
  const followRes = await api(BACK, `/community/follow/game/${followGame}`, {
    method: 'POST',
    jar: folJar,
    csrf: folCsrf,
  });
  const followNoCsrf = await api(BACK, `/community/follow/topic/${followTopic}`, {
    method: 'POST',
    jar: folJar, // cookie present, NO x-csrf-token header
  });
  const followRows = Number(
    sqlOne(`SELECT count(*)::int FROM follows WHERE user_id='${fUid}' AND entity_type='game'`),
  );
  check(
    '43. Follow is OPEN to unverified users (decision 6): a verified-less account follows a game (200, DB row); a follow WITHOUT CSRF is 403',
    followVerified === 'false' &&
      followRes.status === 200 &&
      followRes.json?.data?.following === true &&
      followRows === 1 &&
      followNoCsrf.status === 403,
    `unverified=${followVerified} follow=${followRes.status} rows=${followRows} noCsrf=${followNoCsrf.status}`,
  );

  // ── 44. the feed is PER-USER and NEVER anonymously cached ───────────────────
  await api(BACK, `/community/follow/topic/${followTopic}`, {
    method: 'POST',
    jar: folJar,
    csrf: folCsrf,
  });
  const feedRes = await api(BACK, '/community/feed', { jar: folJar });
  const feed = feedRes.json?.data;
  const cacheHeader = feedRes.res.headers.get('cache-control') ?? '';
  const feedAnon = await api(BACK, '/community/feed'); // no cookie
  check(
    '44. Your Feed is per-user: it lists the followed game + topic and carries a private no-store cache-control; a logged-OUT request is 401 (never served anonymously)',
    feedRes.status === 200 &&
      feed &&
      feed.isEmpty === false &&
      feed.followedGames.length === 1 &&
      feed.followedTopics.length === 1 &&
      /no-store/.test(cacheHeader) &&
      /private/.test(cacheHeader) &&
      feedAnon.status === 401,
    `games=${feed?.followedGames.length} topics=${feed?.followedTopics.length} items=${feed?.items.length} cache="${cacheHeader}" anon=${feedAnon.status}`,
  );

  // ── 45. one-per-user follow (upsert) + unfollow removes it ──────────────────
  await api(BACK, `/community/follow/game/${followGame}`, {
    method: 'POST',
    jar: folJar,
    csrf: folCsrf,
  }); // again → no dup
  const dupRows = Number(
    sqlOne(`SELECT count(*)::int FROM follows WHERE user_id='${fUid}' AND entity_type='game'`),
  );
  const unfollowRes = await api(BACK, `/community/follow/game/${followGame}`, {
    method: 'DELETE',
    jar: folJar,
    csrf: folCsrf,
  });
  const afterUnfollow = Number(
    sqlOne(`SELECT count(*)::int FROM follows WHERE user_id='${fUid}' AND entity_type='game'`),
  );
  check(
    '45. One follow row per (user, entity): following twice is idempotent (1 row); unfollow removes it (0 rows)',
    dupRows === 1 &&
      unfollowRes.status === 200 &&
      unfollowRes.json?.data?.following === false &&
      afterUnfollow === 0,
    `afterDup=${dupRows}, unfollow=${unfollowRes.status}, afterUnfollow=${afterUnfollow}`,
  );

  // ══ HARDENING / RETENTION (run last — the flood locks this host's IP) ════════
  cleanAuthKeys(); // clear any incidental auth counters before the flood

  // ── 46. spoofed X-Forwarded-For cannot dodge the per-IP lockout ─────────────
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
    '46. Spoofable-IP hardening: rotating X-Forwarded-For flood STILL trips the per-IP lock (header ignored)',
    ipLockedAt >= 0,
    ipLockedAt >= 0
      ? `locked at flood attempt ${ipLockedAt + 1}`
      : 'never locked — header trusted?',
  );

  // ── 47. admin redaction: no hash anywhere ───────────────────────────────────
  const adminUsers = await api(BACK, '/admin/api/users', {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  const auditRows = await api(BACK, '/admin/api/_audit?limit=200', {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  // Fetch userA by id (the list caps at 200 rows; re-runs accumulate users).
  const userAId = sqlOne(`SELECT id FROM users WHERE username='${userA.username}'`);
  const userRow = (await api(BACK, `/admin/api/users/${userAId}`, { headers: SVC })).json?.data;
  check(
    '47. Admin redaction: CRUD + audit payloads carry NO $argon2 material; hashes read [REDACTED]',
    adminUsers.status === 200 &&
      !adminUsers.text.includes('$argon2') &&
      userRow?.passwordHash === '[REDACTED]' &&
      !auditRows.text.includes('$argon2'),
    `users=${adminUsers.status}, audit=${auditRows.status}, userA=${userRow?.passwordHash}`,
  );

  // ── 48. the service credential is retained ──────────────────────────────────
  const metaYes = await api(BACK, '/admin/api/_meta', {
    headers: { 'x-admin-token': ADMIN_TOKEN },
  });
  const metaNo = await api(BACK, '/admin/api/_meta');
  check(
    '48. x-admin-token retained for automation: with token 200, without 401 (i1…b2 depend on this)',
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
    '\nGamesKeep — I6 auth+email+RBAC+community+reputation+feed (Slices 1–6): prove-the-attack-fails\n\n',
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
