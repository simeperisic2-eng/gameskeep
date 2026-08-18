#!/usr/bin/env node
/**
 * GamesKeep — I7 (Awards) verification. Slice 1: the voting + outcomes engine.
 * Every check PROVES AN ATTACK / RULE on the live stack, on a THROWAWAY edition
 * (never the demo 2026 edition), and cleans up after itself.
 *
 *  Slice 1 — voting + outcomes engine
 *   2.  setup: throwaway edition + category + 2 nominees (games) created
 *   3.  gate: an unauthenticated vote (valid CSRF, no session) → 401
 *   4.  gate: a signed-in but UNVERIFIED user cannot vote → 403
 *   5.  gate: a verified vote WITHOUT the CSRF header → 403
 *   6.  closed: voting while the edition is unpublished/not-in-phase → 409
 *   7.  bad nominee: a vote for a nomination not in the category → 400
 *   8.  happy path: a verified vote is accepted; the tally counts it
 *   9.  weighting: the per-vote weight is a real 0<w<1 credibility (not 0, not 1)
 *  10.  one-per-category: a re-vote MOVES the vote (unique index), never dupes
 *  11.  retract: deleting the vote removes it from the tally
 *  12.  Community Choice = the credibility-WEIGHTED winner (2 votes beat 1)
 *  13.  Critics' Choice = auto-SUGGESTED from the top critic score (≠ community)
 *  14.  staff-confirmed: a staff override of Critics' Choice SURVIVES a re-compute
 *       (insert-if-absent) while Community Choice re-computes fresh
 *  15.  leak-proof: the public tally exposes no voter identity
 *
 *  Slice 2 — subscribe capture (marketing consent) + staff control + analytics
 *  16.  subscribe WITHOUT explicit consent → 400 (no row created)
 *  17.  anonymous subscribe records a row: versioned marketing consent + a
 *       COARSENED ip + an unsubscribe token (same treatment as a registered user)
 *  18.  a REGISTERED subscribe ALSO writes a user_consents kind='marketing'
 *       granted=true row (reuses the existing consent path, not a new one)
 *  19.  subscribe is idempotent — one row per email (a re-subscribe reactivates)
 *  20.  unsubscribe via the capability token deactivates the row
 *  21.  a REGISTERED unsubscribe records the marketing consent WITHDRAWAL
 *  22.  guarded phase: opening `voting` unpublished/without a window → 409, then
 *       publish + window → the transition succeeds
 *  23.  entering `reveal` AUTO-computes the outcomes
 *  24.  analytics is correct + leak-proof (voters/votes/subscribers, no identity)
 *  25.  account deletion scrubs the subscription (the email is PII)
 *
 * Run after `npm run demo:up`: `npm run verify:i7`.
 */
import { execSync } from 'node:child_process';

const BACK = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;
const ADMIN_TOKEN = process.env.ADMIN_API_TOKEN ?? 'demo-admin-token';
const SVC = { 'x-admin-token': ADMIN_TOKEN };
const RUN = Date.now().toString(36);

const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });
const check = (name, cond, detail = '') => {
  record(name, Boolean(cond), detail);
  return Boolean(cond);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const cleanEmailThrottle = () => cleanRedisKeys('gk:email:send:*');

function outboxLatestBody(email, purpose) {
  return sqlOne(
    `SELECT body_text FROM email_outbox WHERE to_email='${email}' AND purpose='${purpose}' ORDER BY created_at DESC LIMIT 1`,
  );
}
function extractToken(body) {
  const m = (body ?? '').match(/token=([a-f0-9]{64})/);
  return m ? m[1] : '';
}

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
      if (j.status === 'ready') return true;
    } catch {
      /* not up yet */
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
  cleanEmailThrottle();
  if (!check('1. Stack ready (backend)', await waitForReady())) return print();

  // register → consume the outbox verify token → verify-email (signs in).
  async function makeVerified(tag) {
    const u = {
      username: `gk_i7_${tag}_${RUN}`,
      email: `i7_${tag}_${RUN}@example.test`,
      password: `Str0ng-pass-${tag}9!`,
    };
    const { jar, csrf } = await withCsrf(BACK);
    await api(BACK, '/auth/register', { method: 'POST', jar, csrf, body: u });
    const token = extractToken(outboxLatestBody(u.email, 'verify_email'));
    const v = await api(BACK, '/auth/verify-email', { method: 'POST', jar, csrf, body: { token } });
    jarFrom(v.res, jar);
    const id = sqlOne(`SELECT id FROM users WHERE email='${u.email}'`);
    return { u, id, jar, csrf };
  }

  const createGame = async (name) =>
    (
      await api(BACK, '/admin/api/games', {
        method: 'POST',
        headers: SVC,
        body: { name, status: 'released' },
      })
    ).json?.data?.id;
  const subjectOf = (gameId) => sqlOne(`SELECT subject_id FROM games WHERE id='${gameId}'`);
  const adminCreate = (resource, body) =>
    api(BACK, `/admin/api/${resource}`, { method: 'POST', headers: SVC, body });
  const patchEdition = (id, body) =>
    api(BACK, `/admin/api/award-editions/${id}`, { method: 'PATCH', headers: SVC, body });
  const vote = (v, ecId, nominationId, withCsrfHeader = true) =>
    api(BACK, `/awards/categories/${ecId}/vote`, {
      method: 'POST',
      jar: v.jar,
      csrf: withCsrfHeader ? v.csrf : undefined,
      body: { nominationId },
    });

  // Find a free year (descending) so we never collide with the demo 2026 edition.
  async function createEdition() {
    for (let y = 2200; y >= 1971; y -= 1) {
      const r = await adminCreate('award-editions', {
        year: y,
        name: `__i7 verify ${RUN}`,
        phase: 'announce',
        isPublished: false,
      });
      if (r.status < 300 && r.json?.data?.id) return r.json.data.id;
      if (r.status !== 409) return ''; // an unexpected error, not a year clash
    }
    return '';
  }

  // ── 2. setup ────────────────────────────────────────────────────────────────
  cleanEmailThrottle();
  const gameA = await createGame(`I7 Nominee A ${RUN}`);
  const gameB = await createGame(`I7 Nominee B ${RUN}`);
  const subA = subjectOf(gameA);
  const subB = subjectOf(gameB);
  const catId = (
    await adminCreate('award-categories', { key: `i7cat_${RUN}`, label: `I7 Test ${RUN}` })
  ).json?.data?.id;
  const edId = await createEdition();
  const ecId = (
    await adminCreate('award-edition-categories', { editionId: edId, categoryId: catId, sort: 0 })
  ).json?.data?.id;
  const nomA = (
    await adminCreate('award-nominations', { editionCategoryId: ecId, subjectId: subA })
  ).json?.data?.id;
  const nomB = (
    await adminCreate('award-nominations', { editionCategoryId: ecId, subjectId: subB })
  ).json?.data?.id;
  if (
    !check(
      '2. Setup: throwaway edition + category + 2 nominees created',
      Boolean(gameA && gameB && subA && subB && catId && edId && ecId && nomA && nomB),
      `ed=${edId ? 'ok' : 'FAIL'} ec=${ecId ? 'ok' : 'FAIL'} noms=${nomA && nomB ? 'ok' : 'FAIL'}`,
    )
  )
    return print();

  const v1 = await makeVerified('v1');
  const v2 = await makeVerified('v2');
  const v3 = await makeVerified('v3');
  const vz = await makeVerified('vz');

  // ── 3. gate: unauthenticated (valid CSRF, no session) → 401 ──────────────────
  const anon = await withCsrf(BACK); // a CSRF pair with NO session
  const anonVote = await api(BACK, `/awards/categories/${ecId}/vote`, {
    method: 'POST',
    jar: anon.jar,
    csrf: anon.csrf,
    body: { nominationId: nomA },
  });
  check(
    '3. Unauthenticated vote (CSRF ok, no session) → 401',
    anonVote.status === 401,
    `status ${anonVote.status}`,
  );

  // ── 4. gate: signed-in but UNVERIFIED → 403 ──────────────────────────────────
  const unv = {
    username: `gk_i7_unv_${RUN}`,
    email: `i7_unv_${RUN}@example.test`,
    password: 'Str0ng-pass-U9!',
  };
  {
    const { jar, csrf } = await withCsrf(BACK);
    await api(BACK, '/auth/register', { method: 'POST', jar, csrf, body: unv });
  }
  const unvSess = await withCsrf(BACK);
  const unvLogin = await api(BACK, '/auth/login', {
    method: 'POST',
    jar: unvSess.jar,
    csrf: unvSess.csrf,
    body: { identifier: unv.email, password: unv.password },
  });
  jarFrom(unvLogin.res, unvSess.jar); // capture the signed-in (but unverified) session
  const unvVote = await vote(unvSess, ecId, nomA);
  check('4. Unverified user cannot vote → 403', unvVote.status === 403, `status ${unvVote.status}`);

  // ── 5. gate: verified vote without CSRF header → 403 ─────────────────────────
  const noCsrf = await vote(v1, ecId, nomA, false);
  check(
    '5. Verified vote WITHOUT CSRF header → 403',
    noCsrf.status === 403,
    `status ${noCsrf.status}`,
  );

  // ── 6. closed: edition unpublished / not in voting phase → 409 ───────────────
  const closedVote = await vote(v1, ecId, nomA);
  check(
    '6. Voting while unpublished/not-in-phase → 409 voting_not_open',
    closedVote.status === 409 && closedVote.json?.error === 'voting_not_open',
    `status ${closedVote.status} ${closedVote.json?.error ?? ''}`,
  );

  // Open it: publish + voting phase + an open window ("turn it on").
  const past = new Date(Date.now() - 3_600_000).toISOString();
  const future = new Date(Date.now() + 3_600_000).toISOString();
  await patchEdition(edId, {
    phase: 'voting',
    isPublished: true,
    votingOpensAt: past,
    votingClosesAt: future,
  });

  // ── 7. bad nominee: a nomination not in this category → 400 ──────────────────
  const badNom = await vote(v1, ecId, 'a1b2c3d4-0000-4000-8000-000000000000');
  check(
    '7. Vote for a nominee not in the category → 400 bad_nomination',
    badNom.status === 400 && badNom.json?.error === 'bad_nomination',
    `status ${badNom.status} ${badNom.json?.error ?? ''}`,
  );

  // ── 8. happy path ────────────────────────────────────────────────────────────
  const cast1 = await vote(v1, ecId, nomA);
  const tally1 = cast1.json?.data?.tally;
  const nomARow1 = tally1?.nominees?.find((n) => n.nominationId === nomA);
  check(
    '8. Verified vote accepted; tally counts it',
    cast1.status === 200 && nomARow1?.votes === 1 && tally1?.totalVotes === 1,
    `status ${cast1.status} nomA.votes=${nomARow1?.votes} total=${tally1?.totalVotes}`,
  );

  // ── 9. weighting: a fresh verified account weighs a real 0<w<1 ───────────────
  const wDb = Number(
    sqlOne(
      `SELECT weight FROM award_votes WHERE edition_category_id='${ecId}' AND user_id='${v1.id}'`,
    ),
  );
  check(
    '9. Per-vote weight is a real credibility 0<w<1 (not 0, not 1)',
    wDb > 0.01 && wDb < 0.99,
    `weight=${wDb}`,
  );

  // ── 10. one-per-category: a re-vote MOVES the vote ───────────────────────────
  await vote(vz, ecId, nomA);
  const moved = await vote(vz, ecId, nomB);
  const mt = moved.json?.data?.tally;
  const vzOnB = mt?.nominees?.find((n) => n.nominationId === nomB)?.votes ?? 0;
  const dupRows = Number(
    sqlOne(
      `SELECT count(*) FROM award_votes WHERE edition_category_id='${ecId}' AND user_id='${vz.id}'`,
    ),
  );
  check(
    '10. Re-vote MOVES the vote (one row per user, never a duplicate)',
    moved.json?.data?.my?.nominationId === nomB && dupRows === 1 && vzOnB >= 1,
    `my=${moved.json?.data?.my?.nominationId === nomB} rows=${dupRows}`,
  );

  // ── 11. retract ──────────────────────────────────────────────────────────────
  const retract = await api(BACK, `/awards/categories/${ecId}/vote`, {
    method: 'DELETE',
    jar: vz.jar,
    csrf: vz.csrf,
  });
  const vzRows = Number(
    sqlOne(
      `SELECT count(*) FROM award_votes WHERE edition_category_id='${ecId}' AND user_id='${vz.id}'`,
    ),
  );
  check(
    '11. Retract removes the vote from the tally',
    retract.status === 200 && retract.json?.data?.my === null && vzRows === 0,
    `status ${retract.status} rows=${vzRows}`,
  );

  // ── outcome votes: v1,v2 → nomA (2), v3 → nomB (1) ───────────────────────────
  await vote(v2, ecId, nomA);
  await vote(v3, ecId, nomB);
  // critic scores: nomB's game clearly higher than nomA's (drives Critics' Choice).
  sqlOne(`INSERT INTO game_rating_summaries (game_id, critics_score) VALUES ('${gameA}', 70)`);
  sqlOne(`INSERT INTO game_rating_summaries (game_id, critics_score) VALUES ('${gameB}', 95)`);

  // ── 12 + 13. compute outcomes ────────────────────────────────────────────────
  const compute1 = await api(BACK, `/admin/api/awards/editions/${edId}/compute-outcomes`, {
    method: 'POST',
    headers: SVC,
  });
  const commWinner = sqlOne(
    `SELECT nomination_id FROM award_outcomes WHERE edition_category_id='${ecId}' AND outcome_type='community'`,
  );
  const critWinner = sqlOne(
    `SELECT nomination_id FROM award_outcomes WHERE edition_category_id='${ecId}' AND outcome_type='critics'`,
  );
  check(
    '12. Community Choice = the credibility-weighted winner (2 votes beat 1)',
    compute1.status === 200 && commWinner === nomA,
    `community=${commWinner === nomA ? 'nomA' : commWinner} (expected nomA)`,
  );
  check(
    '13. Critics Choice = auto-suggested from the top critic score (≠ community)',
    critWinner === nomB && commWinner !== critWinner,
    `critics=${critWinner === nomB ? 'nomB' : critWinner} (expected nomB)`,
  );

  // ── 14. staff-confirmed: a staff override of Critics' Choice survives re-compute
  const critOutcomeId = sqlOne(
    `SELECT id FROM award_outcomes WHERE edition_category_id='${ecId}' AND outcome_type='critics'`,
  );
  await api(BACK, `/admin/api/award-outcomes/${critOutcomeId}`, {
    method: 'PATCH',
    headers: SVC,
    body: { nominationId: nomA }, // staff overrides Critics' Choice to nomA
  });
  await api(BACK, `/admin/api/awards/editions/${edId}/compute-outcomes`, {
    method: 'POST',
    headers: SVC,
  });
  const critAfter = sqlOne(
    `SELECT nomination_id FROM award_outcomes WHERE edition_category_id='${ecId}' AND outcome_type='critics'`,
  );
  const commAfter = sqlOne(
    `SELECT nomination_id FROM award_outcomes WHERE edition_category_id='${ecId}' AND outcome_type='community'`,
  );
  check(
    '14. Staff override of Critics Choice survives a re-compute (community stays fresh)',
    critAfter === nomA && commAfter === nomA,
    `critics=${critAfter === nomA ? 'nomA(kept)' : critAfter} community=${commAfter === nomA ? 'nomA' : commAfter}`,
  );

  // ── 15. leak-proof tally ─────────────────────────────────────────────────────
  const tallyRead = await api(BACK, `/awards/categories/${ecId}/tally`);
  const raw = JSON.stringify(tallyRead.json ?? {});
  check(
    '15. Public tally is leak-proof (no voter identity)',
    tallyRead.status === 200 && !/userId|user_id|"user"|email/i.test(raw),
    tallyRead.status === 200 ? 'no identity fields' : `status ${tallyRead.status}`,
  );

  // ════════════════════════ Slice 2 — subscribe + staff control ═══════════════
  const MARKETING_VERSION = 'marketing-2026-01-demo';
  const subApi = (jarCsrf, path, body) =>
    api(BACK, `/awards/${path}`, { method: 'POST', jar: jarCsrf.jar, csrf: jarCsrf.csrf, body });
  const anonEmail = `i7_anon_${RUN}@example.test`;

  // ── 16. subscribe requires EXPLICIT consent ─────────────────────────────────
  const anonSub = await withCsrf(BACK);
  const noConsent = await subApi(anonSub, 'subscribe', { email: anonEmail, consent: false });
  const noRowYet = Number(
    sqlOne(`SELECT count(*) FROM newsletter_subscriptions WHERE email='${anonEmail}'`),
  );
  check(
    '16. Subscribe without explicit consent → 400, no row',
    noConsent.status === 400 && noConsent.json?.error === 'consent_required' && noRowYet === 0,
    `status ${noConsent.status} rows=${noRowYet}`,
  );

  // ── 17. anonymous subscribe: same GDPR treatment (version + coarsened ip + token)
  const anonOk = await subApi(anonSub, 'subscribe', { email: anonEmail, consent: true });
  const anonRow = sqlOne(
    `SELECT coalesce(user_id::text,'NULL')||'|'||consent_version||'|'||coalesce(ip,'NULL')||'|'||length(unsubscribe_token)::text||'|'||active::text FROM newsletter_subscriptions WHERE email='${anonEmail}'`,
  );
  const [aUser, aVer, aIp, aTokLen, aActive] = anonRow.split('|');
  check(
    '17. Anonymous subscribe: versioned marketing consent + coarsened ip + token',
    anonOk.status === 200 &&
      aUser === 'NULL' &&
      aVer === MARKETING_VERSION &&
      aIp !== 'NULL' &&
      Number(aTokLen) === 64 &&
      aActive === 'true',
    `user=${aUser} ver=${aVer} ip=${aIp} tokLen=${aTokLen} active=${aActive}`,
  );

  // ── 18. registered subscribe ALSO writes the canonical user_consents row ─────
  const vs = await makeVerified('vs');
  const vsSub = await subApi(vs, 'subscribe', { email: vs.u.email, consent: true });
  const vsSubUser = sqlOne(
    `SELECT coalesce(user_id::text,'NULL') FROM newsletter_subscriptions WHERE email='${vs.u.email}'`,
  );
  const vsConsentGranted = Number(
    sqlOne(
      `SELECT count(*) FROM user_consents WHERE user_id='${vs.id}' AND consent_type='marketing' AND granted=true`,
    ),
  );
  check(
    '18. Registered subscribe: subscription linked + user_consents marketing grant',
    vsSub.status === 200 && vsSubUser === vs.id && vsConsentGranted >= 1,
    `subUser=${vsSubUser === vs.id} consents=${vsConsentGranted}`,
  );

  // ── 19. idempotent — one row per email ──────────────────────────────────────
  await subApi(anonSub, 'subscribe', { email: anonEmail, consent: true });
  const anonCount = Number(
    sqlOne(`SELECT count(*) FROM newsletter_subscriptions WHERE email='${anonEmail}'`),
  );
  check('19. Subscribe is idempotent (one row per email)', anonCount === 1, `rows=${anonCount}`);

  // ── 20. unsubscribe via token deactivates ───────────────────────────────────
  const anonToken = sqlOne(
    `SELECT unsubscribe_token FROM newsletter_subscriptions WHERE email='${anonEmail}'`,
  );
  const unsub = await subApi(anonSub, 'unsubscribe', { token: anonToken });
  const anonState = sqlOne(
    `SELECT active::text||'|'||(unsubscribed_at IS NOT NULL)::text FROM newsletter_subscriptions WHERE email='${anonEmail}'`,
  );
  check(
    '20. Unsubscribe via token deactivates the row',
    unsub.status === 200 && anonState === 'false|true',
    `state=${anonState}`,
  );

  // ── 21. registered unsubscribe records the marketing WITHDRAWAL ─────────────
  const vsToken = sqlOne(
    `SELECT unsubscribe_token FROM newsletter_subscriptions WHERE user_id='${vs.id}'`,
  );
  await subApi(vs, 'unsubscribe', { token: vsToken });
  const vsWithdraw = Number(
    sqlOne(
      `SELECT count(*) FROM user_consents WHERE user_id='${vs.id}' AND consent_type='marketing' AND granted=false`,
    ),
  );
  check(
    '21. Registered unsubscribe records a marketing consent withdrawal',
    vsWithdraw >= 1,
    `withdrawals=${vsWithdraw}`,
  );

  // ── 22. guarded phase transition ────────────────────────────────────────────
  const edId2 = await createEdition();
  const guardBad = await api(BACK, `/admin/api/awards/editions/${edId2}/phase`, {
    method: 'POST',
    headers: SVC,
    body: { phase: 'voting' },
  });
  await patchEdition(edId2, {
    isPublished: true,
    votingOpensAt: past,
    votingClosesAt: future,
  });
  const guardOk = await api(BACK, `/admin/api/awards/editions/${edId2}/phase`, {
    method: 'POST',
    headers: SVC,
    body: { phase: 'voting' },
  });
  check(
    '22. Opening voting is guarded (needs publish + window), then succeeds',
    guardBad.status === 409 && guardBad.json?.error === 'phase_guard' && guardOk.status === 200,
    `bad=${guardBad.status}/${guardBad.json?.error} ok=${guardOk.status}`,
  );

  // ── 23. entering `reveal` auto-computes outcomes ────────────────────────────
  sqlOne(`DELETE FROM award_outcomes WHERE edition_category_id='${ecId}'`);
  const reveal = await api(BACK, `/admin/api/awards/editions/${edId}/phase`, {
    method: 'POST',
    headers: SVC,
    body: { phase: 'reveal' },
  });
  const revealPhase = sqlOne(`SELECT phase FROM award_editions WHERE id='${edId}'`);
  const revealComm = sqlOne(
    `SELECT nomination_id FROM award_outcomes WHERE edition_category_id='${ecId}' AND outcome_type='community'`,
  );
  check(
    '23. Entering reveal auto-computes the outcomes',
    reveal.status === 200 && revealPhase === 'reveal' && revealComm === nomA,
    `phase=${revealPhase} community=${revealComm === nomA ? 'nomA' : revealComm}`,
  );

  // ── 24. analytics: correct + leak-proof ─────────────────────────────────────
  // Re-activate one subscriber so the (active) subscriber count is provably ≥ 1.
  await subApi(anonSub, 'subscribe', { email: anonEmail, consent: true });
  const analytics = await api(BACK, `/admin/api/awards/editions/${edId}/analytics`, {
    headers: SVC,
  });
  const an = analytics.json?.data;
  const anRaw = JSON.stringify(analytics.json ?? {});
  check(
    '24. Analytics: voters/votes/subscribers correct + geo empty + leak-proof',
    analytics.status === 200 &&
      an?.totals?.voters === 3 &&
      an?.totals?.votes === 3 &&
      an?.totals?.subscribers >= 1 &&
      an?.geo?.available === false &&
      !/userId|user_id|"user"|email/i.test(anRaw),
    `voters=${an?.totals?.voters} votes=${an?.totals?.votes} subs=${an?.totals?.subscribers}`,
  );

  // ── 25. account deletion scrubs the subscription (PII) ──────────────────────
  await subApi(vs, 'subscribe', { email: vs.u.email, consent: true }); // re-activate
  const del = await api(BACK, '/auth/delete-account', {
    method: 'POST',
    jar: vs.jar,
    csrf: vs.csrf,
    body: { password: vs.u.password },
  });
  const vsSubsAfter = Number(
    sqlOne(`SELECT count(*) FROM newsletter_subscriptions WHERE user_id='${vs.id}'`),
  );
  check(
    '25. Account deletion scrubs the subscription (email is PII)',
    del.status === 200 && vsSubsAfter === 0,
    `status ${del.status} subsAfter=${vsSubsAfter}`,
  );

  // ── cleanup: put the throwaway editions back to unpublished/announce ─────────
  await patchEdition(edId, { phase: 'announce', isPublished: false });
  await patchEdition(edId2, { phase: 'announce', isPublished: false });

  print();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
