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
 *
 *  H3 — hygiene 3 (before S2)
 *   H3.1  mock article dates relative to boot (newest just before boot, spacing
 *         kept; the briefing reads "today")
 *   H3.2  confirm + dismiss + bias override + editor note, FULL re-cluster → all
 *         still there (keyed to source + guid, re-linked, no duplicate rows)
 *   H3.3  Death Stranding 2: the game page Reviews block shows a confirmed signal
 *   H3.4  game status derived from release date (system-audited); a staff status
 *         edit locks it; unlocking hands it back
 *   H3.5  a source with a parent company cannot be typed "Standalone" (400)
 *   H3.6  polish: no public "resolved" chip; an echoing subtitle hidden; "No
 *         signals found" rows short + one explanation per block; related links
 *         in brand colours
 *   H3.7  after the full ladder no verify fixture on any public route or in the DB
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { lit, psql, purgeFixtures, runJobAndWait } from './lib/fixtures.mjs';

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
  const sigPrior = rowJson('article_integrity_signals', sigId, SIGNAL_COLS);
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
  cleanup.integrityResets.push({ id: sigId, json: sigPrior });
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
  const ds2Prior = ds2Sig ? rowJson('article_integrity_signals', ds2Sig, SIGNAL_COLS) : null;
  const withNote = await api(BACK, `/admin/api/integrity/signals/${ds2Sig}/confirm`, {
    method: 'POST',
    jar: mod.jar,
    csrf: mod.csrf,
    body: { note: 'Checked against the outlet page' },
  });
  if (ds2Sig) cleanup.integrityResets.push({ id: ds2Sig, json: ds2Prior });
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

// ═══════════════════════ Phase P hygiene 3 (group H3) ═══════════════════════
// Restored exactly at the end (finally): signal decisions + article editorial
// fields this group touches, the game it locks, the fixture source it creates.
const h3Restore = { signals: [], articles: [], sources: [] };

/** One row as JSON (its prior state), for an exact restore. */
const rowJson = (table, id, cols) =>
  psql(`SELECT row_to_json(x) FROM (SELECT ${cols} FROM ${table} WHERE id = ${lit(id)}) x;`);

const SIGNAL_COLS = 'status, editor_note, decided_by_user_id, decided_by_label, decided_at';
const EDITORIAL_COLS =
  'editor_note, internal_assessment, influence_override, influence_override_reason, quality_override, quality_override_reason';

/** Put one signal's decision fields back exactly as snapshotted. */
function restoreSignal(id, json) {
  if (!id || !json) return;
  psql(
    `UPDATE article_integrity_signals s SET status = r.status, editor_note = r.editor_note, decided_by_user_id = r.decided_by_user_id, decided_by_label = r.decided_by_label, decided_at = r.decided_at FROM json_populate_record(NULL::article_integrity_signals, ${lit(json)}) r WHERE s.id = ${lit(id)};`,
  );
}

function restoreH3() {
  for (const { id, json } of [...h3Restore.signals].reverse()) restoreSignal(id, json);
  for (const { guid, json } of h3Restore.articles) {
    if (!json) continue;
    psql(
      `UPDATE articles a SET editor_note = r.editor_note, internal_assessment = r.internal_assessment, influence_override = r.influence_override, influence_override_reason = r.influence_override_reason, quality_override = r.quality_override, quality_override_reason = r.quality_override_reason FROM json_populate_record(NULL::articles, ${lit(json)}) r WHERE a.external_guid = ${lit(guid)};`,
    );
  }
  for (const id of h3Restore.sources) psql(`DELETE FROM sources WHERE id = ${lit(id)};`);
}

/** Run a catalog import (the derived status is synced after it) and wait for it by id. */
const importAndWait = () => runJobAndWait('/catalog/import', 'catalog', {}, 120_000);

async function h3() {
  // ── H3.1 mock article dates relative to boot ───────────────────────────────
  const newestEpoch = Number(
    psql(
      `SELECT extract(epoch FROM max(publish_date))::bigint FROM articles WHERE origin = 'aggregated';`,
    ),
  );
  const ageH = (Date.now() / 1000 - newestEpoch) / 3600;
  const briefing = (await api(BACK, '/public/homepage')).json?.data?.briefing;
  const oldest = Number(
    psql(
      `SELECT extract(epoch FROM min(publish_date))::bigint FROM articles WHERE origin = 'aggregated';`,
    ),
  );
  check(
    'H3.1 mock feed is relative to boot: newest article lands just before boot (never in the future), spacing kept; briefing reads "today"',
    Number.isFinite(ageH) &&
      ageH >= -0.02 &&
      ageH <= 24 &&
      briefing?.isToday === true &&
      // the bundled spacing (~17 months) survives the shift
      (newestEpoch - oldest) / 86400 > 300,
    `newest ${ageH.toFixed(2)}h ago, span ${((newestEpoch - oldest) / 86400).toFixed(0)}d, briefing.isToday=${briefing?.isToday}`,
  );

  // ── H3.2 moderator decisions survive a FULL re-cluster ─────────────────────
  const mod = await login('demo-moderator', DEMO_PW);
  const DS2 = 'death-stranding-2-on-the-beach';
  const ds2Guid = 'ds2-reviews-eurogamer';
  const sigIdOf = (kind) =>
    psql(
      `SELECT id FROM article_integrity_signals WHERE external_guid = ${lit(ds2Guid)} AND kind = ${lit(kind)};`,
    );
  const rcId = sigIdOf('review_copy');
  const emId = sigIdOf('embargo');
  for (const id of [rcId, emId].filter(Boolean)) {
    h3Restore.signals.push({ id, json: rowJson('article_integrity_signals', id, SIGNAL_COLS) });
  }
  const edGuid = 'ds2-reviews-gamespot';
  h3Restore.articles.push({
    guid: edGuid,
    json: psql(
      `SELECT row_to_json(x) FROM (SELECT ${EDITORIAL_COLS} FROM articles WHERE external_guid = ${lit(edGuid)}) x;`,
    ),
  });
  const decide = (id, action) =>
    api(BACK, `/admin/api/integrity/signals/${id}/${action}`, {
      method: 'POST',
      jar: mod.jar,
      csrf: mod.csrf,
      body: {},
    });
  const conf = rcId ? await decide(rcId, 'confirm') : { status: 0 };
  const dism = emId ? await decide(emId, 'dismiss') : { status: 0 };
  const edBefore = articleIdOfGuid(edGuid);
  const ovNote = `H3 note ${RUN}`;
  const ov = await api(BACK, `/admin/api/bias/article/${edBefore}/override`, {
    method: 'POST',
    token: TOKEN,
    body: { influenceScore: 12, reason: `H3 carryover ${RUN}` },
  });
  const note = await api(BACK, `/admin/api/bias/article/${edBefore}/note`, {
    method: 'POST',
    token: TOKEN,
    body: { editorNote: ovNote },
  });
  const rcArticleBefore = psql(
    `SELECT article_id FROM article_integrity_signals WHERE id = ${lit(rcId)};`,
  );
  const reset = await api(BACK, '/admin/api/clustering/ingest', {
    method: 'POST',
    token: TOKEN,
    body: { reset: true },
  });
  const resetState = await waitForJob(reset.json?.jobId);
  const ds2Article = articleIdOfGuid(ds2Guid);
  const [rcStatus, rcArticle] = psql(
    `SELECT status || '|' || coalesce(article_id::text, '') FROM article_integrity_signals WHERE id = ${lit(rcId)};`,
  ).split('|');
  const emStatus = psql(`SELECT status FROM article_integrity_signals WHERE id = ${lit(emId)};`);
  const edAfter = psql(
    `SELECT coalesce(influence_override::text, '') || '|' || coalesce(editor_note, '') FROM articles WHERE external_guid = ${lit(edGuid)};`,
  );
  const carryLeft = Number(psql('SELECT count(*) FROM article_editorial_carryover;'));
  const dupSignals = Number(
    psql(
      `SELECT count(*) FROM article_integrity_signals WHERE external_guid = ${lit(ds2Guid)} AND kind IN ('review_copy', 'embargo');`,
    ),
  );
  check(
    'H3.2 a full re-cluster keeps moderator decisions: confirmed stays confirmed, dismissed stays dismissed (re-linked to the new article row, no duplicate), bias override + editor note restored',
    conf.status === 200 &&
      dism.status === 200 &&
      ov.status === 200 &&
      note.status === 200 &&
      resetState === 'completed' &&
      rcStatus === 'confirmed' &&
      emStatus === 'dismissed' &&
      rcArticle === ds2Article &&
      rcArticle !== rcArticleBefore &&
      dupSignals === 2 &&
      edAfter === `12|${ovNote}` &&
      carryLeft === 0,
    `reset=${resetState} rc=${rcStatus} em=${emStatus} relinked=${rcArticle === ds2Article && rcArticle !== rcArticleBefore} rows=${dupSignals} editorial=${edAfter} carryover=${carryLeft}`,
  );

  // ── H3.3 the DS2 game page reads confirmed signals ─────────────────────────
  const ds2Html = await html(`/games/${DS2}`);
  const ds2 = (await api(BACK, `/public/game/${DS2}`)).json?.data;
  const euro = (ds2?.reviews ?? []).find((r) => r.id === ds2Article);
  const withoutSignals = (ds2?.reviews ?? []).filter(
    (r) => (r.integrity ?? []).length === 0,
  ).length;
  check(
    'H3.3 Death Stranding 2: a confirmed review-copy signal shows in the game page Reviews block (not "No signals found"); the dismissed one stays hidden',
    euro?.integrity?.some((r) => r.kind === 'review_copy' && r.confirmed) &&
      !euro?.integrity?.some((r) => r.kind === 'embargo') &&
      ds2Html.includes('Confirmed by an editor') &&
      count(ds2Html, 'class="gk-integrity-none"') === withoutSignals,
    `euro=${JSON.stringify((euro?.integrity ?? []).map((r) => `${r.kind}:${r.confirmed}`))} noneLines=${count(ds2Html, 'class="gk-integrity-none"')}/${withoutSignals}`,
  );

  // ── H3.4 game status derived from the release date, manual override wins ───
  const gameRow = (slug) =>
    psql(
      `SELECT g.id || '|' || g.status || '|' || g.status_locked::text || '|' || coalesce(g.release_date, '') FROM games g JOIN subjects s ON s.id = g.subject_id WHERE s.slug = ${lit(slug)};`,
    ).split('|');
  const [ds2Id, ds2Status, , ds2Date] = gameRow(DS2);
  const derivedAudit = Number(
    psql(
      `SELECT count(*) FROM audit_logs WHERE entity_type = 'games' AND entity_id = ${lit(ds2Id)} AND actor_label = 'system:game-status';`,
    ),
  );
  const futureStillUpcoming = gameRow('grand-theft-auto-vi')[1];
  check(
    'H3.4a a pre-release game whose release date passed is "released" (DS2), audited as a system actor; a future one is untouched',
    ds2?.status === 'released' &&
      ds2Status === 'released' &&
      ds2Date <= new Date().toISOString().slice(0, 10) &&
      derivedAudit >= 1 &&
      ['announced', 'in_development'].includes(futureStillUpcoming),
    `ds2=${ds2?.status} (${ds2Date}) audit=${derivedAudit} gta6=${futureStillUpcoming}`,
  );
  // Lock: a staff status edit is a manual override the derivation leaves alone.
  const lockSlug = 'metroid-prime-4-beyond';
  const [lockId, lockStatus0, lockLocked0] = gameRow(lockSlug);
  const patchGame = (body) =>
    api(BACK, `/admin/api/games/${lockId}`, { method: 'PATCH', token: TOKEN, body });
  // Exactly what the admin form sends: the new status AND its (unticked) lock
  // checkbox — a status CHANGE must lock regardless.
  const setManual = await patchGame({ status: 'announced', statusLocked: false });
  const imp1 = await importAndWait();
  const [, lockedStatus, lockedFlag] = gameRow(lockSlug);
  const unlock = await patchGame({ statusLocked: false });
  const imp2 = await importAndWait();
  const [, unlockedStatus, unlockedFlag] = gameRow(lockSlug);
  check(
    "H3.4b manual override: a staff status change locks it (even with the form's unticked checkbox; sync leaves it), unlocking alone hands it back",
    lockStatus0 === 'released' &&
      lockLocked0 === 'false' &&
      setManual.status === 200 &&
      imp1.ok &&
      lockedStatus === 'announced' &&
      lockedFlag === 'true' &&
      unlock.status === 200 &&
      imp2.ok &&
      unlockedStatus === 'released' &&
      unlockedFlag === 'false',
    `start=${lockStatus0}/${lockLocked0} manual→${lockedStatus}/${lockedFlag} (import ${imp1.state}) unlocked→${unlockedStatus}/${unlockedFlag} (import ${imp2.state})`,
  );

  // ── H3.5 source rule: a parent company on record ≠ "Standalone" ────────────
  const standaloneId = psql(`SELECT id FROM source_types WHERE key = 'independent';`);
  const mainstreamId = psql(`SELECT id FROM source_types WHERE key = 'mainstream';`);
  const euroSrc = psql(`SELECT id FROM sources WHERE slug = 'eurogamer';`);
  const euroPatch = await api(BACK, `/admin/api/sources/${euroSrc}`, {
    method: 'PATCH',
    token: TOKEN,
    body: { typeId: standaloneId },
  });
  const created = await api(BACK, '/admin/api/sources', {
    method: 'POST',
    token: TOKEN,
    body: { name: `H3 Src ${RUN}`, parentCompany: 'Parent Corp', typeId: standaloneId },
  });
  const ok = await api(BACK, '/admin/api/sources', {
    method: 'POST',
    token: TOKEN,
    body: { name: `H3 Owned ${RUN}`, parentCompany: 'Parent Corp', typeId: mainstreamId },
  });
  const okId = ok.json?.data?.id;
  if (okId) h3Restore.sources.push(okId);
  const toStandalone = okId
    ? await api(BACK, `/admin/api/sources/${okId}`, {
        method: 'PATCH',
        token: TOKEN,
        body: { typeId: standaloneId },
      })
    : { status: 0 };
  const clearAndStandalone = okId
    ? await api(BACK, `/admin/api/sources/${okId}`, {
        method: 'PATCH',
        token: TOKEN,
        body: { parentCompany: '', typeId: standaloneId },
      })
    : { status: 0 };
  const violations = Number(
    psql(
      `SELECT count(*) FROM sources s JOIN source_types t ON t.id = s.type_id WHERE t.key = 'independent' AND coalesce(trim(s.parent_company), '') <> '';`,
    ),
  );
  const euroType = psql(
    `SELECT t.key FROM sources s JOIN source_types t ON t.id = s.type_id WHERE s.slug = 'eurogamer';`,
  );
  const msg = 'cannot be typed "Standalone"';
  const issue = (r) => (r.json?.issues ?? []).map((i) => i.message).join(' ');
  // The 400 names the rule only — it never echoes the stored row back.
  const noEcho = (r) => !r.text.includes('IGN Entertainment') && !r.text.includes('"input"');
  check(
    'H3.5 a source with a parent company cannot be typed "Standalone" (create + update → 400, validated on the merged row); Eurogamer is fixed; no violating row exists',
    euroPatch.status === 400 &&
      issue(euroPatch).includes(msg) &&
      noEcho(euroPatch) &&
      created.status === 400 &&
      issue(created).includes(msg) &&
      ok.status === 201 &&
      toStandalone.status === 400 &&
      clearAndStandalone.status === 200 &&
      euroType === 'mainstream' &&
      violations === 0,
    `euroPatch=${euroPatch.status} msg=${issue(euroPatch).includes(msg)} noEcho=${noEcho(euroPatch)} create=${created.status} owned→standalone=${toStandalone.status} cleared→standalone=${clearAndStandalone.status} eurogamer=${euroType} violations=${violations}`,
  );

  // ── H3.6 public polish ─────────────────────────────────────────────────────
  const resolvedSlug = psql(`SELECT slug FROM topics WHERE status = 'resolved' LIMIT 1;`);
  const resolvedHtml = resolvedSlug ? await html(`/topics/${resolvedSlug}`) : '';
  const homeHtml = await html('/');
  const noResolvedChip = (h) =>
    !h.includes('gk-status-resolved') && !/>\s*resolved\s*</i.test(h.replace(/<!--.*?-->/g, ''));
  check(
    'H3.6a the internal "resolved" topic state renders no public chip (topic page + homepage spotlight)',
    Boolean(resolvedSlug) && noResolvedChip(resolvedHtml) && noResolvedChip(homeHtml),
    `topic=${resolvedSlug} topicChip=${!noResolvedChip(resolvedHtml)} homeChip=${!noResolvedChip(homeHtml)}`,
  );
  const echo = psql(
    `SELECT slug || '|' || title FROM topics WHERE lower(regexp_replace(coalesce(tldr, ''), '[^a-zA-Z0-9]', '', 'g')) = lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g')) AND title ~ '^[A-Za-z0-9 :,.-]+$' LIMIT 1;`,
  ).split('|');
  const echoHtml = echo[0] ? await html(`/topics/${echo[0]}`) : '';
  const distinct = psql(
    `SELECT slug FROM topics WHERE tldr IS NOT NULL AND length(tldr) > 20 AND lower(regexp_replace(tldr, '[^a-zA-Z0-9]', '', 'g')) <> lower(regexp_replace(title, '[^a-zA-Z0-9]', '', 'g')) LIMIT 1;`,
  );
  const distinctHtml = distinct ? await html(`/topics/${distinct}`) : '';
  check(
    'H3.6b a subtitle that only repeats the title is hidden (a distinct one still shows)',
    Boolean(echo[0]) &&
      !echoHtml.includes('class="gk-story-tldr"') &&
      distinctHtml.includes('class="gk-story-tldr"'),
    `echo=${echo[0]} shown=${echoHtml.includes('class="gk-story-tldr"')} distinct=${distinct} shown=${distinctHtml.includes('class="gk-story-tldr"')}`,
  );
  const reviewsBlock = (() => {
    const i = ds2Html.indexOf('aria-label="Reviews"');
    const j = ds2Html.indexOf('</section>', i);
    return i >= 0 ? ds2Html.slice(i, j) : '';
  })();
  const noneRows = [...reviewsBlock.matchAll(/<p class="gk-integrity-none">([\s\S]*?)<\/p>/g)].map(
    (m) => m[1],
  );
  check(
    'H3.6c "No signals found" rows carry the short label only; the explanation appears once per block',
    noneRows.length >= 1 &&
      noneRows.every((t) => t === 'No signals found') &&
      count(reviewsBlock, 'cannot prove what isn') === 1 &&
      count(reviewsBlock, 'class="gk-nosignal-note"') === 1 &&
      count(ds2Html, 'gk-integrity-hint') === 0,
    `rows=${noneRows.length} labels=${JSON.stringify([...new Set(noneRows)])} explainers=${count(reviewsBlock, 'cannot prove what isn')}`,
  );
  const css = readFileSync(CSS_PATH, 'utf8');
  const relA = cssRule(css, '.gk-related a');
  const relHover = cssRule(css, '.gk-related a:focus-visible .gk-related-title');
  check(
    'H3.6d related-stories links use brand colours (no default-blue underline; amber on hover/focus)',
    /color:\s*var\(--gk-text\)/.test(relA) &&
      /text-decoration:\s*none/.test(relA) &&
      /text-decoration-color:\s*var\(--gk-accent\)/.test(relHover) &&
      /color:\s*var\(--gk-accent\)/.test(relHover),
    `a{${relA.trim().replace(/\s+/g, ' ')}}`,
  );
}

/** Fixture names every verify suite uses — none may reach a public page. */
const FIXTURE_RE =
  /Disconnect Probe|Bombtest|Fairtest Realm|Launchday Saga|Voidtest|Lowtest|I7 Nominee|I7 Test|__i7 verify|Verify (?:Game|Source|Topic|Suggest)|Typed Topic|UpPromo|Sec Adv|Lists Promo|H3 (?:note|carryover|Src|Owned)|\bgk_(?!voter[1-8]\b)[a-z0-9]+(?:_[a-z0-9]+)*_[0-9a-z]{8}\b|\bi4b[pu]\d+_|\bi8_[a-z0-9]+_|\bp_(?:vote|nonstaff)_/;

async function fixtureCrawl() {
  const routes = [
    '/',
    '/games',
    '/games/browse',
    '/upcoming',
    '/topics',
    '/sources',
    '/awards',
    '/sitemap.xml',
    '/games/age-of-empires-iv',
  ];
  const hits = [];
  for (const r of routes) {
    const res = await api(FRONT, r);
    const m = res.text.match(FIXTURE_RE);
    if (m) hits.push(`${r}: "${m[0]}"`);
  }
  for (const r of ['/public/homepage', '/public/catalog', '/public/upcoming']) {
    const res = await api(BACK, r);
    const m = res.text.match(FIXTURE_RE);
    if (m) hits.push(`${r}: "${m[0]}"`);
  }
  const dbLeft = psql(
    [
      "SELECT 'users:' || count(*) FROM users WHERE (username ~ '^(gk_|i4b[pu][0-9]|i8_|p_|f2_|verify_)' AND username !~ '^gk_voter[1-8]$') OR username LIKE 'deleted\\_%'",
      "UNION ALL SELECT 'games:' || count(*) FROM subjects WHERE slug ~ '^(disconnect-probe|bombtest|fairtest-realm|launchday-saga|voidtest|lowtest|i7-nominee-[ab]|verify-game)-'",
      "UNION ALL SELECT 'awards:' || ((SELECT count(*) FROM award_categories WHERE key LIKE 'i7cat\\_%') + (SELECT count(*) FROM award_editions WHERE name LIKE '\\_\\_i7 verify%'))",
      "UNION ALL SELECT 'subscriptions:' || count(*) FROM newsletter_subscriptions WHERE email ~ '@(example\\.test|verify\\.local)$'",
      "UNION ALL SELECT 'placements:' || count(*) FROM ad_placements WHERE advertiser_name ~ '^(UpPromo|Sec Adv|Lists Promo|F4 Adv) '",
      "UNION ALL SELECT 'sources:' || count(*) FROM sources WHERE name ~ '^(Verify Source|H3 (Src|Owned)) '",
      "UNION ALL SELECT 'topics:' || count(*) FROM topics WHERE title ~ '^(Verify Topic|Typed Topic) '",
      "UNION ALL SELECT 'queue:' || count(*) FROM unmatched_games WHERE raw_name ~ '^(Phantom Title|Spam Title|Verify Suggest|Burst|NoCsrf) ' OR raw_name LIKE '%<script>%'",
      "UNION ALL SELECT 'badges:' || count(*) FROM badges WHERE key LIKE 'i8\\_%';",
    ].join(' '),
  )
    .split('\n')
    .filter((l) => !l.endsWith(':0'));
  check(
    'H3.7 after the full ladder no verify fixture appears on any public route (pages, sitemap, public API) or remains in the database',
    hits.length === 0 && dbLeft.length === 0,
    hits.length || dbLeft.length
      ? `${hits.slice(0, 4).join(' · ')} ${dbLeft.join(' ')}`
      : `${routes.length + 3} routes clean, DB clean`,
  );
}

async function main() {
  if (!check('0. Stack ready (backend + SSR frontend)', await waitForReady())) return print();
  try {
    await s1();
    await h3();
  } finally {
    restoreH3();
    // Re-run safety: restore switches + undo this run's integrity/vote rows.
    if (cleanup.display) await setDisplay(cleanup.display);
    // Exact prior decision back (hygiene 3) — newest first, so a signal touched
    // twice ends where it started.
    for (const { id, json } of [...cleanup.integrityResets].reverse()) restoreSignal(id, json);
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
    // Hygiene 3: this run's accounts go too (their votes/sessions cascade).
    const purge = await purgeFixtures({ run: RUN, usernames: [`p\\_%\\_${RUN}`] });
    if (!purge.ok) check("Cleanup: this run's accounts removed", false, purge.detail.join(' '));
  }
  // Last (the ladder runs verify:p last): nothing any suite made is public.
  await fixtureCrawl();
  print();
}

main().catch((err) => {
  console.error('p-check crashed:', err);
  process.exit(1);
});
