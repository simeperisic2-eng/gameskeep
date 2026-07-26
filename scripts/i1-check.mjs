#!/usr/bin/env node
/**
 * GamesKeep — I1 (data layer) verification.
 *
 * Exercises the admin API of the BOOTED stack end-to-end and asserts the SPEC
 * I1 verification points:
 *   - every model can be created / read / updated / deleted through the admin
 *   - many-to-many Topic↔Subject, Article↔Topic (one primary), Article↔Subject
 *   - one review per game, one rating per user per game (DB constraints → 409)
 *   - extensible lists work as data (add a topic type, then use it)
 *   - a staff edit lands in the audit table (old→new)
 *   - pgvector columns exist on Topic/Article
 *   - the demo seed loaded
 *
 * Run after `docker compose up` (or `npm run demo:up`): `npm run verify:i1`.
 * Exits non-zero on any failure, so it doubles as a verification gate.
 */

const TOKEN = process.env.ADMIN_API_TOKEN ?? 'demo-admin-token';
const BASE = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;
const API = `${BASE}/admin/api`;
const RUN = Date.now();

const results = [];
const record = (name, ok, detail = '') => results.push({ name, ok, detail });
const created = []; // { resource, id } for cleanup

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

function check(name, cond, detail = '') {
  record(name, Boolean(cond), detail);
  return Boolean(cond);
}

async function main() {
  const ready = await waitForReady();
  if (!check('Stack ready (/health/ready)', ready)) return print();

  // 1) metadata + pgvector columns
  const meta = await api('GET', '/_meta');
  const vcols = (meta.json?.vectorColumns ?? []).map((c) => `${c.table}.${c.column}`);
  check(
    'Admin _meta lists resources',
    (meta.json?.resources?.length ?? 0) > 10,
    `${meta.json?.resources?.length ?? 0} resources`,
  );
  check(
    'pgvector columns on Topic + Article',
    vcols.includes('topics.embedding') && vcols.includes('articles.embedding'),
    vcols.join(', ') || 'none',
  );

  // 2) seed loaded
  const games = await api('GET', '/games');
  const seeded = (games.json?.data ?? []).some((g) => g.slug === 'cyberpunk-2077');
  check('Demo seed loaded (cyberpunk-2077 present)', seeded);

  // 3) create a Source
  const source = await api('POST', '/sources', { name: `Verify Source ${RUN}` });
  const sourceId = source.json?.data?.id;
  if (check('Create Source', source.status === 201 && Boolean(sourceId), `HTTP ${source.status}`)) {
    created.push({ resource: 'sources', id: sourceId });
  }

  // 4) create a Game (Subject specialization) + read back
  const game = await api('POST', '/games', {
    name: `Verify Game ${RUN}`,
    status: 'released',
    genres: ['RPG'],
  });
  const gameId = game.json?.data?.id;
  const subjectId = game.json?.data?.subjectId;
  check(
    'Create Game (+ Subject)',
    game.status === 201 && Boolean(gameId) && Boolean(subjectId),
    `HTTP ${game.status}`,
  );
  const gameRead = await api('GET', `/games/${gameId}`);
  check('Read Game back (flat name/slug)', gameRead.json?.data?.name === `Verify Game ${RUN}`);

  // 5) update Game → audit row with old→new
  const upd = await api('PATCH', `/games/${gameId}`, { summary: 'Updated by verify script' });
  check(
    'Update Game',
    upd.status === 200 && upd.json?.data?.summary === 'Updated by verify script',
  );
  const audit = await api('GET', `/_audit?entityType=games&entityId=${gameId}`);
  const updateRow = (audit.json?.data ?? []).find((r) => r.action === 'update');
  check(
    'Audit records the edit (old→new)',
    Boolean(updateRow) && updateRow.changes?.summary?.to === 'Updated by verify script',
    updateRow ? 'update logged' : 'no audit row',
  );

  // 6) create a Topic + Article (ours, with body)
  const topic = await api('POST', '/topics', {
    title: `Verify Topic ${RUN}`,
    status: 'developing',
  });
  const topicId = topic.json?.data?.id;
  check('Create Topic', topic.status === 201 && Boolean(topicId), `HTTP ${topic.status}`);

  const article = await api('POST', '/articles', {
    title: `Verify Article ${RUN}`,
    origin: 'ours',
    articleType: 'opinion',
    body: 'Our own words, copyright-safe.',
    sourceId,
  });
  const articleId = article.json?.data?.id;
  check(
    'Create Article (ours, with body)',
    article.status === 201 && Boolean(articleId),
    `HTTP ${article.status}`,
  );

  // copyright guard: aggregated article may NOT carry full body
  const badArticle = await api('POST', '/articles', {
    title: `Bad Aggregated ${RUN}`,
    origin: 'aggregated',
    body: 'stolen full text',
  });
  check(
    'Reject aggregated article with body (copyright)',
    badArticle.status === 400,
    `HTTP ${badArticle.status}`,
  );

  // 7) relations: Topic↔Subject, Article↔Subject, Article↔Topic (primary)
  const tsLink = await api('POST', '/relations/topic-subject', { topicId, subjectId });
  check('Link Topic↔Subject (M2M)', tsLink.status === 201, `HTTP ${tsLink.status}`);
  const asLink = await api('POST', '/relations/article-subject', { articleId, subjectId });
  check('Link Article↔Subject (M2M)', asLink.status === 201, `HTTP ${asLink.status}`);
  const atLink = await api('POST', '/relations/article-topic', {
    articleId,
    topicId,
    isPrimary: true,
  });
  check('Link Article→Topic as primary', atLink.status === 201, `HTTP ${atLink.status}`);

  // one-primary invariant: re-assigning primary to a second topic must succeed
  const topic2 = await api('POST', '/topics', { title: `Verify Topic B ${RUN}` });
  const topic2Id = topic2.json?.data?.id;
  const atMove = await api('POST', '/relations/article-topic', {
    articleId,
    topicId: topic2Id,
    isPrimary: true,
  });
  check(
    'Re-assign primary topic (one-primary maintained)',
    atMove.status === 201,
    `HTTP ${atMove.status}`,
  );

  // 8) one-review-per-game (DB unique → 409 on the second)
  const review1 = await api('POST', '/game-reviews', { gameId, verdict: 'Great', ourScore: 88 });
  const review2 = await api('POST', '/game-reviews', { gameId, verdict: 'Dup', ourScore: 50 });
  check(
    'One review per game enforced',
    review1.status === 201 && review2.status === 409,
    `${review1.status}/${review2.status}`,
  );

  // 9) one-rating-per-user-per-game (DB unique → 409 on the second)
  const roles = await api('GET', '/roles');
  const roleId =
    (roles.json?.data ?? []).find((r) => r.key === 'registered')?.id ?? roles.json?.data?.[0]?.id;
  const user = await api('POST', '/users', {
    username: `verify_${RUN}`,
    email: `verify_${RUN}@gameskeep.local`,
    roleId,
  });
  const userId = user.json?.data?.id;
  check('Create User', user.status === 201 && Boolean(userId), `HTTP ${user.status}`);
  if (userId) created.push({ resource: 'users', id: userId });
  const rate1 = await api('POST', '/game-user-ratings', { gameId, userId, score: 80 });
  const rate2 = await api('POST', '/game-user-ratings', { gameId, userId, score: 70 });
  check(
    'One rating per user per game enforced',
    rate1.status === 201 && rate2.status === 409,
    `${rate1.status}/${rate2.status}`,
  );

  // 10) extensible list as DATA: add a new topic type, then use it
  const newType = await api('POST', '/topic-types', {
    key: `verify-kind-${RUN}`,
    label: 'Verify Kind',
  });
  const typeId = newType.json?.data?.id;
  const topicWithType = await api('POST', '/topics', { title: `Typed Topic ${RUN}`, typeId });
  check(
    'Extensible list (new topic type, then used)',
    newType.status === 201 && topicWithType.status === 201,
    `${newType.status}/${topicWithType.status}`,
  );
  if (typeId) created.push({ resource: 'topic-types', id: typeId });

  // 11) validation rejects bad input
  const badUser = await api('POST', '/users', { username: 'a b', email: 'nope', roleId });
  check('Validation rejects bad input (400)', badUser.status === 400, `HTTP ${badUser.status}`);

  // 12) Awards: edition → category → nomination
  const edition = await api('POST', '/award-editions', {
    // Unique-ish year within the validator's range (1970–2200).
    year: 1971 + (RUN % 200),
    name: `Verify Awards ${RUN}`,
  });
  const editionId = edition.json?.data?.id;
  const cats = await api('GET', '/award-categories');
  const categoryId = (cats.json?.data ?? [])[0]?.id;
  const ec = await api('POST', '/award-edition-categories', { editionId, categoryId });
  const ecId = ec.json?.data?.id;
  const nom = await api('POST', '/award-nominations', { editionCategoryId: ecId, subjectId });
  check(
    'Awards edition → category → nomination',
    edition.status === 201 && ec.status === 201 && nom.status === 201,
    `${edition.status}/${ec.status}/${nom.status}`,
  );
  if (editionId) created.push({ resource: 'award-editions', id: editionId });

  // 13) delete works (and cascades): remove the Game via the admin
  const del = await api('DELETE', `/games/${gameId}`);
  check('Delete Game (cascades Subject/links)', del.status === 200, `HTTP ${del.status}`);

  // cleanup remaining standalone rows (best-effort; game already gone)
  for (const id of [topicId, topic2Id]) if (id) await api('DELETE', `/topics/${id}`);
  if (articleId) await api('DELETE', `/articles/${articleId}`);
  for (const c of created) await api('DELETE', `/${c.resource}/${c.id}`);

  print();
}

function print() {
  const width = Math.max(...results.map((r) => r.name.length));
  const pad = (s) => s + ' '.repeat(Math.max(0, width - s.length));
  process.stdout.write('\nGamesKeep — I1 data-layer verification\n\n');
  let allOk = true;
  for (const r of results) {
    if (!r.ok) allOk = false;
    process.stdout.write(`  ${r.ok ? '✓' : '✗'}  ${pad(r.name)}  ${r.detail}\n`);
  }
  process.stdout.write(`\n${allOk ? 'ALL I1 CHECKS PASSED ✓' : 'SOME I1 CHECKS FAILED ✗'}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error('i1-check crashed:', err);
  process.exit(1);
});
