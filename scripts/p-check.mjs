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
 *
 *  S2 — homepage sections (commit 1: schema, DB rejection, snapshots, settings, admin)
 *   S2.1  (acc. 1) reorder in admin → the homepage order follows after save; audited
 *   S2.2  (acc. 2) a Promoted placement on Trending / any data section → API 400 AND
 *         the DB rejects it (FK + CHECK); a data section cannot be re-typed sellable
 *   S2.3  (acc. 3) a discovery section holds ONE Promoted item at its position, with
 *         the advertiser; a 2nd active → 409; a story is never promotable
 *   S2.4  (acc. 4) too few samples → "—"; an empty previous window → "New"
 *   S2.5  (acc. 5) a pinned item keeps its position across refreshes
 *   S2.6  a ring of fresh accounts adds nothing to Trending; a credible one counts
 *   S2.7  Top rated ranks on the critic + community layers only
 *   S2.8  the homepage serves the STORED snapshots (no ranking on a request)
 *   S2.9  section edits validated per kind; RBAC
 *   S2.10 player counts sampled daily; the game chart stays weekly
 *   S2.11 the Standalone rule keys on the type’s stable role (rename-proof)
 *   S2.12 ads.showUnsoldPlaceholder default false, admin-set + audited
 *  S2 — commit 2 (homepage layout + copy, SSR)
 *   S2.13 (acc. 1) the rendered page follows the saved section order
 *   S2.14 (acc. 3) the Promoted label is render-forced under every switch; no data
 *         section renders a paid item
 *   S2.15 Δ on cards with its window (48h / 7d), New / — / ±%, neutral colours
 *   S2.16 (acc. 5) the Trending list keeps the section order — a pin holds its row
 *   S2.17 no Promoted row between outlet articles on story pages
 *   S2.18 unsold slots render nothing at default; the switch brings the box back
 *   S2.19 no stale copy; Community CTA; the newsletter form uses the consented path
 *   S2.20 spotlight band filled; no echoed headline; stacked 3-across cards
 *   S2.21 Our picks hidden while empty; neutral "Our pick" label when pinned
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import {
  auditSql,
  lit,
  psql,
  purgeFixtures,
  restoreSettings,
  runJobAndWait,
  snapshotSettings,
  waitForJob as waitForJobLib,
} from './lib/fixtures.mjs';

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

/** Put one signal's decision fields back exactly as snapshotted — audited. */
function restoreSignal(id, json) {
  if (!id || !json) return;
  const now = rowJson('article_integrity_signals', id, SIGNAL_COLS);
  if (!now || now === json) return;
  psql(
    [
      'BEGIN;',
      `UPDATE article_integrity_signals s SET status = r.status, editor_note = r.editor_note, decided_by_user_id = r.decided_by_user_id, decided_by_label = r.decided_by_label, decided_at = r.decided_at FROM json_populate_record(NULL::article_integrity_signals, ${lit(json)}) r WHERE s.id = ${lit(id)};`,
      auditSql({
        entityType: 'article-integrity',
        entityId: id,
        changes: { decision: { from: JSON.parse(now), to: JSON.parse(json) } },
        summary: 'verify cleanup restored the signal decision this run changed',
      }),
      'COMMIT;',
    ].join('\n'),
  );
}

function restoreH3() {
  for (const { id, json } of [...h3Restore.signals].reverse()) restoreSignal(id, json);
  for (const { guid, json } of h3Restore.articles) {
    if (!json) continue;
    const id = articleIdOfGuid(guid);
    const now = psql(
      `SELECT row_to_json(x) FROM (SELECT ${EDITORIAL_COLS} FROM articles WHERE external_guid = ${lit(guid)}) x;`,
    );
    if (!id || !now || now === json) continue;
    psql(
      [
        'BEGIN;',
        `UPDATE articles a SET editor_note = r.editor_note, internal_assessment = r.internal_assessment, influence_override = r.influence_override, influence_override_reason = r.influence_override_reason, quality_override = r.quality_override, quality_override_reason = r.quality_override_reason FROM json_populate_record(NULL::articles, ${lit(json)}) r WHERE a.external_guid = ${lit(guid)};`,
        auditSql({
          entityType: 'articles',
          entityId: id,
          changes: { editorial: { from: JSON.parse(now), to: JSON.parse(json) } },
          summary: 'verify cleanup restored the editorial fields this run changed',
        }),
        'COMMIT;',
      ].join('\n'),
    );
  }
  for (const id of h3Restore.sources) {
    psql(
      `BEGIN;\nDELETE FROM sources WHERE id = ${lit(id)};\n${auditSql({ action: 'delete', entityType: 'sources', entityId: id, summary: 'verify cleanup removed its fixture source' })}\nCOMMIT;`,
    );
  }
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
  /Disconnect Probe|Bombtest|Fairtest Realm|Launchday Saga|Voidtest|Lowtest|I7 Nominee|I7 Test|__i7 verify|Verify (?:Game|Source|Topic|Suggest)|Typed Topic|UpPromo|Sec Adv|Lists Promo|S2 Promo|H3 (?:note|carryover|Src|Owned)|\bgk_(?!voter[1-8]\b)[a-z0-9]+(?:_[a-z0-9]+)*_[0-9a-z]{8}\b|\bi4b[pu]\d+_|\bi8_[a-z0-9]+_|\bp_(?:vote|nonstaff)_/;

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
      "UNION ALL SELECT 'placements:' || count(*) FROM ad_placements WHERE advertiser_name ~ '^(UpPromo|Sec Adv|Lists Promo|F4 Adv|S2 Promo) '",
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

// ═══════════════════════ Phase P S2 — homepage sections ══════════════════════
// Restored at the end (finally): order, pins, section fields, placements,
// settings rows and the source-type rename this group makes.
const s2Restore = {
  order: null,
  pins: new Map(), // key → [{position, topicSlug|gameSlug}]
  sections: new Map(), // key → original fields patch
  placements: [],
  settings: null,
  sourceType: null,
};

const adminApi = (path, method = 'GET', body) =>
  api(BACK, `/admin/api${path}`, { method, token: TOKEN, body });

async function homeSections() {
  return (await api(BACK, '/public/homepage')).json?.data?.sections ?? [];
}
async function sectionsConfig() {
  return (await adminApi('/homepage/config')).json?.data?.sections ?? [];
}
async function waitHomepage(res) {
  const id = res?.json?.jobId;
  return id ? (await waitForHomepageJob(id)).ok : false;
}
const waitForHomepageJob = (id) => waitForJobLib('homepage', id, 90_000);
async function recomputeHomepage() {
  return waitHomepage(await adminApi('/homepage/recompute', 'POST', {}));
}
const pinsOf = (cfg, key) =>
  (cfg.find((x) => x.key === key)?.pins ?? []).map((p) =>
    p.topicSlug
      ? { position: p.position, topicSlug: p.topicSlug }
      : { position: p.position, gameSlug: p.gameSlug },
  );
/** Targeted cleanup of the per-IP email throttle keys (never flushall). */
function clearOwnEmailThrottle() {
  try {
    execSync(
      `docker exec gameskeep-redis-1 sh -c "redis-cli --scan --pattern 'gk:email:send:*' | xargs -r redis-cli del"`,
      { encoding: 'utf8' },
    );
  } catch {
    /* best-effort */
  }
}
const itemSlug = (i) => i.topic?.slug ?? i.game?.slug ?? null;

async function s2a() {
  const cfg0 = await sectionsConfig();
  s2Restore.order = cfg0.map((x) => x.key);
  s2Restore.settings = snapshotSettings(['homepage', 'ads']);
  for (const key of ['trending', 'featured']) s2Restore.pins.set(key, pinsOf(cfg0, key));
  const featured0 = cfg0.find((x) => x.key === 'featured');
  s2Restore.sections.set('featured', {
    promotedPosition: featured0?.promotedPosition ?? null,
    mode: featured0?.mode,
  });
  const mod = await login('demo-moderator', DEMO_PW);

  // ── S2.1 (acc.1) reorder → the homepage order follows after save, audited ──
  const newOrder = [...s2Restore.order];
  const ti = newOrder.indexOf('top_rated');
  newOrder.splice(ti, 1);
  newOrder.splice(1, 0, 'top_rated'); // Top rated right after the briefing
  const modOrder = await api(BACK, '/admin/api/homepage/order', {
    method: 'PUT',
    jar: mod.jar,
    csrf: mod.csrf,
    body: { keys: newOrder },
  });
  const put = await adminApi('/homepage/order', 'PUT', { keys: newOrder });
  const done = await waitHomepage(put);
  const served = (await homeSections()).map((x) => x.key);
  const expected = newOrder.filter((k) => served.includes(k));
  const orderAudit = Number(
    psql(
      "SELECT count(*) FROM audit_logs WHERE entity_type = 'homepage-section' AND entity_id = 'order' AND created_at > now() - interval '5 minutes';",
    ),
  );
  check(
    'S2.1 (acc.1) reordering sections in admin changes the homepage order after save — no deploy; audited; moderator 403',
    modOrder.status === 403 &&
      put.status === 200 &&
      done &&
      served.join(',') === expected.join(',') &&
      served.indexOf('top_rated') < served.indexOf('trending') &&
      orderAudit >= 1,
    `mod=${modOrder.status} put=${put.status} served=${served.slice(0, 4).join('>')}… audit=${orderAudit}`,
  );

  // ── S2.2 (acc.2) a paid placement for a DATA section is rejected: API + DB ──
  const game =
    psql("SELECT slug FROM subjects WHERE type = 'game' AND slug = 'elden-ring';") || 'elden-ring';
  const dataKeys = cfg0.filter((x) => x.kind === 'data').map((x) => x.key);
  const apiRejects = [];
  for (const key of dataKeys) {
    const r = await adminApi(`/homepage/sections/${key}/promotions`, 'POST', {
      advertiserName: `S2 Promo ${RUN}`,
      gameSlug: game,
    });
    apiRejects.push(`${key}:${r.status}`);
  }
  const dbTry = (sqlText) => {
    try {
      psql(sqlText);
      return 'ACCEPTED';
    } catch (e) {
      return /check constraint|foreign key/i.test(String(e.stderr ?? e.message))
        ? 'rejected'
        : 'error';
    }
  };
  const trendingId = psql("SELECT id FROM homepage_sections WHERE key = 'trending';");
  const gameSubject = psql(`SELECT id FROM subjects WHERE slug = ${lit(game)};`);
  const asDiscovery = dbTry(
    `INSERT INTO ad_placements (section_id, section_kind, advertiser_name, headline, promoted_subject_id) VALUES (${lit(trendingId)}, 'discovery', ${lit(`S2 Promo ${RUN}`)}, 'x', ${lit(gameSubject)});`,
  );
  const asData = dbTry(
    `INSERT INTO ad_placements (section_id, section_kind, advertiser_name, headline, promoted_subject_id) VALUES (${lit(trendingId)}, 'data', ${lit(`S2 Promo ${RUN}`)}, 'x', ${lit(gameSubject)});`,
  );
  const retype = dbTry("UPDATE homepage_sections SET kind = 'discovery' WHERE key = 'trending';");
  check(
    'S2.2 (acc.2) attaching a Promoted placement to Trending (and every data section) is rejected — API 400 AND the DB (FK/CHECK); a data section cannot be re-typed sellable',
    apiRejects.every((x) => x.endsWith(':400')) &&
      dataKeys.includes('trending') &&
      asDiscovery === 'rejected' &&
      asData === 'rejected' &&
      retype === 'rejected',
    `api=${apiRejects.join(' ')} db(as discovery)=${asDiscovery} db(as data)=${asData} retype=${retype}`,
  );

  // ── S2.3 (acc.3) Featured: the one Promoted item at its position, labeled ──
  const story = psql(
    "SELECT slug FROM topics WHERE bias_distribution IS NOT NULL AND (bias_distribution->>'articleCount')::int > 0 ORDER BY last_activity_at DESC LIMIT 1;",
  );
  await adminApi('/homepage/sections/featured', 'PATCH', { promotedPosition: 2, mode: 'manual' });
  await adminApi('/homepage/sections/featured/pins', 'PUT', {
    pins: [
      { position: 1, topicSlug: story },
      { position: 3, gameSlug: 'hades-ii' },
    ],
  });
  const promo = await adminApi('/homepage/sections/featured/promotions', 'POST', {
    advertiserName: `S2 Promo ${RUN}`,
    gameSlug: game,
  });
  const promoId = promo.json?.data?.id;
  if (promoId) s2Restore.placements.push(promoId);
  const act = await adminApi(`/ads/placements/${promoId}/status`, 'POST', { status: 'active' });
  await waitHomepage(act);
  const featured = (await homeSections()).find((x) => x.key === 'featured');
  const at2 = featured?.items?.[1];
  const second = await adminApi('/homepage/sections/featured/promotions', 'POST', {
    advertiserName: `S2 Promo B ${RUN}`,
    gameSlug: 'hades-ii',
  });
  const secondId = second.json?.data?.id;
  if (secondId) s2Restore.placements.push(secondId);
  const secondAct = await adminApi(`/ads/placements/${secondId}/status`, 'POST', {
    status: 'active',
  });
  const storyPromo = await adminApi('/homepage/sections/featured/promotions', 'POST', {
    advertiserName: `S2 Promo C ${RUN}`,
    gameSlug: story,
  });
  const dataPaid = (await homeSections())
    .filter((x) => x.kind === 'data')
    .some((x) => x.items.some((i) => i.promoted));
  check(
    'S2.3 (acc.3) a discovery section carries ONE Promoted item at its admin-chosen position with the advertiser; a second active one → 409; a story is never promotable; no data section holds a paid item',
    promo.status === 201 &&
      act.status === 200 &&
      at2?.promoted?.advertiser === `S2 Promo ${RUN}` &&
      itemSlug(at2) === game &&
      featured?.items?.filter((i) => i.promoted).length === 1 &&
      second.status === 201 &&
      secondAct.status === 409 &&
      storyPromo.status === 400 &&
      !dataPaid,
    `pos2=${itemSlug(at2)} label=${at2?.promoted?.advertiser ?? '—'} 2nd-active=${secondAct.status} story=${storyPromo.status} dataPaid=${dataPaid}`,
  );

  // ── S2.4 (acc.4) Δ honesty: too few samples → "—"; empty prior window → New ──
  const playersOf = async () => (await homeSections()).find((x) => x.key === 'by_players');
  const p3 = await playersOf();
  const pctAt3 = (p3?.items ?? []).filter((i) => i.delta?.kind === 'pct').length;
  await waitHomepage(await adminApi('/homepage/settings', 'PATCH', { deltaMinPoints: 50 }));
  const p50 = await playersOf();
  const allDash = (p50?.items ?? []).length > 0 && p50.items.every((i) => i.delta?.kind === 'none');
  await waitHomepage(await adminApi('/homepage/settings', 'PATCH', { deltaMinPoints: 3 }));
  // "New": find a window where some public story has coverage now and NONE in the
  // previous window (deterministic on any data), set it, assert, put 48h back.
  const defaultWindow = cfg0.find((x) => x.key === 'trending')?.deltaWindowHours;
  const counts2 = (slug, w) =>
    psql(
      `SELECT count(*) FILTER (WHERE a.publish_date > now() - interval '${w} hours' AND a.publish_date <= now()) || '|' || count(*) FILTER (WHERE a.publish_date > now() - interval '${2 * w} hours' AND a.publish_date <= now() - interval '${w} hours') FROM topics t JOIN article_topics at ON at.topic_id = t.id JOIN articles a ON a.id = at.article_id WHERE t.slug = ${lit(slug)};`,
    ).split('|');
  let win = null;
  let firstNew = null;
  for (const w of [48, 24, 12, 6, 72, 96, 168]) {
    const slug = psql(
      `SELECT t.slug FROM topics t JOIN article_topics at ON at.topic_id = t.id JOIN articles a ON a.id = at.article_id WHERE t.bias_distribution IS NOT NULL GROUP BY t.slug HAVING count(*) FILTER (WHERE a.publish_date > now() - interval '${w} hours' AND a.publish_date <= now()) > 0 AND count(*) FILTER (WHERE a.publish_date > now() - interval '${2 * w} hours' AND a.publish_date <= now() - interval '${w} hours') = 0 LIMIT 1;`,
    );
    if (slug) {
      win = w;
      firstNew = slug;
      break;
    }
  }
  if (win && win !== defaultWindow) {
    await waitHomepage(
      await adminApi('/homepage/sections/trending', 'PATCH', { deltaWindowHours: win }),
    );
  }
  const trendW = (await homeSections()).find((x) => x.key === 'trending');
  const newItem = (trendW?.items ?? []).find((i) => itemSlug(i) === firstNew);
  const counts = firstNew ? counts2(firstNew, win) : ['?', '?'];
  if (win && win !== defaultWindow) {
    await waitHomepage(
      await adminApi('/homepage/sections/trending', 'PATCH', { deltaWindowHours: defaultWindow }),
    );
  }
  const trend = (await homeSections()).find((x) => x.key === 'trending');
  check(
    'S2.4 (acc.4) a game below the minimum samples shows "—" (never 0% / a guess); a story with an empty previous window shows "New"',
    pctAt3 >= 1 &&
      allDash &&
      defaultWindow === 48 &&
      Boolean(firstNew) &&
      newItem?.delta?.kind === 'new' &&
      Number(counts[0]) >= 1 &&
      Number(counts[1]) === 0,
    `players: pct@3=${pctAt3} allDash@50=${allDash} · trending default ${defaultWindow}h; at ${win}h "${firstNew}" → ${newItem?.delta?.kind ?? 'absent'} (now=${counts[0]} prev=${counts[1]})`,
  );

  // ── S2.5 (acc.5) a pinned item keeps its position across auto refreshes ────
  const trendItems = (trend?.items ?? []).map(itemSlug);
  const pinStory = trendItems[trendItems.length - 1];
  const pinRes = await adminApi('/homepage/sections/trending/pins', 'PUT', {
    pins: [{ position: 3, topicSlug: pinStory }],
  });
  await waitHomepage(pinRes);
  const at3a = (await homeSections()).find((x) => x.key === 'trending')?.items?.[2];
  await recomputeHomepage();
  await recomputeHomepage();
  const at3b = (await homeSections()).find((x) => x.key === 'trending')?.items?.[2];
  check(
    'S2.5 (acc.5) a pinned item keeps its position across auto refreshes (two snapshot recomputes)',
    pinRes.status === 200 &&
      itemSlug(at3a) === pinStory &&
      at3a?.pinned === true &&
      itemSlug(at3b) === pinStory &&
      at3b?.pinned === true,
    `pin=${pinStory} → #3 ${itemSlug(at3a)} → after 2 refreshes #3 ${itemSlug(at3b)}`,
  );

  // ── S2.6 Trending: a ring of new accounts adds nothing; a credible one counts ─
  const metricOf = async (slug) =>
    (await homeSections())
      .find((x) => x.key === 'trending')
      ?.items?.find((i) => itemSlug(i) === slug)?.metric ?? null;
  await adminApi('/homepage/sections/trending/pins', 'PUT', { pins: [] });
  await recomputeHomepage();
  // The top Trending story (it has coverage in the window); its score must not move
  // for the ring and must move by exactly one follow weight for a credible account.
  const target = itemSlug(
    ((await homeSections()).find((x) => x.key === 'trending')?.items ?? []).find(
      (i) => (i.metric ?? 0) > 0,
    ) ?? {},
  );
  const targetId = psql(`SELECT id FROM topics WHERE slug = ${lit(target)};`);
  const before = await metricOf(target);
  clearOwnEmailThrottle(); // targeted (like verify:i6) — never flushall
  const ring = [];
  for (let i = 0; i < 4; i += 1) ring.push(await makeVerified(`ring${i}`));
  let ringWrites = 0;
  for (const u of ring) {
    const c = await api(BACK, `/community/comment/topic/${targetId}`, {
      method: 'POST',
      jar: u.jar,
      csrf: u.csrf,
      body: { body: `great story ${RUN}` },
    });
    const f = await api(BACK, `/community/follow/topic/${target}`, {
      method: 'POST',
      jar: u.jar,
      csrf: u.csrf,
    });
    if (c.status < 300 && f.status < 300) ringWrites += 1;
  }
  await recomputeHomepage();
  const afterRing = await metricOf(target);
  // A credible account (aged + reputable — credibility 1.0) follows the story.
  const cred = await makeVerified('cred');
  psql(
    `UPDATE users SET reputation = 80, created_at = now() - interval '60 days' WHERE id = ${lit(cred.id)};`,
  );
  const credFollow = await api(BACK, `/community/follow/topic/${target}`, {
    method: 'POST',
    jar: cred.jar,
    csrf: cred.csrf,
  });
  await recomputeHomepage();
  const afterCred = await metricOf(target);
  const followWeight = (await adminApi('/homepage/config')).json?.data?.settings?.trendingWeights
    ?.follows;
  check(
    'S2.6 Trending: a ring of fresh verified accounts (comment + follow) adds NOTHING (credibility floor, per-account cap, engagement ≤ coverage); a credible account’s follow adds its weight',
    ringWrites === ring.length &&
      before != null &&
      afterRing === before &&
      credFollow.status < 300 &&
      afterCred != null &&
      Math.abs(afterCred - before - followWeight) < 1e-6,
    `story=${target} score ${before} → ring(${ringWrites} accounts) ${afterRing} → credible follow ${afterCred} (follow weight ${followWeight})`,
  );

  // ── S2.7 Top rated ranks on the critic + community layers only ─────────────
  const top = (await homeSections()).find((x) => x.key === 'top_rated');
  const rows = (top?.items ?? []).filter((i) => !i.pinned && i.game);
  const means = rows.map((i) => {
    const layers = [i.game.critics, i.game.community].filter((n) => n != null);
    return layers.reduce((a, b) => a + b, 0) / layers.length;
  });
  const metricsMatch = rows.every(
    (i, n) => Math.abs((i.metric ?? -1) - Math.round(means[n] * 10) / 10) < 0.11,
  );
  const sorted = means.every((m, n) => n === 0 || means[n - 1] >= m - 1e-9);
  const ourWouldDiffer = Number(
    psql(
      'SELECT count(*) FROM game_rating_summaries WHERE our_score IS NOT NULL AND (critics_score IS NOT NULL OR community_our_score IS NOT NULL);',
    ),
  );
  check(
    'S2.7 Top rated ranks on the critic + community layers only (the team score stays out — S5 decision)',
    rows.length >= 3 && metricsMatch && sorted && ourWouldDiffer > 0,
    `${rows.length} ranked, metric = mean(critic, community) ${metricsMatch}, descending ${sorted}`,
  );

  // ── S2.8 the homepage serves STORED snapshots (no ranking on the request) ──
  const snap = JSON.parse(
    psql("SELECT payload::text FROM homepage_section_snapshots WHERE section_key = 'top_rated';"),
  );
  const swapped = { ...snap, items: [...snap.items].reverse() };
  psql(
    `UPDATE homepage_section_snapshots SET payload = ${lit(JSON.stringify(swapped))}::jsonb WHERE section_key = 'top_rated';`,
  );
  const servedTop = ((await homeSections()).find((x) => x.key === 'top_rated')?.items ?? []).map(
    itemSlug,
  );
  await recomputeHomepage();
  const restoredTop = ((await homeSections()).find((x) => x.key === 'top_rated')?.items ?? []).map(
    itemSlug,
  );
  const home = (await api(BACK, '/public/homepage')).json?.data;
  check(
    'S2.8 the homepage serves the STORED snapshot (a stored order is served as-is; the job re-ranks), with its computedAt',
    servedTop.join(',') === swapped.items.map((i) => i.slug).join(',') &&
      restoredTop.join(',') === snap.items.map((i) => i.slug).join(',') &&
      typeof home?.computedAt === 'string',
    `served stored=${servedTop.join(',') === swapped.items.map((i) => i.slug).join(',')} recomputed back=${restoredTop.join(',') === snap.items.map((i) => i.slug).join(',')} computedAt=${home?.computedAt}`,
  );

  // ── S2.9 section config is validated per kind; RBAC ────────────────────────
  const v = async (key, body) =>
    (await adminApi(`/homepage/sections/${key}`, 'PATCH', body)).status;
  const modPatch = await api(BACK, '/admin/api/homepage/sections/trending', {
    method: 'PATCH',
    jar: mod.jar,
    csrf: mod.csrf,
    body: { title: 'x' },
  });
  const results = {
    promotedOnData: await v('trending', { promotedPosition: 1 }),
    ourPicksAuto: await v('our_picks', { mode: 'auto' }),
    windowOnTopRated: await v('top_rated', { deltaWindowHours: 24 }),
    tooMany: await v('latest', { itemCount: 99 }),
    sourcesOnGames: await v('top_rated', { rules: { include: { sources: ['ign'] } } }),
    unknown: await v('nope', { title: 'x' }),
  };
  check(
    'S2.9 section edits are validated per kind (paid position on a data section, Our picks auto, Δ window off-section, out-of-range, wrong rule dimension → 400; unknown → 404); moderator 403',
    modPatch.status === 403 &&
      results.promotedOnData === 400 &&
      results.ourPicksAuto === 400 &&
      results.windowOnTopRated === 400 &&
      results.tooMany === 400 &&
      results.sourcesOnGames === 400 &&
      results.unknown === 404,
    `mod=${modPatch.status} ${Object.entries(results)
      .map(([k, x]) => `${k}=${x}`)
      .join(' ')}`,
  );

  // ── S2.10 player counts are sampled daily (demo history included) ──────────
  const ph = psql(
    "SELECT count(DISTINCT game_id) || '|' || min(n) || '|' || coalesce(round(extract(epoch FROM (now() - max(newest))) / 3600)::text, '?') FROM (SELECT game_id, count(*) n, max(captured_at) newest FROM game_player_counts GROUP BY game_id) x;",
  ).split('|');
  const spacing = psql(
    'SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY gap) FROM (SELECT extract(epoch FROM captured_at - lag(captured_at) OVER (PARTITION BY game_id ORDER BY captured_at)) / 86400 gap FROM game_player_counts) x WHERE gap IS NOT NULL;',
  );
  const chart =
    (await api(BACK, '/public/game/cyberpunk-2077')).json?.data?.playerCountHistory ?? [];
  check(
    'S2.10 player counts are sampled daily (mock history too): ≥150 daily samples per tracked game, newest within a day; the game chart stays one point per week',
    Number(ph[0]) >= 1 &&
      Number(ph[1]) >= 150 &&
      Number(ph[2]) <= 26 &&
      Math.abs(Number(spacing) - 1) < 0.05 &&
      chart.length >= 24 &&
      chart.length <= 28,
    `${ph[0]} games, min ${ph[1]} samples, newest ${ph[2]}h ago, median spacing ${Number(spacing).toFixed(2)}d, chart ${chart.length} weekly points`,
  );

  // ── S2.11 the Standalone rule keys on the type's stable role ───────────────
  const st = psql(
    "SELECT id || '|' || key || '|' || label FROM source_types WHERE role = 'standalone';",
  ).split('|');
  s2Restore.sourceType = { id: st[0], key: st[1], label: st[2] };
  const renamed = await adminApi(`/source-types/${st[0]}`, 'PATCH', {
    key: `renamed-${RUN}`,
    label: `Renamed ${RUN}`,
  });
  const euro = psql("SELECT id FROM sources WHERE slug = 'eurogamer';");
  const afterRename = await adminApi(`/sources/${euro}`, 'PATCH', { typeId: st[0] });
  const roleKept = psql(`SELECT role FROM source_types WHERE id = ${lit(st[0])};`);
  check(
    'S2.11 "parent company ⇒ not Standalone" keys on the type’s stable role: renaming its key AND label in admin cannot detach it',
    renamed.status === 200 && afterRename.status === 400 && roleKept === 'standalone',
    `rename=${renamed.status} eurogamer→renamed type=${afterRename.status} role=${roleKept}`,
  );

  // ── S2.12 unsold-slot placeholder switch: default off, admin-set, audited ──
  const slot0 = (await api(BACK, '/public/adslot/home')).json?.data;
  const on = await adminApi('/homepage/settings', 'PATCH', { showUnsoldPlaceholder: true });
  const slot1 = (await api(BACK, '/public/adslot/home')).json?.data;
  const adsAudit = Number(
    psql(
      "SELECT count(*) FROM audit_logs WHERE entity_type = 'app-settings' AND entity_id = 'ads' AND created_at > now() - interval '5 minutes';",
    ),
  );
  check(
    'S2.12 ads.showUnsoldPlaceholder: default false (an unsold slot tells the page to render nothing); admin-set + audited',
    slot0?.showPlaceholder === false &&
      on.status === 200 &&
      slot1?.showPlaceholder === true &&
      adsAudit >= 1,
    `default=${slot0?.showPlaceholder} on=${slot1?.showPlaceholder} audit=${adsAudit}`,
  );
}

// ── S2 commit 2: homepage layout + copy (SSR) ─────────────────────────────────
/** Split the homepage SSR into its configured sections (data-section wrappers). */
function ssrSections(h) {
  const out = new Map();
  const re = /data-section="([a-z_]+)"/g;
  const marks = [...h.matchAll(re)].map((m) => ({ key: m[1], at: m.index }));
  marks.forEach((m, i) => out.set(m.key, h.slice(m.at, marks[i + 1]?.at ?? h.length)));
  return { order: marks.map((m) => m.key), byKey: out };
}

async function s2b() {
  const cfg = await sectionsConfig();
  s2Restore.pins.set('our_picks', pinsOf(cfg, 'our_picks'));
  if (!s2Restore.pins.has('trending')) s2Restore.pins.set('trending', pinsOf(cfg, 'trending'));

  // ── S2.13 (acc.1, SSR) the page renders the sections in the saved order ────
  const order = cfg.map((x) => x.key);
  const moved = [...order];
  moved.splice(moved.indexOf('upcoming'), 1);
  moved.splice(1, 0, 'upcoming');
  await waitHomepage(await adminApi('/homepage/order', 'PUT', { keys: moved }));
  const apiOrder = (await homeSections()).map((x) => x.key);
  const ssr1 = ssrSections(await html('/'));
  const nonEmpty = apiOrder.filter((k) => ssr1.order.includes(k));
  check(
    'S2.13 (acc.1, SSR) the rendered homepage follows the saved section order (no deploy)',
    ssr1.order.join(',') === nonEmpty.join(',') && ssr1.order[1] === 'upcoming',
    `ssr=${ssr1.order.slice(0, 5).join('>')}…`,
  );

  // ── S2.14 (acc.3, SSR) the Promoted label is render-forced; data sections never paid
  const labelIn = (h) =>
    (h ?? '').includes('Paid promotion · ') && (h ?? '').includes('>Promoted<');
  let lastHtml = await html('/');
  const featuredHas = () => labelIn(ssrSections(lastHtml).byKey.get('featured'));
  const states = [];
  states.push(featuredHas());
  const toggles = [
    () => adminApi('/homepage/settings', 'PATCH', { showUnsoldPlaceholder: true }),
    () => setDisplay({ displayScope: 'all', showQuality: true }),
    () => adminApi('/homepage/settings', 'PATCH', { showUnsoldPlaceholder: false }),
    () => setDisplay({ displayScope: 'reviews_and_sponsored', showQuality: false }),
  ];
  for (const t of toggles) {
    const r = await t();
    if (r?.json?.jobId) await waitHomepage(r);
    lastHtml = await html('/');
    states.push(featuredHas());
  }
  const ssrNow = ssrSections(lastHtml);
  const dataPaid = cfg
    .filter((x) => x.kind === 'data')
    .some((x) => /is-promoted|Paid promotion/.test(ssrNow.byKey.get(x.key) ?? ''));
  check(
    'S2.14 (acc.3) a discovery section with a Promoted item shows the label in SSR under every switch combination; no data section renders a paid item',
    states.every(Boolean) && !dataPaid,
    `label across ${states.length} states: ${states.join(',')} dataPaid=${dataPaid}`,
  );

  // ── S2.15 Δ on the cards with its window; neutral colours ─────────────────
  const chips = (h) =>
    [
      ...(h ?? '').matchAll(
        /class="gk-delta is-([a-z]+)"[^>]*><b>([^<]*)<\/b><span class="gk-delta-win">([^<]*)<\/span>/g,
      ),
    ].map((m) => ({ kind: m[1], text: m[2], win: m[3] }));
  const trendChips = chips(ssrNow.byKey.get('trending'));
  const playerChips = chips(ssrNow.byKey.get('by_players'));
  const textOk = (c) =>
    (c.kind === 'new' && c.text === 'New') ||
    (c.kind === 'none' && c.text === '—') ||
    (c.kind === 'pct' && /^(\+|−|±)\d+%$/.test(c.text));
  const css = readFileSync(CSS_PATH, 'utf8');
  const deltaRules = ['.gk-delta', '.gk-delta.is-new', '.gk-delta.is-none', '.gk-delta-win']
    .map((sel) => cssRule(css, sel))
    .join(' ');
  check(
    'S2.15 Δ shows on the cards with its window ("48h" Trending, "7d" By players), as New / — / ±%; neutral colours (no green/red)',
    trendChips.length >= 1 &&
      trendChips.every((c) => c.win === '48h' && textOk(c)) &&
      playerChips.length >= 1 &&
      playerChips.every((c) => c.win === '7d' && textOk(c)) &&
      !/#(7fd29a|e06c5f|ef4444|22c55e)|--gk-(green|red)/i.test(deltaRules),
    `trending ${trendChips.length} [${[...new Set(trendChips.map((c) => c.text))].slice(0, 4).join(' ')}] · players ${playerChips.length} [${playerChips
      .map((c) => c.text)
      .slice(0, 4)
      .join(' ')}]`,
  );

  // ── S2.16 (acc.5, SSR) the list order is the section's: a pin holds row 3 ──
  const trendApi = ((await homeSections()).find((x) => x.key === 'trending')?.items ?? []).map(
    itemSlug,
  );
  const pinStory = trendApi[trendApi.length - 1];
  await waitHomepage(
    await adminApi('/homepage/sections/trending/pins', 'PUT', {
      pins: [{ position: 3, topicSlug: pinStory }],
    }),
  );
  const rowsOf = (h) =>
    [
      ...(ssrSections(h).byKey.get('trending') ?? '').matchAll(
        /class="gk-trend-item[^"]*"\s+href="\/topics\/([^"]+)"/g,
      ),
    ].map((m) => m[1]);
  const rowsA = rowsOf(await html('/'));
  await recomputeHomepage();
  const rowsB = rowsOf(await html('/'));
  const apiAfter = ((await homeSections()).find((x) => x.key === 'trending')?.items ?? []).map(
    itemSlug,
  );
  check(
    'S2.16 (acc.5, SSR) the Trending list renders in the section order — a pinned story stays on row 3 across refreshes (the order never rotates)',
    rowsA[2] === pinStory && rowsB[2] === pinStory && rowsA.join(',') === apiAfter.join(','),
    `row3=${rowsA[2]} after refresh=${rowsB[2]} ssr=api ${rowsA.join(',') === apiAfter.join(',')}`,
  );

  // ── S2.17 no Promoted row between outlet articles ─────────────────────────
  const topicSlugs = psql(
    "SELECT string_agg(slug, ',') FROM (SELECT slug FROM topics WHERE bias_distribution IS NOT NULL ORDER BY last_activity_at DESC LIMIT 6) x;",
  ).split(',');
  const adRows = [];
  for (const slug of topicSlugs) {
    const h = await html(`/topics/${slug}`);
    if (/gk-srcrow-ad|Promoted slot/.test(h)) adRows.push(slug);
  }
  check(
    'S2.17 topic coverage lists carry no Promoted row — paid items only in discovery sections + sidebar slots',
    topicSlugs.length >= 3 && adRows.length === 0,
    `${topicSlugs.length} story pages, ad rows on: ${adRows.join(',') || 'none'}`,
  );

  // ── S2.18 an unsold slot renders NOTHING at default; the switch brings the box back
  const slotPages = [
    '/',
    '/games',
    '/games/browse',
    '/games/cyberpunk-2077',
    '/upcoming',
    '/sources',
    '/sources/ign',
    '/awards',
  ];
  const boxes = [];
  for (const path of slotPages) {
    const h = await html(path);
    if (/Promoted slot — unsold|aria-label="Advertisement slot"/.test(h)) boxes.push(path);
  }
  await adminApi('/homepage/settings', 'PATCH', { showUnsoldPlaceholder: true });
  const homeOn = await html('/');
  await adminApi('/homepage/settings', 'PATCH', { showUnsoldPlaceholder: false });
  check(
    'S2.18 unsold ad slots render nothing publicly at default (8 pages); ads.showUnsoldPlaceholder on → the "AD" box returns',
    boxes.length === 0 && /aria-label="Advertisement slot"/.test(homeOn),
    `boxes at default: ${boxes.join(',') || 'none'} · switch on → box ${/aria-label="Advertisement slot"/.test(homeOn)}`,
  );

  // ── S2.19 stale copy gone; Community is a live CTA; the newsletter form works
  const home = await html('/');
  const community = ssrSections(home).byKey.get('community') ?? '';
  const subEmail = `p_news_${RUN}@example.test`;
  const anon = await withCsrf();
  const noConsent = await api(BACK, '/awards/subscribe', {
    method: 'POST',
    jar: anon.jar,
    csrf: anon.csrf,
    body: { email: subEmail, consent: false, source: 'homepage' },
  });
  const yes = await api(BACK, '/awards/subscribe', {
    method: 'POST',
    jar: anon.jar,
    csrf: anon.csrf,
    body: { email: subEmail, consent: true, source: 'homepage' },
  });
  const row = psql(
    `SELECT source || '|' || active::text || '|' || coalesce(consent_version, '') FROM newsletter_subscriptions WHERE email = ${lit(subEmail)};`,
  ).split('|');
  psql(`DELETE FROM newsletter_subscriptions WHERE email = ${lit(subEmail)};`);
  check(
    'S2.19 no stale copy ("Coming soon", "(I8)"); Community links to sign-up + sign-in; the newsletter form (explicit consent box) posts through the consented path — refused without consent, recorded as "homepage" with it',
    !/Coming soon/i.test(community) &&
      !home.includes('(I8)') &&
      community.includes('href="/register"') &&
      community.includes('href="/login"') &&
      /gk-news-consent[\s\S]{0,200}type="checkbox"/.test(home) &&
      noConsent.status === 400 &&
      yes.status === 200 &&
      row[0] === 'homepage' &&
      row[1] === 'true' &&
      row[2].length > 0,
    `comingSoon=${/Coming soon/i.test(community)} I8=${home.includes('(I8)')} cta=${community.includes('href="/register"')} noConsent=${noConsent.status} consented=${yes.status} row=${row.join('/')}`,
  );

  // ── S2.20 layout: the spotlight band is filled; no echoed headline; stacked cards
  const trendHtml = ssrSections(home).byKey.get('trending') ?? '';
  const panels = count(trendHtml, 'class="gk-spot-panel');
  const covered = count(trendHtml, 'class="gk-spot-coverage"');
  const titles = ((await homeSections()).find((x) => x.key === 'trending')?.items ?? []).map(
    (i) => i.topic?.title ?? '',
  );
  const summaries = [...trendHtml.matchAll(/<p class="gk-spot-summary">([^<]*)<\/p>/g)].map(
    (m) => m[1],
  );
  const keyOf = (t) => t.toLowerCase().replace(/&#x27;|&amp;|[^a-z0-9]/g, '');
  const echoes = summaries.filter((sum, i) => titles[i] && keyOf(sum).startsWith(keyOf(titles[i])));
  const stackedRule = cssRule(css, '.gk-topiccard.is-stacked .gk-topiccard-title');
  check(
    'S2.20 layout: every spotlight panel shows how the story is covered (no empty band); no summary opens by repeating its headline; the 3-across cards are stacked (full-width titles, 3 lines)',
    panels >= 3 &&
      covered === panels &&
      echoes.length === 0 &&
      count(trendHtml, 'gk-topiccard is-stacked') +
        count(trendHtml, 'gk-topiccard has-cover is-stacked') >=
        1 &&
      /-webkit-line-clamp:\s*3/.test(stackedRule),
    `panels=${panels} withCoverage=${covered} echoes=${echoes.length} stacked=${count(trendHtml, 'is-stacked')}`,
  );

  // ── S2.21 Our picks: hidden while empty; a pick shows the neutral label ────
  const emptyHidden = !ssrSections(home).order.includes('our_picks');
  await waitHomepage(
    await adminApi('/homepage/sections/our_picks/pins', 'PUT', {
      pins: [{ position: 1, gameSlug: 'hades-ii' }],
    }),
  );
  const picks = ssrSections(await html('/')).byKey.get('our_picks') ?? '';
  check(
    'S2.21 Our picks is hidden while empty; a team pick renders with the neutral "Our pick" label, never "Promoted"',
    emptyHidden && picks.includes('Our pick') && !/Promoted|Paid promotion/.test(picks),
    `hiddenWhenEmpty=${emptyHidden} label=${picks.includes('Our pick')} paid=${/Promoted|Paid promotion/.test(picks)}`,
  );
}

async function restoreS2() {
  for (const id of s2Restore.placements) {
    await adminApi(`/ads/placements/${id}/status`, 'POST', { status: 'ended' });
    await adminApi(`/ad-placements/${id}`, 'DELETE');
  }
  psql(`DELETE FROM ad_placements WHERE advertiser_name LIKE ${lit(`%${RUN}%`)};`);
  for (const [key, pins] of s2Restore.pins)
    await adminApi(`/homepage/sections/${key}/pins`, 'PUT', { pins });
  for (const [key, patch] of s2Restore.sections) {
    const body = Object.fromEntries(Object.entries(patch).filter(([, x]) => x !== undefined));
    await adminApi(`/homepage/sections/${key}`, 'PATCH', body);
  }
  if (s2Restore.order) await adminApi('/homepage/order', 'PUT', { keys: s2Restore.order });
  if (s2Restore.settings) restoreSettings(s2Restore.settings);
  if (s2Restore.sourceType) {
    const { id, key, label } = s2Restore.sourceType;
    await adminApi(`/source-types/${id}`, 'PATCH', { key, label });
  }
  await recomputeHomepage();
}

async function main() {
  if (!check('0. Stack ready (backend + SSR frontend)', await waitForReady())) return print();
  try {
    await s1();
    await h3();
    await s2a();
    await s2b();
  } finally {
    await restoreS2();
    restoreH3();
    // Re-run safety: restore switches + undo this run's integrity/vote rows.
    if (cleanup.display) await setDisplay(cleanup.display);
    // Exact prior decision back (hygiene 3) — newest first, so a signal touched
    // twice ends where it started.
    for (const { id, json } of [...cleanup.integrityResets].reverse()) restoreSignal(id, json);
    for (const id of cleanup.integrityDeletes) {
      psql(
        `BEGIN;
DELETE FROM article_integrity_signals WHERE id = ${lit(id)};
${auditSql({ action: 'delete', entityType: 'article-integrity', entityId: id, summary: 'verify cleanup removed the editor signal this run added' })}
COMMIT;`,
      );
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
