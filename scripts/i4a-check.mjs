#!/usr/bin/env node
/**
 * GamesKeep — I4a (bias engine + clustering secondary gate) verification.
 *
 * Because a bias score has NO external ground truth, this targets DIRECTION,
 * EXPLAINABILITY, TUNABILITY, SEPARATION and OVERRIDE — never an absolute number:
 *   1. fresh boot: articles get influence + quality scores; topics get a stored
 *      distribution
 *   2. direction: sponsored+affiliate > affiliate-only > clean (influence); a
 *      PR-rewrite scores lower on quality than a substantive piece
 *   3. explainability: every score has a stored breakdown whose contributions sum
 *      to it (no unexplained numbers)
 *   4. tunability: changing a weight measurably moves the affected AUTO scores
 *   5. factual vs judgmental: no editor note is ever auto-generated; one appears
 *      only after a human writes it
 *   6. internal-field separation: the internal assessment is editable/visible in
 *      the admin payload AND structurally absent from the public payload
 *   7. override + audit: an axis override (with reason) is editor-set, audit-
 *      logged, and SURVIVES a weight re-tune (not clobbered)
 *   8. topic aggregation: a multi-article topic's distribution counts add up
 *   9. secondary gate: the same-game/same-register pair stays SEPARATE while the
 *      GTA 6 multi-outlet same-event still merges to ONE; gate is tunable (off →
 *      the pair merges, proving the gate is what separates them)
 *
 * Run after `docker compose up` (or `npm run demo:up`): `npm run verify:i4a`.
 * Exits non-zero on any failure, so it doubles as a verification gate.
 */

const TOKEN = process.env.ADMIN_API_TOKEN ?? 'demo-admin-token';
const BASE = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;
const API = `${BASE}/admin/api`;
const ARTICLES_MIN = 190;

const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    /* no body */
  }
  return { status: res.status, json };
}

function check(name, cond, detail = '') {
  record(name, Boolean(cond), detail);
  return Boolean(cond);
}

async function waitForReady() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/health/ready`);
      const json = await res.json();
      if (json.status === 'ready') return true;
    } catch {
      /* not up yet */
    }
    await sleep(2000);
  }
  return false;
}

async function waitForArticles(min) {
  for (let i = 0; i < 120; i += 1) {
    const res = await api('GET', '/clustering/status');
    if ((res.json?.feedArticles ?? 0) >= min) return res.json;
    await sleep(2000);
  }
  return (await api('GET', '/clustering/status')).json;
}

/** Trigger a full re-cluster and wait for it to finish (finishedAt changes). */
async function reclusterAndWait() {
  const before = (await api('GET', '/clustering/status')).json?.lastIngest?.finishedAt ?? '';
  await api('POST', '/clustering/ingest', { reset: true });
  for (let i = 0; i < 120; i += 1) {
    await sleep(2000);
    const s = (await api('GET', '/clustering/status')).json;
    if ((s?.lastIngest?.finishedAt ?? '') !== before) return s;
  }
  return (await api('GET', '/clustering/status')).json;
}

/** Trigger a bias-only recompute and wait for it to finish. */
async function recomputeAndWait() {
  const before = (await api('GET', '/bias/status')).json?.lastRecompute?.finishedAt ?? '';
  await api('POST', '/bias/recompute', {});
  for (let i = 0; i < 60; i += 1) {
    await sleep(1500);
    const s = (await api('GET', '/bias/status')).json;
    if ((s?.lastRecompute?.finishedAt ?? '') !== before) return s;
  }
  return (await api('GET', '/bias/status')).json;
}

async function biasArticles() {
  return (await api('GET', '/bias/articles')).json?.data ?? [];
}
const byGuid = (list, prefix) => list.find((a) => (a.guid ?? '').startsWith(prefix));

function topicWithGuidPrefix(topics, prefix) {
  return topics.find((t) => (t.articles ?? []).some((a) => (a.guid ?? '').startsWith(prefix)));
}
function sumContribs(b) {
  return (b?.contributions ?? []).reduce((acc, c) => acc + c.points, 0);
}

async function main() {
  const ready = await waitForReady();
  if (!check('Stack ready (/health/ready)', ready)) return print();

  await waitForArticles(ARTICLES_MIN);
  const biasStatus0 = (await api('GET', '/bias/status')).json;
  check(
    '1. Fresh boot computed bias for the feed (articles scored + topics aggregated)',
    (biasStatus0?.counts?.articlesScored ?? 0) >= ARTICLES_MIN &&
      (biasStatus0?.counts?.topicsWithDistribution ?? 0) > 0,
    `${biasStatus0?.counts?.articlesScored} scored, ${biasStatus0?.counts?.topicsWithDistribution} topics`,
  );

  // ── 9. SECONDARY GATE (run first — gate-off reset re-creates articles) ───────
  let topics = (await api('GET', '/clustering/topics')).json?.data ?? [];
  let orionT = topicWithGuidPrefix(topics, 'cyberpunk-orion-');
  let salesT = topicWithGuidPrefix(topics, 'cyberpunk-sales-');
  const delayT = topicWithGuidPrefix(topics, 'gta6-delay-');

  check(
    '9a. Gate keeps the same-game/same-register pair SEPARATE (Cyberpunk prod vs sales)',
    orionT && salesT && orionT.id !== salesT.id,
    orionT && salesT
      ? `orion=${orionT.id.slice(0, 6)} sales=${salesT.id.slice(0, 6)}`
      : 'one of the pair missing',
  );
  check(
    '9b. Legitimate multi-outlet same-event STILL merges to ONE (GTA 6 delay)',
    delayT && delayT.sources.length >= 3,
    delayT ? `${delayT.sources.length} sources in one topic` : 'delay topic missing',
  );

  // Gate OFF → the pair should now over-merge (proving the gate is what separates).
  await api('PATCH', '/clustering/settings', { gate: { enabled: false } });
  await reclusterAndWait();
  topics = (await api('GET', '/clustering/topics')).json?.data ?? [];
  orionT = topicWithGuidPrefix(topics, 'cyberpunk-orion-');
  salesT = topicWithGuidPrefix(topics, 'cyberpunk-sales-');
  const delayOff = topicWithGuidPrefix(topics, 'gta6-delay-');
  check(
    '9c. Gate OFF → cosine over-merges the pair into ONE topic (tunable; proves the gate acts)',
    orionT && salesT && orionT.id === salesT.id,
    orionT && salesT ? `both in ${orionT.id.slice(0, 6)}` : 'pair not both present',
  );
  check(
    '9d. Gate OFF does not change the legitimate same-event merge (still one topic)',
    delayOff && delayOff.sources.length >= 3,
    delayOff ? `${delayOff.sources.length} sources` : 'missing',
  );

  // Restore gate ON + re-cluster to a clean default state for the bias checks.
  await api('PATCH', '/clustering/settings', { gate: { enabled: true } });
  await reclusterAndWait();

  // ── 2/3. DIRECTION + EXPLAINABILITY ─────────────────────────────────────────
  let list = await biasArticles();
  const clean = byGuid(list, 'bias-clean-');
  const affiliate = byGuid(list, 'bias-affiliate-');
  const sponsored = byGuid(list, 'bias-sponsored-');

  check(
    '2a. Influence direction: sponsored+affiliate > affiliate-only > clean',
    clean &&
      affiliate &&
      sponsored &&
      sponsored.influence.effective > affiliate.influence.effective &&
      affiliate.influence.effective > clean.influence.effective,
    clean && affiliate && sponsored
      ? `clean=${clean.influence.effective} aff=${affiliate.influence.effective} spon=${sponsored.influence.effective}`
      : 'seed articles missing',
  );
  check(
    '2b. Quality direction: a substantive piece scores higher than the PR-rewrite',
    clean && sponsored && clean.quality.effective > sponsored.quality.effective,
    clean && sponsored
      ? `clean=${clean.quality.effective} > sponsored=${sponsored.quality.effective}`
      : 'missing',
  );
  check(
    '3. Explainability: every score has a breakdown whose contributions sum to it',
    sponsored &&
      sponsored.influenceBreakdown &&
      sumContribs(sponsored.influenceBreakdown) === sponsored.influenceBreakdown.rawSum &&
      sponsored.influence.auto === sponsored.influenceBreakdown.score,
    sponsored
      ? `Σ=${sumContribs(sponsored.influenceBreakdown)} score=${sponsored.influenceBreakdown?.score}: ${(sponsored.influenceBreakdown?.contributions ?? []).map((c) => `${c.signal}${c.points >= 0 ? '+' : ''}${c.points}`).join(' ')}`
      : '',
  );

  // ── 4. TUNABILITY (auto scores move; restore after) ─────────────────────────
  const sponsoredBefore = sponsored?.influence.auto ?? 0;
  await api('PATCH', '/bias/weights', { influence: { sponsored: 40 } });
  await recomputeAndWait();
  list = await biasArticles();
  const sponsoredLow = byGuid(list, 'bias-sponsored-');
  check(
    '4. Tunability: lowering the sponsored weight measurably lowers the auto score',
    sponsoredLow && sponsoredLow.influence.auto < sponsoredBefore,
    `sponsored auto ${sponsoredBefore} → ${sponsoredLow?.influence.auto} (weight 90→40)`,
  );
  await api('PATCH', '/bias/weights', { influence: { sponsored: 90 } });
  await recomputeAndWait();

  // ── 5. FACTUAL vs JUDGMENTAL (no auto note; appears only when a human writes) ─
  list = await biasArticles();
  const anyAutoNote = list.some((a) => a.editorNote && a.editorNote.length > 0);
  check('5a. No judgmental editor note is ever auto-generated', !anyAutoNote);
  const noteTarget = byGuid(list, 'bias-sponsored-');
  await api('POST', `/bias/article/${noteTarget.id}/note`, {
    editorNote: 'Reads as promotional — cozy vibes, little substance.',
  });
  const afterNote = (await api('GET', `/bias/article/${noteTarget.id}`)).json?.data;
  check(
    '5b. An editor note is displayed only after a human enters it',
    afterNote?.editorNote?.includes('promotional'),
    afterNote?.editorNote ?? '',
  );

  // ── 6. INTERNAL-FIELD SEPARATION ────────────────────────────────────────────
  const SECRET = 'INTERNAL: perceived narrative push — must never leak';
  await api('POST', `/bias/article/${noteTarget.id}/internal`, { internalAssessment: SECRET });
  const adminView = (await api('GET', `/bias/article/${noteTarget.id}`)).json?.data;
  const publicRes = await api('GET', `/bias/article/${noteTarget.id}/public`);
  const publicView = publicRes.json?.data ?? {};
  check(
    '6a. Internal assessment is editable + visible in the ADMIN payload',
    adminView?.internalAssessment === SECRET,
  );
  check(
    '6b. Internal assessment is structurally ABSENT from the PUBLIC payload',
    !('internalAssessment' in publicView) && !JSON.stringify(publicView).includes('INTERNAL'),
    `public keys: ${Object.keys(publicView).join(', ')}`,
  );

  // ── 7. OVERRIDE + AUDIT + survives a re-tune ────────────────────────────────
  const ovTarget = byGuid(await biasArticles(), 'bias-affiliate-');
  await api('POST', `/bias/article/${ovTarget.id}/override`, {
    influenceScore: 7,
    reason: 'editor judged this independent despite the affiliate link',
  });
  let ov = (await api('GET', `/bias/article/${ovTarget.id}`)).json?.data;
  check(
    '7a. Override sets the effective score + marks it editor-set (auto retained underneath)',
    ov?.influence.override === 7 && ov?.influence.effective === 7 && ov?.influence.auto != null,
    `effective=${ov?.influence.effective} auto(kept)=${ov?.influence.auto}`,
  );
  const auditRes = await api('GET', '/_audit?entityType=articles&limit=50');
  check(
    '7b. Override is audit-logged (who/what/when, with reason)',
    (auditRes.json?.data ?? []).some((a) => /bias override/i.test(a.summary ?? '')),
  );
  // Re-tune a weight + recompute → override must NOT be clobbered.
  await api('PATCH', '/bias/weights', { influence: { affiliate: 5 } });
  await recomputeAndWait();
  ov = (await api('GET', `/bias/article/${ovTarget.id}`)).json?.data;
  check(
    '7c. Override SURVIVES a weight re-tune (auto recomputed, editor decision kept)',
    ov?.influence.override === 7 && ov?.influence.effective === 7,
    `effective=${ov?.influence.effective}, auto now=${ov?.influence.auto}`,
  );
  await api('PATCH', '/bias/weights', { influence: { affiliate: 25 } });
  await recomputeAndWait();

  // ── 8. TOPIC AGGREGATION ────────────────────────────────────────────────────
  const topicBias = (await api('GET', '/bias/topics')).json?.data ?? [];
  const multi = topicBias.find((t) => (t.distribution?.articleCount ?? 0) >= 3);
  const d = multi?.distribution;
  check(
    '8. Topic distribution counts add up to the topic’s articles (both axes)',
    d &&
      d.influence.independent + d.influence.influenced === d.articleCount &&
      d.quality.top + d.quality.slop === d.articleCount,
    d
      ? `n=${d.articleCount} infl(${d.influence.independent}+${d.influence.influenced}) qual(${d.quality.top}+${d.quality.slop})`
      : 'no multi-article topic',
  );

  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write('\nGamesKeep — I4a bias-engine + secondary-gate verification\n\n');
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL I4a CHECKS PASSED ✓' : 'SOME I4a CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('i4a-check crashed:', err);
  process.exit(1);
});
