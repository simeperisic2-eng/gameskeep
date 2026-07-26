#!/usr/bin/env node
/**
 * GamesKeep — I4b (rating engine + disconnect + community weighting + content
 * flags) verification. The HEADLINE is review-bomb resistance, treated like I3's
 * adversarial test — and the counter-case (a legitimate low score must still move
 * the number, not be blanket-muted). Reports naive-vs-weighted for BOTH.
 *
 *   1. fresh boot scores the seeded games (three layers + disconnect + summary)
 *   2. three layers stay SEPARATED (Our / Critics / Community), each 0..100
 *   3. disconnect: critics-high/community-low → gap + band; editor tag shows only
 *      when a human sets it (never auto)
 *   4. REVIEW-BOMB: unproven extreme burst → (a) flag raised, (b) weighted moves
 *      far less than naive (BOTH reported), (c) nothing suppressed
 *      COUNTER-CASE: proven moderate-low surge (≥minBurstVotes) → NOT flagged and
 *      DOES move the score (fails on extremeness, not on size)
 *      FIRST-SURGE: a brand-new game's first wave doesn't auto-flag from lack of history
 *   5. weighting transparency: per-vote weights inspectable
 *   6. tunability: a burst param change measurably changes the outcome
 *   7. override + audit: community override survives a re-tune
 *   8. content flags: present vs absent distinct; community-report slot exists
 *   9. critics untouched by community weighting
 *   10. no-data is distinct from a score of 0
 *
 * Run after `docker compose up`: `npm run verify:i4b`. Exits non-zero on failure.
 */

const TOKEN = process.env.ADMIN_API_TOKEN ?? 'demo-admin-token';
const BASE = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;
const API = `${BASE}/admin/api`;

const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  return Boolean(ok);
};

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'x-admin-token': TOKEN, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* none */
  }
  return { status: res.status, json };
}

async function waitForReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const j = await (await fetch(`${BASE}/health/ready`)).json();
      if (j.status === 'ready') return true;
    } catch {
      /* not up */
    }
    await sleep(2000);
  }
  return false;
}

const now = Date.now();
const daysAgoISO = (d) => new Date(now - d * 86_400_000).toISOString();
const minsAgoISO = (m) => new Date(now - m * 60_000).toISOString();

async function createUser(prefix, i, proven) {
  const username = `${prefix}${i}_${now % 100000}`;
  const r = await api('POST', '/users', {
    username,
    email: `${username}@verify.local`,
    roleId: ROLE_ID,
    levelId: LEVEL_ID,
    isEmailVerified: proven,
    reputation: proven ? 80 : 0,
  });
  return r.json?.data?.id ?? null;
}

async function createGame(name) {
  const r = await api('POST', '/games', { name, status: 'released' });
  return r.json?.data?.id ?? null;
}

async function vote(gameId, userId, score, ratedAt) {
  return api('POST', '/game-user-ratings', { gameId, userId, score, ratedAt });
}

/** Recompute ONE game and wait for its computedAt to advance. */
async function recomputeGame(gameId) {
  const before = (await api('GET', `/ratings/game/${gameId}`)).json?.data?.computedAt ?? '';
  await api('POST', '/ratings/recompute', { gameId });
  for (let i = 0; i < 40; i += 1) {
    await sleep(1000);
    const g = (await api('GET', `/ratings/game/${gameId}`)).json?.data;
    if ((g?.computedAt ?? '') !== before) return g;
  }
  return (await api('GET', `/ratings/game/${gameId}`)).json?.data;
}

let ROLE_ID = null;
let LEVEL_ID = null;
let PROVEN = [];
let UNPROVEN = [];

async function main() {
  if (!check('Stack ready (/health/ready)', await waitForReady())) return print();

  // wait for the boot recompute to score the seeded games
  let seeded = [];
  for (let i = 0; i < 60; i += 1) {
    seeded = (await api('GET', '/ratings/games')).json?.data ?? [];
    if (seeded.length >= 3) break;
    await sleep(2000);
  }
  check(
    '1. Fresh boot scored the seeded games (3 layers + disconnect)',
    seeded.length >= 3,
    `${seeded.length} games with ratings`,
  );

  // 2. three layers separated (BG3)
  const bg3 = seeded.find((g) => /baldur/i.test(g.name));
  check(
    '2. Three layers stay separated (Our / Critics / Community), each 0..100',
    bg3 &&
      bg3.our.hasData &&
      bg3.critics.hasData &&
      bg3.community.hasData &&
      bg3.our.score <= 100 &&
      bg3.community.score <= 100,
    bg3
      ? `our=${bg3.our.score} critics=${bg3.critics.score} community=${bg3.community.score} (naive ${bg3.community.naive})`
      : 'BG3 missing',
  );

  // 3a. disconnect (Stellar Drifter — critics high, community low)
  const stellar = seeded.find((g) => /stellar/i.test(g.name));
  check(
    '3a. Large critic↔community disconnect computes a gap + band',
    stellar && stellar.disconnect.value >= 26 && stellar.disconnect.band,
    stellar
      ? `gap=${stellar.disconnect.value} band=${stellar.disconnect.band} (critics ${stellar.critics.score} vs community ${stellar.community.score})`
      : 'missing',
  );
  // 3b is proven below on a freshly-created game (re-run-safe: its tag starts null).

  // ── setup user pools ────────────────────────────────────────────────────────
  ROLE_ID = ((await api('GET', '/roles')).json?.data ?? []).find((r) => r.key === 'registered')?.id;
  LEVEL_ID = ((await api('GET', '/user-levels')).json?.data ?? []).find(
    (l) => l.key === 'trusted',
  )?.id;
  if (!check('User role/level lookups resolved', ROLE_ID && LEVEL_ID)) return print();
  for (let i = 0; i < 32; i += 1) PROVEN.push(await createUser('i4bp', i, true));
  for (let i = 0; i < 40; i += 1) UNPROVEN.push(await createUser('i4bu', i, false));
  check(
    'Seeded proven + unproven voter pools',
    PROVEN.every(Boolean) && UNPROVEN.every(Boolean),
    `${PROVEN.length} proven, ${UNPROVEN.length} unproven`,
  );

  // ── 4. REVIEW-BOMB on game A ─────────────────────────────────────────────────
  const gameA = await createGame(`Bombtest Arena ${now % 100000}`);
  // critics (to prove they're untouched by weighting)
  await api('POST', '/game-critic-reviews', { gameId: gameA, outletName: 'IGN', score: 82 });
  await api('POST', '/game-critic-reviews', { gameId: gameA, outletName: 'GameSpot', score: 78 });
  // legitimate base: 12 proven rate ~80, spread over the past weeks
  for (let i = 0; i < 12; i += 1) await vote(gameA, PROVEN[i], 80, daysAgoISO(60 - i * 4));
  const a0 = await recomputeGame(gameA);
  const criticsA0 = a0?.critics.score;
  check(
    'Base community score established from proven voters',
    a0?.community.score >= 70 && !a0?.community.burstFlag,
    `weighted=${a0?.community.score} naive=${a0?.community.naive} flag=${a0?.community.burstFlag}`,
  );

  // inject the bomb: 40 unproven rate 0, clustered in the last hour
  for (let i = 0; i < 40; i += 1) await vote(gameA, UNPROVEN[i], 0, minsAgoISO(i));
  const a1 = await recomputeGame(gameA);
  check(
    '4a. Review-bomb raises the "unusual activity" flag',
    a1?.community.burstFlag === true,
    `flagged=${a1?.community.burstFlag}, extremeFrac=${a1?.community.burstInfo?.extremeFraction}`,
  );
  check(
    '4b. Weighted score moves FAR LESS than the naive average (both reported)',
    a1 && a1.community.score - a1.community.naive > 40 && a1.community.score >= 70,
    `naive=${a1?.community.naive}  weighted=${a1?.community.score}  (Δ=${a1 ? a1.community.score - a1.community.naive : '?'})`,
  );
  check(
    '4c. Nothing silently suppressed — every vote still counted; flag+damping are data',
    a1?.community.count === 52 && a1?.community.burstInfo,
    `count=${a1?.community.count}, damped=${a1?.community.burstInfo?.dampedVoteCount}`,
  );

  // 9. critics untouched by community weighting
  check(
    '9. Community weighting does NOT alter the critics aggregate',
    criticsA0 != null && a1?.critics.score === criticsA0,
    `critics ${criticsA0} → ${a1?.critics.score}`,
  );

  // 5. weighting transparency
  const votesA = (await api('GET', `/ratings/game/${gameA}/votes`)).json?.data?.votes ?? [];
  const provenVote = votesA.find((v) => v.score === 80);
  const bombVote = votesA.find((v) => v.score === 0);
  check(
    '5. Per-vote weighting is inspectable (proven ≫ unproven, no opaque number)',
    provenVote &&
      bombVote &&
      provenVote.credibility.total > 0.7 &&
      bombVote.credibility.total === 0,
    `proven cred=${provenVote?.credibility.total} (effW ${provenVote?.effectiveWeight}) vs bomb cred=${bombVote?.credibility.total}`,
  );

  // 6. tunability — raise minBurstVotes very high → flag clears
  await api('PATCH', '/ratings/settings', { burst: { minBurstVotes: 9999 } });
  const aTuned = await recomputeGame(gameA);
  check(
    '6. Tunability: raising minBurstVotes clears the flag (nothing hardcoded)',
    aTuned?.community.burstFlag === false,
    `flag ${a1?.community.burstFlag} → ${aTuned?.community.burstFlag}`,
  );
  await api('PATCH', '/ratings/settings', { burst: { minBurstVotes: 15 } });
  await recomputeGame(gameA);

  // 7. override + audit + survives re-tune
  await api('POST', `/ratings/game/${gameA}/override`, {
    communityScore: 50,
    reason: 'editor adjudication after review',
  });
  const aOv = (await api('GET', `/ratings/game/${gameA}`)).json?.data;
  await api('PATCH', '/ratings/settings', { credibility: { email: 0.4 } });
  const aRetune = await recomputeGame(gameA);
  await api('PATCH', '/ratings/settings', { credibility: { email: 0.45 } });
  const auditHit = (
    (await api('GET', '/_audit?entityType=game-rating-summaries&limit=50')).json?.data ?? []
  ).some((a) => /rating override/i.test(a.summary ?? ''));
  check(
    '7. Override is editor-set, audit-logged, and SURVIVES a re-tune (auto kept underneath)',
    aOv?.community.override === 50 &&
      aOv?.community.score === 50 &&
      auditHit &&
      aRetune?.community.override === 50 &&
      aRetune?.community.score === 50,
    `effective=${aRetune?.community.score} override=${aRetune?.community.override} auto(kept)=${aRetune?.community.auto}`,
  );

  // ── COUNTER-CASE: legitimate low from proven voters (game B) ─────────────────
  const gameB = await createGame(`Fairtest Realm ${now % 100000}`);
  for (let i = 0; i < 12; i += 1) await vote(gameB, PROVEN[i], 80, daysAgoISO(60 - i * 4));
  for (let i = 0; i < 20; i += 1) await vote(gameB, PROVEN[12 + i], 30, minsAgoISO(i));
  const b = await recomputeGame(gameB);
  check(
    '4d. Counter-case: a proven moderate-low surge CLEARS the volume bar but is NOT flagged',
    b && b.community.burstInfo?.isBurst === true && b.community.burstFlag === false,
    `windowCount=${b?.community.burstInfo?.windowCount} isBurst=${b?.community.burstInfo?.isBurst} flagged=${b?.community.burstFlag} extremeFrac=${b?.community.burstInfo?.extremeFraction}`,
  );
  check(
    '4e. Counter-case: the legitimate low score DOES move the number (not blanket-muted) — both reported',
    b && b.community.score < 60 && b.community.score > 35,
    `naive=${b?.community.naive}  weighted=${b?.community.score}  (legit dissatisfaction honored)`,
  );

  // ── FIRST-SURGE with no prior history (game C) ───────────────────────────────
  const gameC = await createGame(`Launchday Saga ${now % 100000}`);
  const spread = [40, 55, 70, 65, 80, 50, 60, 75, 45, 82, 62, 58, 72, 48, 68, 78, 38, 76, 52, 66];
  for (let i = 0; i < spread.length; i += 1) await vote(gameC, PROVEN[i], spread[i], minsAgoISO(i));
  const c = await recomputeGame(gameC);
  check(
    'First-ever surge does NOT auto-flag from lack of history (extremeFraction is the gate)',
    c &&
      c.community.burstInfo?.historicalRate === 0 &&
      c.community.burstInfo?.isBurst === true &&
      c.community.burstFlag === false,
    `historicalRate=${c?.community.burstInfo?.historicalRate} isBurst=${c?.community.burstInfo?.isBurst} flagged=${c?.community.burstFlag}`,
  );

  // ── 8. content flags + 10. no-data ───────────────────────────────────────────
  check(
    '8a. Content flags show where data exists (seeded game has flags)',
    stellar?.contentFlags && stellar.contentFlags.launchState != null,
    `stellar flags: launch=${stellar?.contentFlags?.launchState} mtx=${stellar?.contentFlags?.monetization?.microtransactions}`,
  );
  const reportRes = await api('POST', '/game-flag-reports', {
    gameId: stellar?.gameId,
    flagKey: 'launchState',
    suggestedValue: 'rough',
  });
  check('8b. Community-report/vote slot exists (structure-only)', reportRes.status === 201);

  // 3b. A freshly-computed large gap auto-explains NOTHING — the context tag is
  // null until a human sets it (re-run-safe; the game starts with no tag).
  const gameDis = await createGame(`Disconnect Probe ${now % 100000}`);
  await api('POST', '/game-critic-reviews', { gameId: gameDis, outletName: 'IGN', score: 92 });
  await api('POST', '/game-critic-reviews', { gameId: gameDis, outletName: 'Polygon', score: 90 });
  for (let i = 0; i < 6; i += 1) await vote(gameDis, PROVEN[i], 45, daysAgoISO(30 - i * 3));
  const disAuto = await recomputeGame(gameDis);
  const tagWasAuto = disAuto?.disconnect.contextTag;
  await api('POST', `/ratings/game/${gameDis}/disconnect-tag`, {
    contextTag: 'Critics overrated it (editor)',
  });
  const disTagged = (await api('GET', `/ratings/game/${gameDis}`)).json?.data;
  check(
    '3b. A large gap NEVER auto-explains itself; the editor tag shows only after a human sets it',
    disAuto &&
      disAuto.disconnect.value >= 26 &&
      (tagWasAuto === null || tagWasAuto === undefined) &&
      disTagged?.disconnect.contextTag?.includes('editor'),
    `gap=${disAuto?.disconnect.value} autoTag=${tagWasAuto ?? 'null'} → set="${disTagged?.disconnect.contextTag ?? ''}"`,
  );

  const gameD = await createGame(`Voidtest ${now % 100000}`);
  const d = await recomputeGame(gameD);
  check(
    '10. No-data is distinct from a score of 0 (no crash, no fabricated number)',
    d &&
      !d.our.hasData &&
      !d.critics.hasData &&
      !d.community.hasData &&
      d.disconnect.value === null,
    `our=${d?.our.score}(has=${d?.our.hasData}) critics=${d?.critics.score}(has=${d?.critics.hasData}) community=${d?.community.score}(has=${d?.community.hasData}) disconnect=${d?.disconnect.value}`,
  );
  check(
    '8c. A game with no flags row → contentFlags absent (≠ "unknown")',
    d?.contentFlags === null,
  );

  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write('\nGamesKeep — I4b rating-engine + review-bomb-resistance verification\n\n');
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL I4b CHECKS PASSED ✓' : 'SOME I4b CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('i4b-check crashed:', err);
  process.exit(1);
});
