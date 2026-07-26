#!/usr/bin/env node
/**
 * GamesKeep — I3 (article pipeline + clustering) verification.
 *
 * Exercises the BOOTED stack end-to-end and asserts the SPEC I3 points:
 *   1. seam = Mock feed in demo (no network); the background pipeline turns the
 *      mock feed into articles + topics (reports N articles → M topics)
 *   2. clustering quality: a multi-source event is ONE topic; the three distinct
 *      GTA 6 events are THREE topics (same game, separated)
 *   3. threshold is configurable: raising/lowering it measurably changes topic
 *      count (via re-cluster); the time window keeps an old article separate
 *   4. every article is embedded + has a primary topic; topics have a generated
 *      TL;DR + AI summary (stored)
 *   5. merge / split / reassign work from admin and are audit-logged
 *   6. game attach: articles attach to catalog games; an unknown game is queued
 *   7. idempotent: re-running the pipeline doesn't duplicate or splinter
 *   8. seam shown = mock in demo / live dormant
 *
 * Run after `docker compose up` (or `npm run demo:up`): `npm run verify:i3`.
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

/** Poll clustering status until the background ingest has produced enough articles. */
async function waitForArticles(min) {
  for (let i = 0; i < 90; i += 1) {
    const res = await api('GET', '/clustering/status');
    if ((res.json?.feedArticles ?? 0) >= min) return res.json;
    await sleep(2000);
  }
  return (await api('GET', '/clustering/status')).json;
}

/** Trigger an ingest and wait for a fresh run to finish (finishedAt changes). */
async function ingestAndWait({ reset = false } = {}) {
  const before = await api('GET', '/clustering/status');
  const beforeAt = before.json?.lastIngest?.finishedAt ?? '';
  await api('POST', '/clustering/ingest', reset ? { reset: true } : {});
  for (let i = 0; i < 90; i += 1) {
    await sleep(2000);
    const s = await api('GET', '/clustering/status');
    if ((s.json?.lastIngest?.finishedAt ?? '') !== beforeAt) return s.json;
  }
  return (await api('GET', '/clustering/status')).json;
}

/** Find the topic that contains an article whose guid starts with `prefix`. */
function topicWithGuidPrefix(topics, prefix) {
  return topics.find((t) => (t.articles ?? []).some((a) => (a.guid ?? '').startsWith(prefix)));
}

async function main() {
  const ready = await waitForReady();
  if (!check('Stack ready (/health/ready)', ready)) return print();

  // 1) seam = Mock feed in demo (no live calls)
  const status0 = await api('GET', '/clustering/status');
  check(
    'Article-source seam = Mock in demo (no live calls)',
    status0.json?.provider?.provider === 'mock' && status0.json?.provider?.live === false,
    `provider=${status0.json?.provider?.provider}, sources=${status0.json?.provider?.sources}`,
  );

  // 1) background pipeline produced articles + topics
  const stats = await waitForArticles(ARTICLES_MIN);
  const feed = stats?.feedArticles ?? 0;
  const topicsCount = stats?.totalTopics ?? 0;
  check(
    `Pipeline clustered the feed (≥ ${ARTICLES_MIN} articles)`,
    feed >= ARTICLES_MIN,
    `${feed} feed articles → ${topicsCount} topics`,
  );

  // 4) every feed article embedded + has a primary topic
  check(
    'Every feed article is embedded (pgvector populated)',
    feed > 0 && stats?.articlesWithEmbedding >= feed,
    `${stats?.articlesWithEmbedding}/${feed} embedded`,
  );
  check(
    'Every feed article has a primary topic',
    feed > 0 && stats?.articlesWithPrimaryTopic >= feed,
    `${stats?.articlesWithPrimaryTopic} with primary`,
  );

  // 2) clustering quality
  const topicsRes = await api('GET', '/clustering/topics');
  const topics = topicsRes.json?.data ?? [];

  const delayTopic = topicWithGuidPrefix(topics, 'gta6-delay-');
  const trailerTopic = topicWithGuidPrefix(topics, 'gta6-trailer-');
  const leakTopic = topicWithGuidPrefix(topics, 'gta6-mapleak-');

  check(
    'Multi-source event clusters into ONE topic (GTA 6 delay)',
    delayTopic && delayTopic.sources.length >= 3,
    delayTopic
      ? `${delayTopic.sources.length} sources: ${delayTopic.sources.join(', ')}`
      : 'not found',
  );
  // The delay topic should NOT also contain the trailer/leak articles.
  const delayClean =
    delayTopic && !delayTopic.articles.some((a) => /gta6-(trailer|mapleak)-/.test(a.guid ?? ''));
  check('Delay topic is not polluted by the other GTA 6 events', delayClean);

  check(
    'Three distinct GTA 6 events form THREE topics (same game, separated)',
    delayTopic &&
      trailerTopic &&
      leakTopic &&
      new Set([delayTopic.id, trailerTopic.id, leakTopic.id]).size === 3,
    delayTopic && trailerTopic && leakTopic
      ? `delay=${delayTopic.id.slice(0, 6)} trailer=${trailerTopic.id.slice(0, 6)} leak=${leakTopic.id.slice(0, 6)}`
      : 'missing one of the three',
  );

  // 4) topic has a generated TL;DR + AI summary
  check(
    'Clustered topic has a generated TL;DR + AI summary (stored)',
    delayTopic && Boolean(delayTopic.tldr) && Boolean(delayTopic.aiSummary),
    delayTopic ? `tldr="${(delayTopic.tldr ?? '').slice(0, 50)}…"` : '',
  );
  check(
    'Most topics have an AI summary',
    stats?.topicsWithSummary > 0 && stats?.topicsWithSummary >= topicsCount - 2,
    `${stats?.topicsWithSummary}/${topicsCount}`,
  );

  // 6) game attach + unmatched queue
  check(
    'Articles attach to catalog games (article_subjects populated)',
    stats?.articlesWithGame > 0,
    `${stats?.articlesWithGame} articles linked to games`,
  );
  const unmatched = await api('GET', '/unmatched-games');
  const queuedUnknown = (unmatched.json?.data ?? []).some((u) =>
    String(u.rawName ?? '').includes('Chronowraith Saga IX'),
  );
  check('Unknown game reference filed to the unmatched queue (resolveOrQueue)', queuedUnknown);

  // 7) idempotent: re-run ingest (no reset) → counts unchanged
  const beforeA = feed;
  const beforeT = topicsCount;
  const afterIdem = await ingestAndWait({ reset: false });
  check(
    'Re-running the pipeline is idempotent (no duplicates / splintering)',
    afterIdem?.feedArticles === beforeA && afterIdem?.totalTopics === beforeT,
    `${beforeA}→${afterIdem?.feedArticles} articles, ${beforeT}→${afterIdem?.totalTopics} topics`,
  );

  // 3) threshold is configurable — raising it makes MORE topics, lowering FEWER
  const defaultTopics = afterIdem?.totalTopics ?? topicsCount;
  await api('PATCH', '/clustering/settings', { similarityThreshold: 0.9 });
  const high = await ingestAndWait({ reset: true });
  await api('PATCH', '/clustering/settings', { similarityThreshold: 0.2 });
  const low = await ingestAndWait({ reset: true });
  check(
    'Threshold is configurable and measurably changes clustering',
    high?.totalTopics > defaultTopics && low?.totalTopics < high?.totalTopics,
    `high(0.9)=${high?.totalTopics} > default(0.5)=${defaultTopics} > low(0.2)=${low?.totalTopics}`,
  );

  // restore default + re-cluster cleanly for the remaining checks
  await api('PATCH', '/clustering/settings', { similarityThreshold: 0.5 });
  const restored = await ingestAndWait({ reset: true });
  check(
    'Settings restored to default + re-clustered',
    Math.abs((restored?.totalTopics ?? 0) - defaultTopics) <= 3,
    `topics=${restored?.totalTopics} (default ~${defaultTopics})`,
  );

  // 3) time window respected: the ~17-month-old article stays in its own topic
  const topics2 = (await api('GET', '/clustering/topics')).json?.data ?? [];
  const oldTopic = topicWithGuidPrefix(topics2, 'helldivers-window-old');
  const newTopic = topicWithGuidPrefix(topics2, 'helldivers-window-new');
  check(
    'Time window respected (old article not merged into the recent cluster)',
    oldTopic && newTopic && oldTopic.id !== newTopic.id,
    oldTopic && newTopic
      ? `old=${oldTopic.id.slice(0, 6)} new=${newTopic.id.slice(0, 6)}`
      : 'missing',
  );

  // 5) editor merge / split / reassign + audit
  // SPLIT: take a multi-source topic and split one article out → +1 topic
  const splitSource = topics2.find((t) => t.articleCount >= 3);
  let splitNewId = null;
  if (splitSource) {
    const moveId = splitSource.articles[0].id;
    const beforeTopics = (await api('GET', '/clustering/status')).json?.totalTopics ?? 0;
    const split = await api('POST', '/clustering/split', {
      topicId: splitSource.id,
      articleIds: [moveId],
      newTitle: 'I3 verify split',
    });
    splitNewId = split.json?.data?.newTopicId ?? null;
    const afterTopics = (await api('GET', '/clustering/status')).json?.totalTopics ?? 0;
    check(
      'Editor SPLIT moves an article into a new topic',
      split.status === 201 && afterTopics === beforeTopics + 1,
      `topics ${beforeTopics}→${afterTopics}`,
    );
  } else {
    check('Editor SPLIT moves an article into a new topic', false, 'no topic with ≥3 articles');
  }

  // MERGE: merge the split-out topic back into its source → -1 topic
  if (splitNewId && splitSource) {
    const beforeTopics = (await api('GET', '/clustering/status')).json?.totalTopics ?? 0;
    const merge = await api('POST', '/clustering/merge', {
      sourceTopicId: splitNewId,
      targetTopicId: splitSource.id,
    });
    const afterTopics = (await api('GET', '/clustering/status')).json?.totalTopics ?? 0;
    check(
      'Editor MERGE combines two topics into one',
      merge.status === 200 && afterTopics === beforeTopics - 1,
      `topics ${beforeTopics}→${afterTopics}`,
    );
  } else {
    check('Editor MERGE combines two topics into one', false, 'no split topic to merge back');
  }

  // REASSIGN: move an article from one topic to another (primary)
  const topics3 = (await api('GET', '/clustering/topics')).json?.data ?? [];
  const from = topics3.find((t) => t.articleCount >= 2);
  const to = topics3.find((t) => from && t.id !== from.id);
  let reassignOk = false;
  if (from && to) {
    const articleId = from.articles[0].id;
    const reassign = await api('POST', '/clustering/reassign', {
      articleId,
      topicId: to.id,
      makePrimary: true,
    });
    reassignOk = reassign.status === 200 && reassign.json?.data?.status === 'reassigned';
  }
  check('Editor REASSIGN moves an article to another topic', reassignOk);

  // audit-logged: topics + articles edits recorded
  const auditTopics = await api('GET', '/_audit?entityType=topics&limit=50');
  const auditArticles = await api('GET', '/_audit?entityType=articles&limit=50');
  const merged = (auditTopics.json?.data ?? []).some((a) => /merge|split/i.test(a.summary ?? ''));
  const reassigned = (auditArticles.json?.data ?? []).some((a) =>
    /reassign/i.test(a.summary ?? ''),
  );
  check('Merge/split are audit-logged', merged);
  check('Reassign is audit-logged', reassigned);

  // 8) seam shown (mock in demo; live dormant verified by the hermetic test)
  check(
    'Seam shown = Mock in demo / Live dormant',
    status0.json?.provider?.live === false,
    'live=false',
  );

  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write('\nGamesKeep — I3 article-pipeline + clustering verification\n\n');
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL I3 CHECKS PASSED ✓' : 'SOME I3 CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('i3-check crashed:', err);
  process.exit(1);
});
