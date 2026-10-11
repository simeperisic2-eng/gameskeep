#!/usr/bin/env node
/**
 * GamesKeep — Phase P (product redesign) verification. `npm run verify:p`.
 * Aggregates every slice's acceptance checks (SPEC-P-product-redesign.md); each
 * slice appends its group. Proves behaviour against the BOOTED stack: served SSR
 * HTML, public/admin API and DB truth — never the code's own word.
 *
 *  S1 — Bias display, naming, review integrity, briefing
 *   S1.1  (acc. 1) a news topic with no sponsored signal renders NO bias panel and
 *         no row chips; a review renders the panel + the integrity block; scope
 *         `all` brings the news topic's panel back (hidden, not removed)
 *   S1.2  (acc. 2) "Independent" as a bias label appears in NO public SSR HTML
 *         (visible text + JSON-LD of every public route; the award name "Best
 *         Independent Game" is allowlisted) and no `independent` flag class
 *   S1.3  (acc. 3) defaults: the topic bias-vote POST is rejected (403, no row)
 *         and its aggregate is not served; no quality bar / quality values; the
 *         switches ON restore both, and OFF again keeps the stored vote unshown
 *   S1.4  (acc. 4) the briefing carries counts (sources · topics · reviews) and
 *         no independence percentage; counts equal DB truth for its window
 *   S1.5  integrity: a NEGATED disclosure creates no signal; a detected but
 *         unconfirmed signal is NOT public while autoPublish is off (and is with
 *         it on); a moderator confirm makes it public with its snippet (≤200) +
 *         a link to the source article; editor add is audited and its note is
 *         rendered ESCAPED; non-staff 403 / anon 401; non-review 409; a review
 *         without public signals shows exactly one "No signals found" line
 *   S1.6  game page: the Reviews block sits above "In the news"; news has no reviews
 *   S1.7  no "Lead source" on any topic page; is_primary still stored + not public
 *   S1.8  the "No signals found" chip is neutral (no green, no red); no green
 *         `independent` rule remains
 *   S1.9  display switches: moderator 403, admin 200; each change audited old→new
 *   S1.10 engine unchanged: every feed article still has both scores stored
 *   S1.11 zero nested anchors on home / topic (news + review) / game / source
 *   S1.12 Methodology explains the rename in one line
 *   S1.13 public copy keeps its spaces (no word glued to a closing inline tag)
 *   (S1.5f/g self-review regressions: bad evidence date → 400; a confirming note
 *    never replaces the linked source quote; the topic panel agrees with its rows)
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FRONT = `http://localhost:${process.env.FRONTEND_PORT ?? 3000}`;
const BACK = `http://localhost:${process.env.BACKEND_PORT ?? 4000}`;
const TOKEN = process.env.ADMIN_API_TOKEN ?? 'demo-admin-token';
const RUN = Date.now().toString(36);
const DEMO_PW = 'Demo-Panel-2026!';
const CSS_PATH = 'apps/frontend/app/(site)/site.css';

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
async function api(base, path, { method = 'GET', jar = {}, csrf, body, token } = {}) {
  const h = {};
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
    /* not JSON */
  }
  return { status: res.status, json, text, res };
}
const html = async (path) => (await api(FRONT, path)).text;
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
    username: `p_${tag}_${RUN}`,
    email: `p_${tag}_${RUN}@example.test`,
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
  const id = sqlOne(`SELECT id FROM users WHERE username='${u.username}'`);
  return { u, jar, csrf, id };
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
      /* not up yet */
    }
    await sleep(2000);
  }
  return false;
}
/** Poll one articles-queue job until it completes or fails (bounded). */
async function waitForJob(jobId) {
  if (!jobId) return null;
  for (let i = 0; i < 120; i += 1) {
    await sleep(1500);
    const s = (await api(BACK, `/admin/api/clustering/jobs/${jobId}`, { token: TOKEN })).json?.data
      ?.state;
    if (s === 'completed' || s === 'failed') return s;
  }
  return 'timeout';
}
const setDisplay = (patch) =>
  api(BACK, '/admin/api/display/config', { method: 'PATCH', token: TOKEN, body: patch });

/** Visible text: scripts/styles removed, tags stripped. */
function visibleText(h) {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ');
}
const jsonLdBlocks = (h) =>
  [...h.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const ALLOWED_INDEPENDENT = [/best independent game/gi];
function independentHits(text) {
  let t = text;
  for (const re of ALLOWED_INDEPENDENT) t = t.replace(re, ' ');
  return t.match(/[^.]{0,30}\bindependent(ly)?\b[^.]{0,30}/gi) ?? [];
}
const count = (h, needle) => h.split(needle).length - 1;
function maxAnchorDepth(h) {
  let depth = 0;
  let max = 0;
  const re = /<a[\s>]|<\/a>/gi;
  let m;
  while ((m = re.exec(h)) !== null) {
    if (m[0].startsWith('</')) depth = Math.max(0, depth - 1);
    else {
      depth += 1;
      if (depth > max) max = depth;
    }
  }
  return max;
}
function cssRule(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${esc}\\s*\\{([^}]*)\\}`));
  return m ? m[1] : '';
}
const topicSlugOfGuid = (guid) =>
  sqlOne(
    `SELECT t.slug FROM topics t JOIN article_topics at ON at.topic_id=t.id JOIN articles a ON a.id=at.article_id WHERE a.external_guid='${guid}' LIMIT 1`,
  );
const articleIdOfGuid = (guid) => sqlOne(`SELECT id FROM articles WHERE external_guid='${guid}'`);

function print() {
  let pass = 0;
  for (const r of results) {
    if (r.ok) pass += 1;
    console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.detail ? `  — ${r.detail}` : ''}`);
  }
  console.log(`\n${pass}/${results.length} checks passed`);
  process.exit(pass === results.length ? 0 : 1);
}

// State this run creates, cleaned up in `finally` (re-run safe).
const cleanup = { display: null, integrityResets: [], integrityDeletes: [], voteUsers: [] };

async function s1() {
  // Defaults for the run (restored after): the spec's acceptance is "at default".
  const original = (await api(BACK, '/admin/api/display/config', { token: TOKEN })).json?.data;
  cleanup.display = original
    ? {
        displayScope: original.displayScope,
        showQuality: original.showQuality,
        topicBiasVotes: original.topicBiasVotes,
        integrityAutoPublish: original.integrityAutoPublish,
      }
    : null;
  await setDisplay({
    displayScope: 'reviews_and_sponsored',
    showQuality: false,
    topicBiasVotes: false,
    integrityAutoPublish: false,
  });

  // Make sure the integrity scan has run on this volume (idempotent rescan).
  const rescan = await api(BACK, '/admin/api/integrity/rescan', { method: 'POST', token: TOKEN });
  const rescanState = await waitForJob(rescan.json?.jobId);

  // Fixtures (DB truth): a multi-article news topic with no review/sponsored
  // article, the Hades II review topic, and a sponsored news topic.
  const newsSlug = sqlOne(
    `SELECT t.slug FROM topics t JOIN article_topics at ON at.topic_id=t.id JOIN articles a ON a.id=at.article_id WHERE t.bias_distribution IS NOT NULL GROUP BY t.slug HAVING count(*) >= 3 AND bool_and(a.article_type <> 'review') AND bool_and(NOT a.is_sponsored) ORDER BY count(*) DESC, t.slug LIMIT 1`,
  );
  const reviewSlug = topicSlugOfGuid('hades2-launch-ign');
  const sponsoredSlug = sqlOne(
    `SELECT t.slug FROM topics t JOIN article_topics at ON at.topic_id=t.id JOIN articles a ON a.id=at.article_id WHERE t.bias_distribution IS NOT NULL GROUP BY t.slug HAVING bool_or(a.is_sponsored) AND bool_and(a.article_type <> 'review') LIMIT 1`,
  );

  // ── S1.1 display scope ──────────────────────────────────────────────────────
  const newsApi = (await api(BACK, `/public/topic/${newsSlug}`)).json?.data;
  const newsHtml = await html(`/topics/${newsSlug}`);
  const reviewApi = (await api(BACK, `/public/topic/${reviewSlug}`)).json?.data;
  const reviewHtml = await html(`/topics/${reviewSlug}`);
  const reviewRows = (reviewApi?.articles ?? []).filter((a) => a.isReview).length;
  const newsNoPanel =
    newsApi?.showPanel === false &&
    count(newsHtml, 'gk-biasbar') === 0 &&
    count(newsHtml, 'gk-flag ') === 0;
  const reviewPanel =
    reviewApi?.showPanel === true &&
    count(reviewHtml, 'gk-biasbar') >= 1 &&
    reviewRows > 0 &&
    count(reviewHtml, 'class="gk-integrity"') === reviewRows;
  await setDisplay({ displayScope: 'all' });
  const newsHtmlAll = await html(`/topics/${newsSlug}`);
  const allBringsBack = count(newsHtmlAll, 'gk-biasbar') >= 1 && count(newsHtmlAll, 'gk-flag ') > 0;
  await setDisplay({ displayScope: 'reviews_and_sponsored' });
  check(
    'S1.1 (acc.1) news topic w/o sponsored → no bias panel/chips; a review → panel + integrity block; scope=all restores it',
    newsNoPanel && reviewPanel && allBringsBack,
    `news=${newsSlug} panel=${count(newsHtml, 'gk-biasbar')} chips=${count(newsHtml, 'gk-flag ')} · review=${reviewSlug} panel=${count(reviewHtml, 'gk-biasbar')} integrity=${count(reviewHtml, 'class="gk-integrity"')}/${reviewRows} · all→panel=${count(newsHtmlAll, 'gk-biasbar')}`,
  );

  // ── S1.2 no "Independent" bias label in public SSR ─────────────────────────
  const sourceSlugs = sqlOne(`SELECT slug FROM sources WHERE status='active' ORDER BY slug`)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const routes = [
    '/',
    '/topics',
    `/topics/${newsSlug}`,
    `/topics/${reviewSlug}`,
    ...(sponsoredSlug ? [`/topics/${sponsoredSlug}`] : []),
    '/games',
    '/games/browse',
    '/games/hades-ii',
    '/games/elden-ring',
    '/games/cyberpunk-2077',
    '/upcoming',
    '/sources',
    ...sourceSlugs.map((s) => `/sources/${s}`),
    '/methodology',
    '/about',
    '/contact',
    '/promote',
    '/awards',
    '/feed',
    '/login',
  ];
  const offenders = [];
  let classHits = 0;
  for (const r of routes) {
    const h = await html(r);
    const hits = [...independentHits(visibleText(h)), ...jsonLdBlocks(h).flatMap(independentHits)];
    if (hits.length) offenders.push(`${r}: ${hits[0].trim()}`);
    classHits += count(h, 'gk-flag independent') + count(h, 'gk-trend-flag independent');
  }
  check(
    `S1.2 (acc.2) no "Independent" bias label in public SSR (${routes.length} routes, visible text + JSON-LD)`,
    offenders.length === 0 && classHits === 0,
    offenders.length ? offenders.slice(0, 3).join(' | ') : `0 hits, ${classHits} flag classes`,
  );

  // ── S1.3 defaults: votes rejected + no quality ─────────────────────────────
  const voter = await makeVerified('vote');
  cleanup.voteUsers.push(voter.id);
  const topicId = reviewApi?.id;
  const vote = () =>
    api(BACK, `/community/topics/${topicId}/bias-vote`, {
      method: 'POST',
      jar: voter.jar,
      csrf: voter.csrf,
      body: { axis: 'influence', value: 1 },
    });
  const rows = () =>
    Number(
      sqlOne(
        `SELECT count(*) FROM topic_bias_votes WHERE topic_id='${topicId}' AND user_id='${voter.id}'`,
      ),
    );
  const offVote = await vote();
  const offRows = rows();
  const offAgg = (await api(BACK, `/community/topics/${topicId}/bias`)).json;
  const noQuality =
    count(reviewHtml, 'gk-bias-track') === 0 &&
    !/Quality\s*<small>/.test(reviewHtml) &&
    reviewApi?.distribution?.quality === null &&
    (reviewApi?.articles ?? []).every((a) => a.quality === null);
  await setDisplay({ showQuality: true, topicBiasVotes: true });
  const onVote = await vote();
  const onRows = rows();
  const onHtml = await html(`/topics/${reviewSlug}`);
  const qualityBack = count(onHtml, 'gk-bias-track') > 0 && onHtml.includes('Reader read');
  await setDisplay({ showQuality: false, topicBiasVotes: false });
  const offAgain = await vote();
  const keptRows = rows();
  const offAggAgain = (await api(BACK, `/community/topics/${topicId}/bias`)).json;
  check(
    'S1.3 (acc.3) defaults: topic bias-vote POST rejected (403, no row) + aggregate hidden; no quality bar/values; ON works; OFF again → rejected, stored vote kept unshown',
    offVote.status === 403 &&
      offVote.json?.error === 'feature_disabled' &&
      offRows === 0 &&
      offAgg?.enabled === false &&
      offAgg?.data === null &&
      noQuality &&
      onVote.status === 200 &&
      onRows === 1 &&
      qualityBack &&
      offAgain.status === 403 &&
      keptRows === 1 &&
      offAggAgain?.enabled === false &&
      !(await html(`/topics/${reviewSlug}`)).includes('Reader read'),
    `off=${offVote.status}/${offRows} quality-hidden=${noQuality} on=${onVote.status}/${onRows} qualityBar=${qualityBack} offAgain=${offAgain.status} kept=${keptRows}`,
  );

  // ── S1.4 briefing counts, no percentage ────────────────────────────────────
  const home = (await api(BACK, '/public/homepage')).json?.data;
  const homeHtml = await html('/');
  const b = home?.briefing ?? {};
  const briefHtml = (homeHtml.match(
    /<div class="gk-briefing"[\s\S]*?class="gk-briefing-items"[\s\S]*?<\/div>/,
  ) ?? [''])[0];
  const hiSql = b.isToday ? 'now()' : `'${b.asOf}'::timestamptz`;
  const loSql = `(${hiSql} - interval '${Number(b.windowHours)} hours')`;
  const truth = sqlOne(
    `SELECT (SELECT count(DISTINCT source_id) FROM articles WHERE source_id IS NOT NULL AND publish_date > ${loSql} AND publish_date <= ${hiSql}) || ',' || (SELECT count(DISTINCT at.topic_id) FROM article_topics at JOIN articles a ON a.id=at.article_id JOIN topics t ON t.id=at.topic_id WHERE t.bias_distribution IS NOT NULL AND a.publish_date > ${loSql} AND a.publish_date <= ${hiSql}) || ',' || (SELECT count(*) FROM articles WHERE article_type='review' AND publish_date > ${loSql} AND publish_date <= ${hiSql})`,
  );
  const visibleBrief = visibleText(briefHtml);
  check(
    'S1.4 (acc.4) briefing = sources · topics · reviews counts (DB truth), no independence percentage',
    briefHtml.length > 0 &&
      !('independentPct' in b) &&
      !/%/.test(visibleBrief) &&
      !/independ/i.test(visibleBrief) &&
      /source/.test(visibleBrief) &&
      /topic/.test(visibleBrief) &&
      /review/.test(visibleBrief) &&
      truth === `${b.sources},${b.topics},${b.reviews}`,
    `"${visibleBrief.trim()}" api=${b.sources},${b.topics},${b.reviews} db=${truth} today=${b.isToday}`,
  );

  // ── S1.5 integrity ──────────────────────────────────────────────────────────
  const sigCount = (guid) =>
    Number(
      sqlOne(
        `SELECT count(*) FROM article_integrity_signals s JOIN articles a ON a.id=s.article_id WHERE a.external_guid='${guid}'`,
      ),
    );
  const negatedNone =
    sigCount('hades2-launch-pc-gamer') === 0 && sigCount('ds2-reviews-polygon') === 0;
  const positivesFiled =
    sigCount('hades2-launch-ign') >= 1 && sigCount('ds2-reviews-eurogamer') >= 2;
  check(
    'S1.5a a NEGATED disclosure creates no signal ("no review code was provided" / "not under embargo"); real ones are filed',
    rescanState === 'completed' && negatedNone && positivesFiled,
    `rescan=${rescanState} negated=${sigCount('hades2-launch-pc-gamer')}+${sigCount('ds2-reviews-polygon')} positive=${sigCount('hades2-launch-ign')}+${sigCount('ds2-reviews-eurogamer')}`,
  );

  const ignId = articleIdOfGuid('hades2-launch-ign');
  const ignSignal = sqlOne(
    `SELECT id || '|' || status || '|' || evidence_snippet FROM article_integrity_signals WHERE article_id='${ignId}' AND kind='review_copy'`,
  ).split('|');
  const [sigId, sigStatus, snippet] = ignSignal;
  const ignRow = () =>
    api(BACK, `/public/topic/${reviewSlug}`).then(
      (r) => (r.json?.data?.articles ?? []).find((a) => a.id === ignId) ?? null,
    );
  const before = await ignRow();
  const hiddenWhileDetected =
    sigStatus === 'detected' &&
    before?.integrity?.length === 0 &&
    !(await html(`/topics/${reviewSlug}`)).includes(snippet.slice(0, 40));
  await setDisplay({ integrityAutoPublish: true });
  const autoPub = await ignRow();
  const shownWithAuto = autoPub?.integrity?.some((r) => r.kind === 'review_copy' && !r.confirmed);
  await setDisplay({ integrityAutoPublish: false });
  check(
    'S1.5b a DETECTED but unconfirmed signal is not public while autoPublish is off (and is with it on)',
    hiddenWhileDetected && shownWithAuto,
    `status=${sigStatus} publicRows(off)=${before?.integrity?.length} shown(on)=${shownWithAuto}`,
  );

  const mod = await login('demo-moderator', DEMO_PW);
  const reg = await makeVerified('nonstaff');
  const anonConfirm = await api(BACK, `/admin/api/integrity/signals/${sigId}/confirm`, {
    method: 'POST',
    body: {},
  });
  const regConfirm = await api(BACK, `/admin/api/integrity/signals/${sigId}/confirm`, {
    method: 'POST',
    jar: reg.jar,
    csrf: reg.csrf,
    body: {},
  });
  const modConfirm = await api(BACK, `/admin/api/integrity/signals/${sigId}/confirm`, {
    method: 'POST',
    jar: mod.jar,
    csrf: mod.csrf,
    body: {},
  });
  cleanup.integrityResets.push(sigId);
  const afterHtml = await html(`/topics/${reviewSlug}`);
  const ignUrl = sqlOne(`SELECT url FROM articles WHERE id='${ignId}'`);
  // The evidence row itself must carry the snippet, the confirmation and its own
  // link out to the source article (not just the row's headline link).
  const at = afterHtml.indexOf(snippet.slice(0, 40));
  const evidenceRow = at >= 0 ? afterHtml.slice(at, at + 1500) : '';
  const confirmedPublic =
    evidenceRow.includes('Confirmed by an editor') &&
    evidenceRow.includes(`href="${ignUrl}"`) &&
    evidenceRow.includes('Source ↗');
  const audited = Number(
    sqlOne(
      `SELECT count(*) FROM audit_logs WHERE entity_type='article-integrity' AND entity_id='${sigId}' AND actor_label='demo-moderator'`,
    ),
  );
  check(
    'S1.5c moderator confirm → public with its snippet + source link, audited; registered 403, anon 401',
    anonConfirm.status === 401 &&
      regConfirm.status === 403 &&
      modConfirm.status === 200 &&
      confirmedPublic &&
      audited >= 1,
    `anon=${anonConfirm.status} registered=${regConfirm.status} moderator=${modConfirm.status} public=${confirmedPublic} audit=${audited}`,
  );

  const xssNote = '<script>alert("p1")</script> Reviewed under embargo per the outlet';
  const add = await api(BACK, `/admin/api/integrity/articles/${ignId}/signals`, {
    method: 'POST',
    jar: mod.jar,
    csrf: mod.csrf,
    body: { kind: 'embargo', note: xssNote, evidenceDate: '2026-05-19' },
  });
  const addedId = sqlOne(
    `SELECT id FROM article_integrity_signals WHERE article_id='${ignId}' AND kind='embargo' AND origin='editor'`,
  );
  if (addedId) cleanup.integrityDeletes.push(addedId);
  const xssHtml = await html(`/topics/${reviewSlug}`);
  const newsArticle = sqlOne(
    `SELECT id FROM articles WHERE article_type='news' AND external_guid IS NOT NULL LIMIT 1`,
  );
  const notReview = await api(BACK, `/admin/api/integrity/articles/${newsArticle}/signals`, {
    method: 'POST',
    jar: mod.jar,
    csrf: mod.csrf,
    body: { kind: 'embargo', note: 'should not apply', evidenceDate: '2026-05-19' },
  });
  const addAudited = Number(
    sqlOne(
      `SELECT count(*) FROM audit_logs WHERE entity_type='article-integrity' AND entity_id='${addedId}' AND action='create'`,
    ),
  );
  check(
    'S1.5d editor-added signal: audited, its note rendered ESCAPED (stored <script> inert); a non-review → 409',
    add.status === 201 &&
      addAudited === 1 &&
      xssHtml.includes('&lt;script&gt;alert(') &&
      !xssHtml.includes('<script>alert("p1")') &&
      notReview.status === 409,
    `add=${add.status} audit=${addAudited} escaped=${xssHtml.includes('&lt;script&gt;alert(')} nonReview=${notReview.status}`,
  );

  // Self-review regression: the topic panel must never call an article "no
  // signals found" while its row shows a found signal. The exact case: a review
  // whose ONLY public signal is an integrity row (an editor-added embargo on the
  // PC Gamer review, which has no flag and whose disclosure was negated). Scope
  // `all` so every row carries its full public signals.
  const pcgId = articleIdOfGuid('hades2-launch-pc-gamer');
  const pcgAdd = await api(BACK, `/admin/api/integrity/articles/${pcgId}/signals`, {
    method: 'POST',
    jar: mod.jar,
    csrf: mod.csrf,
    body: { kind: 'embargo', note: 'Embargo noted on the outlet page', evidenceDate: '2026-05-19' },
  });
  const pcgSig = sqlOne(
    `SELECT id FROM article_integrity_signals WHERE article_id='${pcgId}' AND kind='embargo' AND origin='editor'`,
  );
  if (pcgSig) cleanup.integrityDeletes.push(pcgSig);
  await setDisplay({ displayScope: 'all' });
  const allApi = (await api(BACK, `/public/topic/${reviewSlug}`)).json?.data;
  await setDisplay({ displayScope: 'reviews_and_sponsored' });
  const rowsNoSignal = (allApi?.articles ?? []).filter(
    (a) => a.flags.length === 0 && (a.integrity?.length ?? 0) === 0,
  ).length;
  check(
    'S1.5g topic panel agrees with its rows: "no signals found" counts only rows with no flag AND no integrity row; found embargo is counted',
    pcgAdd.status === 201 &&
      allApi?.integrityTally?.embargo >= 2 &&
      (allApi?.articles ?? []).some((r) => r.id === pcgId && r.flags.length === 0) &&
      allApi?.flags?.independent === rowsNoSignal,
    `add=${pcgAdd.status} panel noSignal=${allApi?.flags?.independent} rows noSignal=${rowsNoSignal} embargo=${allApi?.integrityTally?.embargo}`,
  );

  const maxSnippet = Number(
    sqlOne(`SELECT coalesce(max(length(evidence_snippet)),0) FROM article_integrity_signals`),
  );
  const game = (await api(BACK, '/public/game/hades-ii')).json?.data;
  const gameHtml = await html('/games/hades-ii');
  const emptyReviews = (game?.reviews ?? []).filter((r) => (r.integrity ?? []).length === 0).length;
  check(
    'S1.5e snippets ≤ 200 chars; each review without public signals shows exactly ONE "No signals found" line',
    maxSnippet > 0 &&
      maxSnippet <= 200 &&
      count(gameHtml, 'class="gk-integrity-none"') === emptyReviews &&
      emptyReviews > 0,
    `maxSnippet=${maxSnippet} noneLines=${count(gameHtml, 'class="gk-integrity-none"')} reviewsWithout=${emptyReviews}`,
  );

  // Self-review regressions: a bad evidence date is a 400 (was a 500 / a silent
  // roll-over), and a moderator's confirming NOTE never replaces the linked
  // source quote as the public evidence.
  const badDate = await api(BACK, `/admin/api/integrity/articles/${ignId}/signals`, {
    method: 'POST',
    jar: mod.jar,
    csrf: mod.csrf,
    body: { kind: 'sponsored_event', note: 'date probe', evidenceDate: '2026-13-45' },
  });
  const rollDate = await api(BACK, `/admin/api/integrity/articles/${ignId}/signals`, {
    method: 'POST',
    jar: mod.jar,
    csrf: mod.csrf,
    body: { kind: 'sponsored_event', note: 'date probe', evidenceDate: '2026-02-30' },
  });
  const ds2Id = articleIdOfGuid('ds2-reviews-eurogamer');
  const ds2Sig = sqlOne(
    `SELECT id FROM article_integrity_signals WHERE article_id='${ds2Id}' AND kind='review_copy' AND origin='auto'`,
  );
  const ds2Snippet = sqlOne(
    `SELECT evidence_snippet FROM article_integrity_signals WHERE id='${ds2Sig}'`,
  );
  const withNote = await api(BACK, `/admin/api/integrity/signals/${ds2Sig}/confirm`, {
    method: 'POST',
    jar: mod.jar,
    csrf: mod.csrf,
    body: { note: 'Checked against the outlet page' },
  });
  if (ds2Sig) cleanup.integrityResets.push(ds2Sig);
  const ds2Slug = topicSlugOfGuid('ds2-reviews-eurogamer');
  const ds2Row = ((await api(BACK, `/public/topic/${ds2Slug}`)).json?.data?.articles ?? []).find(
    (a) => a.id === ds2Id,
  );
  const ds2Public = (ds2Row?.integrity ?? []).find((r) => r.kind === 'review_copy');
  check(
    'S1.5f bad evidence dates → 400 (not 500, no roll-over); a confirming note never replaces the source quote',
    badDate.status === 400 &&
      rollDate.status === 400 &&
      withNote.status === 200 &&
      ds2Public?.evidenceType === 'snippet' &&
      ds2Public?.evidence === ds2Snippet &&
      ds2Public?.confirmed === true,
    `13-45=${badDate.status} 02-30=${rollDate.status} confirm=${withNote.status} evidence=${ds2Public?.evidenceType}`,
  );

  // ── S1.6 game page: Reviews block pinned above the news ─────────────────────
  const reviewsAt = gameHtml.indexOf('aria-label="Reviews"');
  const newsAt = gameHtml.indexOf('aria-label="In the news"');
  check(
    'S1.6 game page: Reviews block sits above "In the news"; the news list holds no reviews',
    reviewsAt > 0 &&
      (newsAt === -1 || reviewsAt < newsAt) &&
      (game?.reviews ?? []).length > 0 &&
      (game?.reviews ?? []).every((r) => r.isReview) &&
      (game?.articles ?? []).every((a) => !a.isReview),
    `reviews@${reviewsAt} news@${newsAt} reviews=${game?.reviews?.length} news=${game?.articles?.length}`,
  );

  // ── S1.7 no "Lead source" ───────────────────────────────────────────────────
  const primaryStored = Number(sqlOne(`SELECT count(*) FROM article_topics WHERE is_primary`));
  const leadHits =
    count(newsHtml, 'Lead source') +
    count(reviewHtml, 'Lead source') +
    count(xssHtml, 'Lead source');
  check(
    'S1.7 no "Lead source" badge on topic pages; is_primary still stored, not in the public payload',
    leadHits === 0 &&
      primaryStored > 0 &&
      (reviewApi?.articles ?? []).every((a) => !('isPrimary' in a)),
    `hits=${leadHits} primaryRows=${primaryStored}`,
  );

  // ── S1.8 neutral no-signal chip ─────────────────────────────────────────────
  let css = '';
  try {
    css = readFileSync(CSS_PATH, 'utf8');
  } catch {
    /* reported below */
  }
  const noSig = cssRule(css, '.gk-flag.nosignal');
  const trendNoSig = cssRule(css, '.gk-trend-flag.nosignal');
  const greenOrRed = /#7fd29a|#5bd07f|rgba\(67,\s*183,\s*104|#e5594a|green/i;
  check(
    'S1.8 "No signals found" chip is NEUTRAL (no green, no red); no `independent` flag rule remains',
    noSig.length > 0 &&
      !greenOrRed.test(noSig) &&
      !greenOrRed.test(trendNoSig) &&
      cssRule(css, '.gk-flag.independent') === '' &&
      cssRule(css, '.gk-trend-flag.independent') === '',
    `nosignal{${noSig.trim().replace(/\s+/g, ' ')}}`,
  );

  // ── S1.9 display switches: RBAC + audit ─────────────────────────────────────
  const adm = await login('demo-admin', DEMO_PW);
  const modPatch = await api(BACK, '/admin/api/display/config', {
    method: 'PATCH',
    jar: mod.jar,
    csrf: mod.csrf,
    body: { showQuality: true },
  });
  const auditBefore = Number(
    sqlOne(`SELECT count(*) FROM audit_logs WHERE entity_type='app-settings' AND entity_id='bias'`),
  );
  const admPatch = await api(BACK, '/admin/api/display/config', {
    method: 'PATCH',
    jar: adm.jar,
    csrf: adm.csrf,
    body: { showQuality: true },
  });
  const lastAudit = sqlOne(
    `SELECT actor_label || '|' || (changes->'showQuality'->>'from') || '|' || (changes->'showQuality'->>'to') FROM audit_logs WHERE entity_type='app-settings' AND entity_id='bias' ORDER BY created_at DESC LIMIT 1`,
  );
  await setDisplay({ showQuality: false });
  const modIntegrityRead = (await api(BACK, '/admin/api/integrity/reviews', { jar: mod.jar }))
    .status;
  check(
    'S1.9 display switches: moderator 403, admin 200 + audited old→new; moderator reads the integrity queue',
    modPatch.status === 403 &&
      admPatch.status === 200 &&
      Number(
        sqlOne(
          `SELECT count(*) FROM audit_logs WHERE entity_type='app-settings' AND entity_id='bias'`,
        ),
      ) > auditBefore &&
      lastAudit === 'demo-admin|false|true' &&
      modIntegrityRead === 200,
    `mod=${modPatch.status} admin=${admPatch.status} audit=${lastAudit} modQueue=${modIntegrityRead}`,
  );

  // ── S1.10 engine unchanged ──────────────────────────────────────────────────
  const unscored = Number(
    sqlOne(
      `SELECT count(*) FROM articles WHERE external_guid IS NOT NULL AND (influence_score IS NULL OR quality_score IS NULL)`,
    ),
  );
  const scored = Number(
    sqlOne(`SELECT count(*) FROM articles WHERE influence_breakdown IS NOT NULL`),
  );
  check(
    'S1.10 engine unchanged: every feed article still carries both stored scores (display-only change)',
    unscored === 0 && scored > 0,
    `unscored=${unscored} scored=${scored}`,
  );

  // ── S1.11 zero nested anchors ───────────────────────────────────────────────
  const depthPages = [
    '/',
    `/topics/${newsSlug}`,
    `/topics/${reviewSlug}`,
    '/games/hades-ii',
    '/sources/ign',
  ];
  const depths = [];
  for (const p of depthPages) depths.push(maxAnchorDepth(await html(p)));
  check(
    'S1.11 zero nested anchors (max <a> depth 1) on home / topics / game / source',
    depths.every((d) => d === 1),
    depths.join(','),
  );

  // ── S1.12 Methodology rename line ───────────────────────────────────────────
  const meth = visibleText(await html('/methodology'));
  check(
    'S1.12 Methodology explains the rename in one line (show what we found; cannot prove what isn’t there)',
    /No signals found/.test(meth) && /cannot\s+prove what isn.t there/i.test(meth),
    '',
  );

  // ── S1.13 copy renders with its spaces ──────────────────────────────────────
  // Self-review regression: the JSX compiler drops the leading space of a
  // multi-line text node after an inline element ("found.”We", "thresholdswould").
  const gluePages = ['/', '/methodology', '/about', '/contact', '/privacy', '/terms', '/promote'];
  const glued = [];
  for (const p of gluePages) {
    const h = (await html(p)).replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<!-- -->/g, '');
    for (const m of h.matchAll(/<\/(strong|b|em|a)>([A-Za-z]\w*)/g)) glued.push(`${p}:${m[2]}`);
  }
  check(
    'S1.13 public copy keeps its spaces (no word glued to a closing inline tag)',
    glued.length === 0,
    glued.length ? glued.slice(0, 4).join(' ') : `${gluePages.length} pages clean`,
  );
}

async function main() {
  if (!check('0. Stack ready (backend + SSR frontend)', await waitForReady())) return print();
  try {
    await s1();
  } finally {
    // Re-run safety: restore switches + undo this run's integrity/vote rows.
    if (cleanup.display) await setDisplay(cleanup.display);
    for (const id of cleanup.integrityResets) {
      sqlOne(
        `UPDATE article_integrity_signals SET status='detected', editor_note=NULL, decided_by_user_id=NULL, decided_by_label=NULL, decided_at=NULL WHERE id='${id}' AND origin='auto'`,
      );
    }
    for (const id of cleanup.integrityDeletes) {
      sqlOne(`DELETE FROM article_integrity_signals WHERE id='${id}'`);
    }
    // The S1.5f date probes must create nothing — but if a regression lets one
    // through, don't leave it behind for the next run.
    sqlOne(
      `DELETE FROM article_integrity_signals WHERE origin='editor' AND editor_note='date probe'`,
    );
    for (const uid of cleanup.voteUsers) {
      sqlOne(`DELETE FROM topic_bias_votes WHERE user_id='${uid}'`);
    }
  }
  print();
}

main().catch((err) => {
  console.error('p-check crashed:', err);
  process.exit(1);
});
