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
 *   S2.2  (owner decision B, rewritten) a paid placement — game OR story — is
 *         accepted on EVERY section with a list (data sections included), by the
 *         API and the DB; a block (no list) or a placement with no / two items → 400
 *   S2.3  (decision B, rewritten) several paid items at the admin-set positions,
 *         each with its kind + advertiser; the organic list is exactly as before
 *   S2.4  (acc. 4) too few samples → "—"; an empty previous window → "New"; the
 *         demo Trending window defaults to 168h (production 48h — S2 review fix 2)
 *   S2.5  (acc. 5) a pinned item keeps its position across refreshes
 *   S2.6  a ring of fresh accounts adds nothing to Trending; a credible one counts
 *   S2.7  Top rated ranks on the critic + community layers only
 *   S2.8  the homepage serves the STORED snapshots (no ranking on a request)
 *   S2.9  section edits validated (paid positions / min items on a block → 400); RBAC
 *   S2.10 player counts sampled daily; the game chart stays weekly
 *   S2.11 the Standalone rule keys on the type’s stable role (rename-proof)
 *   S2.12 ads.showUnsoldPlaceholder default false, admin-set + audited
 *  S2 — commit 2 (homepage layout + copy, SSR)
 *   S2.13 (acc. 1) the rendered page follows the saved section order
 *   S2.14 (decision B, rewritten) with a paid game + a paid story in EVERY section
 *         that shows a list, each section renders "Promoted" for both (never
 *         "Sponsored" — that word is the outlet's own signal) with
 *         the advertiser under every switch combination
 *   S2.15 Δ on cards with its window (Trending: the configured one, 7d in demo; By
 *         players 7d), New / — / ±%, never "−100%" in Trending; neutral colours
 *   S2.16 (acc. 5) the Trending list keeps the section order — a pin holds its row
 *   S2.17 (decision B, rewritten) the story coverage list: no paid row while the
 *         'topic-coverage' slot is unsold; sold → ONE labeled row at the slot's
 *         position, the outlet rows + count unchanged
 *   S2.18 unsold slots render nothing at default; the switch brings the box back
 *   S2.19 no stale copy; Community CTA; the newsletter form uses the consented path
 *   S2.20 spotlight band filled; no echoed headline; stacked 3-across cards
 *   S2.21 Our picks hidden while empty (a paid item alone never shows it); an
 *         organic pick reads "Our pick"; a paid item there shows its paid label,
 *         never "Our pick"
 *   S2.22 (review bug A) "Save order" / "Save pins" through the admin UI's own path
 *         (frontend BFF, demo-owner session, CSRF double-submit) → 200 + applied
 *   S2.23 (decision B) payment never changes data: paid items everywhere leave
 *         every organic list (order, metric, Δ), every score, player count, bias
 *         distribution and integrity signal exactly as computed without them
 *  S2 review fixes
 *   S2.24 (fix 1) Trending lists only stories active in its window: N active → N
 *         rows (fewer than the item count), each scored > 0, no "−100%"; below
 *         the admin-set minimum (default 3) the section is hidden
 *   S2.25 (fix 3) the suggest-a-game rate limits are an admin setting (5 per IP,
 *         60 overall per 10 min by default): applied live, validated, audited
 *   S2.26 (fix 4) every suite routes fetch through netdiag: a connection reset is
 *         never retried and is logged with time, URL, cause, compose ps + logs
 *
 *  S3 — tags
 *   S3.1  (acc. 1) above the threshold but unconfirmed → not public; editor confirms
 *   S3.2  (acc. 2) a brigade of fresh accounts can't publish and raises the flag
 *         (always in the admin queue; publicly only with the switch on)
 *   S3.3  (acc. 3) include / exclude (DB truth), the URL round-trips, noindex
 *   S3.4  (acc. 4) an expired vote-driven issue renders "Past issue" with dates
 *   S3.5  (acc. 5) tag pages: indexable + sitemap only from N games; no nested anchors
 *   S3.6  provenance: "Added by editors" / "Reported by players · confirmed by
 *         editors"; content tags none; editor issues never expire; resolve + patch
 *   S3.7  homepage cards render the S2 tag families + count
 *   S3.8  quick view: data, cache, BFF, accessible dialog
 *   S3.9  the owner's migration decisions; an editor's removal sticks
 *   S3.10 reader vote rules, suggestions, GDPR export
 *   S3.11 RBAC + audit
 */
import './lib/netdiag.mjs'; // connection errors: full diagnostics, never retried (S2 review)
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import net from 'node:net';
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
      "UNION ALL SELECT 'badges:' || count(*) FROM badges WHERE key LIKE 'i8\\_%'",
      "UNION ALL SELECT 'tag-suggestions:' || count(*) FROM tag_suggestions WHERE raw_name LIKE 'Verify Tag %'",
      "UNION ALL SELECT 'tag-patches:' || count(*) FROM game_tags WHERE patch_ref LIKE 'Verify %';",
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

/**
 * Review bug A: sign in through the FRONTEND exactly as the browser does (the
 * admin UI never talks to the backend directly — it calls the BFF with the
 * staff session cookie + the CSRF token from /api/auth/csrf).
 */
async function uiLogin(identifier) {
  const jar = {};
  const c0 = await api(FRONT, '/api/auth/csrf', { jar });
  jarFrom(c0.res, jar);
  const r = await api(FRONT, '/api/auth/login', {
    method: 'POST',
    jar,
    csrf: c0.json?.token,
    body: { identifier, password: DEMO_PW },
  });
  jarFrom(r.res, jar);
  const c1 = await api(FRONT, '/api/auth/csrf', { jar });
  jarFrom(c1.res, jar);
  return { jar, csrf: c1.json?.token, status: r.status };
}
const uiApi = (ui, path, method = 'GET', body) =>
  api(FRONT, path, { method, jar: ui.jar, csrf: method === 'GET' ? undefined : ui.csrf, body });

/** Every number we compute or import, timestamps excluded (S2.23). */
const dataFingerprint = () =>
  psql(
    [
      "SELECT md5(coalesce((SELECT string_agg(concat_ws(',', game_id, our_score, critics_score, critics_outlet_count, community_our_score, community_our_count, community_web_score, community_our_naive_score, disconnect_value, disconnect_band), '|' ORDER BY game_id) FROM game_rating_summaries), ''))",
      "|| ':' || md5(coalesce((SELECT string_agg(concat_ws(',', slug, bias_distribution::text, derived_influence_pct, derived_quality_pct), '|' ORDER BY slug) FROM topics), ''))",
      "|| ':' || md5(coalesce((SELECT string_agg(concat_ws(',', id, kind, status), '|' ORDER BY id) FROM article_integrity_signals), ''))",
      "|| ':' || md5(coalesce((SELECT string_agg(concat_ws(',', id, influence_score, quality_score, is_sponsored, has_affiliate_links, based_on_review_copy), '|' ORDER BY id) FROM articles), ''))",
      "|| ':' || (SELECT count(*) || '/' || coalesce(sum(current_players), 0) FROM game_player_counts);",
    ].join(' '),
  );
/** Each section's ORGANIC items as computed: slug | metric | Δ (S2.23). */
const organicBySection = async () =>
  Object.fromEntries(
    (await homeSections()).map((x) => [
      x.key,
      x.items
        .filter((i) => !i.paid)
        .map((i) => `${itemSlug(i)}|${i.metric}|${JSON.stringify(i.delta)}`)
        .join(','),
    ]),
  );
/** "Paid promotion · <advertiser>" — React may split the two text nodes. */
const paidByRe = (adv) =>
  new RegExp(`Paid promotion · (<!-- -->)?${adv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);

async function s2a() {
  const cfg0 = await sectionsConfig();
  s2Restore.order = cfg0.map((x) => x.key);
  s2Restore.settings = snapshotSettings(['homepage', 'ads']);
  for (const key of ['trending', 'featured']) s2Restore.pins.set(key, pinsOf(cfg0, key));
  for (const x of cfg0) {
    if (x.items !== 'none')
      s2Restore.sections.set(x.key, { paidPositions: x.paidPositions ?? [], minItems: x.minItems });
  }
  const featured0 = cfg0.find((x) => x.key === 'featured');
  s2Restore.sections.set('featured', {
    paidPositions: featured0?.paidPositions ?? [],
    minItems: featured0?.minItems,
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

  // ── S2.22 (review bug A) the admin UI's own path: BFF + session + CSRF ─────
  // The checks above use the service token against the backend directly — that is
  // why the missing BFF PUT went unnoticed. This sends what the UI sends.
  const ui = await uiLogin('demo-owner');
  const uiCfg = await uiApi(ui, '/admin/api/homepage/config');
  const uiKeys = (uiCfg.json?.data?.sections ?? []).map((x) => x.key);
  const uiMoved = [...uiKeys];
  const gi = uiMoved.indexOf('genres');
  if (gi > 0) [uiMoved[gi - 1], uiMoved[gi]] = [uiMoved[gi], uiMoved[gi - 1]];
  const uiOrder = await uiApi(ui, '/admin/api/homepage/order', 'PUT', { keys: uiMoved });
  await waitHomepage(uiOrder);
  const uiApplied = (await sectionsConfig()).map((x) => x.key).join(',') === uiMoved.join(',');
  const uiPins = await uiApi(ui, '/admin/api/homepage/sections/featured/pins', 'PUT', {
    pins: pinsOf(await sectionsConfig(), 'featured'),
  });
  await waitHomepage(uiPins);
  const uiNoCsrf = await api(FRONT, '/admin/api/homepage/order', {
    method: 'PUT',
    jar: ui.jar,
    body: { keys: uiKeys },
  });
  const uiBack = await uiApi(ui, '/admin/api/homepage/order', 'PUT', { keys: uiKeys });
  await waitHomepage(uiBack);
  const uiRestored = (await sectionsConfig()).map((x) => x.key).join(',') === uiKeys.join(',');
  check(
    'S2.22 (review bug A) "Save order" and "Save pins" through the admin UI path (frontend BFF, demo-owner session, CSRF double-submit) → 200 and applied; without the CSRF token → 403',
    ui.status === 200 &&
      uiCfg.status === 200 &&
      gi > 0 &&
      uiOrder.status === 200 &&
      uiApplied &&
      uiPins.status === 200 &&
      uiNoCsrf.status === 403 &&
      uiBack.status === 200 &&
      uiRestored,
    `login=${ui.status} config=${uiCfg.status} order=${uiOrder.status} applied=${uiApplied} pins=${uiPins.status} noCsrf=${uiNoCsrf.status} restore=${uiBack.status}/${uiRestored}`,
  );

  // ── S2.2 (decision B) a paid placement is accepted on ANY section with a list ─
  const game =
    psql("SELECT slug FROM subjects WHERE type = 'game' AND slug = 'elden-ring';") || 'elden-ring';
  const storyRows = psql(
    "SELECT slug FROM topics WHERE bias_distribution IS NOT NULL AND (bias_distribution->>'articleCount')::int > 0 ORDER BY last_activity_at DESC LIMIT 2;",
  ).split('\n');
  const story = storyRows[0];
  const storyB = storyRows[1] ?? storyRows[0];
  const listKeys = cfg0.filter((x) => x.items !== 'none').map((x) => x.key);
  const accepted = [];
  for (const key of listKeys) {
    const g = await adminApi(`/homepage/sections/${key}/promotions`, 'POST', {
      advertiserName: `S2 Promo ${RUN}`,
      gameSlug: game,
    });
    const t = await adminApi(`/homepage/sections/${key}/promotions`, 'POST', {
      advertiserName: `S2 Promo ${RUN}`,
      topicSlug: story,
    });
    for (const r of [g, t]) if (r.json?.data?.id) s2Restore.placements.push(r.json.data.id);
    accepted.push(`${key}:${g.status}/${t.status}`);
  }
  const blockKey = cfg0.find((x) => x.items === 'none')?.key;
  const onBlock = await adminApi(`/homepage/sections/${blockKey}/promotions`, 'POST', {
    advertiserName: `S2 Promo ${RUN}`,
    gameSlug: game,
  });
  const twoItems = await adminApi('/homepage/sections/trending/promotions', 'POST', {
    advertiserName: `S2 Promo ${RUN}`,
    gameSlug: game,
    topicSlug: story,
  });
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
  const dbStory = dbTry(
    `INSERT INTO ad_placements (section_id, advertiser_name, headline, promoted_topic_slug) VALUES (${lit(trendingId)}, ${lit(`S2 Promo ${RUN}`)}, 'x', ${lit(story)});`,
  );
  const dbNoItem = dbTry(
    `INSERT INTO ad_placements (section_id, advertiser_name, headline) VALUES (${lit(trendingId)}, ${lit(`S2 Promo ${RUN}`)}, 'x');`,
  );
  const dbBoth = dbTry(
    `INSERT INTO ad_placements (section_id, advertiser_name, headline, promoted_subject_id, promoted_topic_slug) VALUES (${lit(trendingId)}, ${lit(`S2 Promo ${RUN}`)}, 'x', ${lit(gameSubject)}, ${lit(story)});`,
  );
  check(
    'S2.2 (decision B) a paid placement — a game OR a story — is accepted on EVERY section with a list (Trending and the other data sections included), by the API (201) and the DB; a block, or a placement with no item / two items → rejected',
    listKeys.length >= 9 &&
      listKeys.includes('trending') &&
      accepted.every((x) => x.endsWith(':201/201')) &&
      onBlock.status === 400 &&
      twoItems.status === 400 &&
      dbStory === 'ACCEPTED' &&
      dbNoItem === 'rejected' &&
      dbBoth === 'rejected',
    `api=${accepted.join(' ')} block(${blockKey})=${onBlock.status} two=${twoItems.status} db story=${dbStory} none=${dbNoItem} both=${dbBoth}`,
  );

  // ── S2.3 (decision B) several paid items at their positions; organic untouched
  await adminApi('/homepage/sections/featured', 'PATCH', { paidPositions: [2, 4], mode: 'manual' });
  await waitHomepage(
    await adminApi('/homepage/sections/featured/pins', 'PUT', {
      pins: [
        { position: 1, topicSlug: story },
        { position: 3, gameSlug: 'hades-ii' },
      ],
    }),
  );
  const organicBefore = ((await homeSections()).find((x) => x.key === 'featured')?.items ?? [])
    .filter((i) => !i.paid)
    .map(itemSlug);
  const pg = await adminApi('/homepage/sections/featured/promotions', 'POST', {
    advertiserName: `S2 Promo ${RUN}`,
    gameSlug: game,
  });
  const pt = await adminApi('/homepage/sections/featured/promotions', 'POST', {
    advertiserName: `S2 Promo B ${RUN}`,
    topicSlug: storyB,
  });
  // Owner (S2 review): a placement for an item that already ranks organically in
  // the section returns a warning; hades-ii is pinned at #3 here.
  const dupe = await adminApi('/homepage/sections/featured/promotions', 'POST', {
    advertiserName: `S2 Promo D ${RUN}`,
    gameSlug: 'hades-ii',
  });
  if (dupe.json?.data?.id) s2Restore.placements.push(dupe.json.data.id);
  const s23Ids = [pg.json?.data?.id, pt.json?.data?.id].filter(Boolean);
  s2Restore.placements.push(...s23Ids);
  const actG = await adminApi(`/ads/placements/${s23Ids[0]}/status`, 'POST', { status: 'active' });
  const actS = await adminApi(`/ads/placements/${s23Ids[1]}/status`, 'POST', { status: 'active' });
  await waitHomepage(actS);
  await recomputeHomepage();
  const featuredItems = (await homeSections()).find((x) => x.key === 'featured')?.items ?? [];
  // Expected: the organic list with the paid refs INSERTED at 2 then 4.
  const expectedFeatured = [...organicBefore];
  expectedFeatured.splice(Math.min(1, expectedFeatured.length), 0, game);
  expectedFeatured.splice(Math.min(3, expectedFeatured.length), 0, storyB);
  const organicAfter = featuredItems.filter((i) => !i.paid).map(itemSlug);
  const paidG = featuredItems[1];
  const paidS = featuredItems[Math.min(3, featuredItems.length - 1)];
  check(
    'S2.3 (decision B) a section carries several paid items at its admin-set positions (2 and 4), a game and a story (both "Promoted"), each with its advertiser; the organic list is exactly what it was without them; creating a placement for an item that already ranks organically there returns a warning (the others none)',
    pg.status === 201 &&
      pt.status === 201 &&
      actG.status === 200 &&
      actS.status === 200 &&
      featuredItems.map(itemSlug).join(',') === expectedFeatured.join(',') &&
      paidG?.paid?.kind === 'game' &&
      paidG?.paid?.advertiser === `S2 Promo ${RUN}` &&
      paidS?.paid?.kind === 'story' &&
      paidS?.paid?.advertiser === `S2 Promo B ${RUN}` &&
      featuredItems.filter((i) => i.paid).length === 2 &&
      organicAfter.join(',') === organicBefore.join(',') &&
      dupe.status === 201 &&
      /already ranks organically/.test(dupe.json?.data?.warning ?? '') &&
      !pg.json?.data?.warning &&
      !pt.json?.data?.warning,
    `warning(dupe)=${Boolean(dupe.json?.data?.warning)} · served=${featuredItems.map((i) => `${itemSlug(i)}${i.paid ? `[${i.paid.kind}]` : ''}`).join(',')} organic kept=${organicAfter.join(',') === organicBefore.join(',')}`,
  );
  // End both so later groups start from organic lists.
  for (const id of s23Ids)
    await adminApi(`/ads/placements/${id}/status`, 'POST', { status: 'ended' });
  await adminApi('/homepage/sections/featured', 'PATCH', {
    paidPositions: s2Restore.sections.get('featured')?.paidPositions ?? [],
  });
  await recomputeHomepage();

  // ── S2.4 (acc.4) Δ honesty: too few samples → "—"; empty prior window → New ──
  const playersOf = async () => (await homeSections()).find((x) => x.key === 'by_players');
  const p3 = await playersOf();
  const pctAt3 = (p3?.items ?? []).filter((i) => i.delta?.kind === 'pct').length;
  await waitHomepage(await adminApi('/homepage/settings', 'PATCH', { deltaMinPoints: 50 }));
  const p50 = await playersOf();
  const allDash = (p50?.items ?? []).length > 0 && p50.items.every((i) => i.delta?.kind === 'none');
  await waitHomepage(await adminApi('/homepage/settings', 'PATCH', { deltaMinPoints: 3 }));
  // "New": find a window where some public story has coverage now and NONE in the
  // previous window (deterministic on any data), set it, assert, put the default back.
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
  // The probe window may hold fewer active stories than Trending's minimum (fix 1
  // hides the section then), so the probe shows the section from one story on.
  const defaultMin = cfg0.find((x) => x.key === 'trending')?.minItems ?? null;
  if (win) {
    await waitHomepage(
      await adminApi('/homepage/sections/trending', 'PATCH', {
        deltaWindowHours: win,
        minItems: 1,
      }),
    );
  }
  const trendW = (await homeSections()).find((x) => x.key === 'trending');
  const newItem = (trendW?.items ?? []).find((i) => itemSlug(i) === firstNew);
  const counts = firstNew ? counts2(firstNew, win) : ['?', '?'];
  if (win) {
    await waitHomepage(
      await adminApi('/homepage/sections/trending', 'PATCH', {
        deltaWindowHours: defaultWindow,
        minItems: defaultMin,
      }),
    );
  }
  const trend = (await homeSections()).find((x) => x.key === 'trending');
  check(
    'S2.4 (acc.4) a game below the minimum samples shows "—" (never 0% / a guess); a story with an empty previous window shows "New"; the demo Trending window defaults to 168h (fix 2)',
    pctAt3 >= 1 &&
      allDash &&
      defaultWindow === 168 &&
      Boolean(firstNew) &&
      newItem?.delta?.kind === 'new' &&
      Number(counts[0]) >= 1 &&
      Number(counts[1]) === 0,
    `players: pct@3=${pctAt3} allDash@50=${allDash} · trending default ${defaultWindow}h (demo; production 48h); at ${win}h "${firstNew}" → ${newItem?.delta?.kind ?? 'absent'} (now=${counts[0]} prev=${counts[1]})`,
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

  // ── S2.24 (S2 review fix 1) Trending = stories active in its window only ─────
  // DB truth: a story qualifies iff it has an article in the window (engagement is
  // capped by coverage, so it cannot qualify a story on its own). Pins are clear
  // (S2.6) and no placement is live here.
  const tCfg = (await sectionsConfig()).find((x) => x.key === 'trending');
  const tWindow0 = tCfg?.deltaWindowHours ?? null;
  const tMin0 = tCfg?.minItems ?? null;
  const tMin = tMin0 ?? 3;
  const tCount = tCfg?.itemCount ?? 8;
  const activeIn = (w) =>
    Number(
      psql(
        `SELECT count(DISTINCT t.id) FROM topics t JOIN article_topics at ON at.topic_id = t.id JOIN articles a ON a.id = at.article_id WHERE t.bias_distribution IS NOT NULL AND (t.bias_distribution->>'articleCount')::int > 0 AND a.publish_date > now() - interval '${w} hours' AND a.publish_date <= now();`,
      ),
    );
  let wLow = null;
  let wMid = null;
  let qLow = 0;
  let qMid = 0;
  for (const w of [1, 2, 3, 6, 12, 24, 36, 48, 60, 72, 96, 120, 144, 168, 240, 336, 504, 720]) {
    const q = activeIn(w);
    if (wLow === null && q >= 1 && q < tMin) [wLow, qLow] = [w, q];
    if (wMid === null && q >= tMin && q < tCount) [wMid, qMid] = [w, q];
  }
  const trendingNow = async () =>
    (await homeSections()).find((x) => x.key === 'trending')?.items ?? [];
  const quiet = (i) => !((i.metric ?? 0) > 0) || (i.delta?.kind === 'pct' && i.delta.value <= -100);
  let lowItems = null;
  let lowInSsr = null;
  let midItems = [];
  let lowAtMin1 = [];
  if (wLow !== null && wMid !== null) {
    await waitHomepage(
      await adminApi('/homepage/sections/trending', 'PATCH', { deltaWindowHours: wLow }),
    );
    lowItems = await trendingNow();
    lowInSsr = ssrSections(await html('/')).order.includes('trending');
    await waitHomepage(
      await adminApi('/homepage/sections/trending', 'PATCH', { deltaWindowHours: wMid }),
    );
    midItems = await trendingNow();
    await waitHomepage(
      await adminApi('/homepage/sections/trending', 'PATCH', {
        deltaWindowHours: wLow,
        minItems: 1,
      }),
    );
    lowAtMin1 = await trendingNow();
  }
  await waitHomepage(
    await adminApi('/homepage/sections/trending', 'PATCH', {
      deltaWindowHours: tWindow0,
      minItems: tMin0,
    }),
  );
  check(
    `S2.24 (S2 review fix 1) Trending lists only stories with activity in its window: N active → exactly N rows (fewer than the item count ${tCount}), each scored > 0, no "−100%"; below the minimum (${tMin}, admin-set) the section is hidden — API and page`,
    wLow !== null &&
      wMid !== null &&
      lowItems?.length === 0 &&
      lowInSsr === false &&
      midItems.length === qMid &&
      !midItems.some(quiet) &&
      lowAtMin1.length === qLow &&
      !lowAtMin1.some(quiet),
    `${wLow}h: ${qLow} active → hidden=${lowItems?.length === 0}/ssr=${lowInSsr === false} (min 1 → ${lowAtMin1.length} rows) · ${wMid}h: ${qMid} active → ${midItems.length} rows, quiet rows=${midItems.filter(quiet).length}`,
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
    paidOnBlock: await v('briefing', { paidPositions: [1] }),
    paidOutOfRange: await v('trending', { paidPositions: [0] }),
    minItemsOnBlock: await v('genres', { minItems: 2 }),
    minAboveCount: await v('trending', { minItems: 24, itemCount: 8 }),
    ourPicksAuto: await v('our_picks', { mode: 'auto' }),
    windowOnTopRated: await v('top_rated', { deltaWindowHours: 24 }),
    tooMany: await v('latest', { itemCount: 99 }),
    sourcesOnGames: await v('top_rated', { rules: { include: { sources: ['ign'] } } }),
    unknown: await v('nope', { title: 'x' }),
  };
  check(
    'S2.9 section edits are validated (paid positions / min items on a block, a paid position out of range, a minimum above the item count, Our picks auto, Δ window off-section, too many items, wrong rule dimension → 400; unknown → 404); moderator 403',
    modPatch.status === 403 &&
      results.paidOnBlock === 400 &&
      results.paidOutOfRange === 400 &&
      results.minItemsOnBlock === 400 &&
      results.minAboveCount === 400 &&
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

  // ── S2.23 + S2.14 (decision B) a paid game AND a paid story in every section
  //    that shows a list: organic data unchanged; the labels always render ──────
  const paidGame = 'cyberpunk-2077';
  const paidStory = psql(
    'SELECT slug FROM topics WHERE bias_distribution IS NOT NULL ORDER BY last_activity_at ASC LIMIT 1;',
  );
  const publicFp = async () => {
    const g = (await api(BACK, `/public/game/${paidGame}`)).json?.data;
    const t = (await api(BACK, `/public/topic/${paidStory}`)).json?.data;
    return JSON.stringify({
      rating: g?.rating,
      players: g?.playerCount,
      history: g?.playerCountHistory,
      distribution: t?.distribution,
      flags: t?.flags,
      integrity: t?.integrityTally,
      sources: t?.sourceCount,
      articles: t?.articleCount,
    });
  };
  await recomputeHomepage();
  const orgA = await organicBySection();
  const dbA = dataFingerprint();
  const pubA = await publicFp();
  const shownLists = Object.entries(orgA)
    .filter(([, v]) => v.length > 0)
    .map(([k]) => k);
  const everywhere = [];
  for (const key of shownLists) {
    await adminApi(`/homepage/sections/${key}`, 'PATCH', { paidPositions: [1, 3] });
    for (const [adv, item] of [
      [`S2 Promo G ${RUN}`, { gameSlug: paidGame }],
      [`S2 Promo S ${RUN}`, { topicSlug: paidStory }],
    ]) {
      const r = await adminApi(`/homepage/sections/${key}/promotions`, 'POST', {
        advertiserName: adv,
        ...item,
      });
      if (r.json?.data?.id) everywhere.push(r.json.data.id);
    }
  }
  s2Restore.placements.push(...everywhere);
  let lastAct = null;
  for (const id of everywhere)
    lastAct = await adminApi(`/ads/placements/${id}/status`, 'POST', { status: 'active' });
  await waitHomepage(lastAct);
  await recomputeHomepage();
  const orgB = await organicBySection();
  const dbB = dataFingerprint();
  const pubB = await publicFp();
  const withPaid = await homeSections();
  const placedOk = shownLists.filter((k) => {
    const items = withPaid.find((x) => x.key === k)?.items ?? [];
    const third = items[Math.min(2, items.length - 1)];
    return (
      items[0]?.paid?.kind === 'game' &&
      itemSlug(items[0]) === paidGame &&
      third?.paid?.kind === 'story' &&
      itemSlug(third) === paidStory
    );
  });

  // S2.14: the labels render in every one of those sections under every switch.
  const labelsIn = (h) =>
    count(h ?? '', 'class="gk-slot-flag">Promoted<') >= 2 &&
    !(h ?? '').includes('class="gk-slot-flag">Sponsored<') &&
    paidByRe(`S2 Promo G ${RUN}`).test(h ?? '') &&
    paidByRe(`S2 Promo S ${RUN}`).test(h ?? '');
  const missing = [];
  const sweep = (h, state) => {
    const by = ssrSections(h).byKey;
    for (const k of shownLists) if (!labelsIn(by.get(k))) missing.push(`${k}@${state}`);
  };
  sweep(await html('/'), 0);
  const toggles = [
    () => adminApi('/homepage/settings', 'PATCH', { showUnsoldPlaceholder: true }),
    () => setDisplay({ displayScope: 'all', showQuality: true }),
    () => adminApi('/homepage/settings', 'PATCH', { showUnsoldPlaceholder: false }),
    () => setDisplay({ displayScope: 'reviews_and_sponsored', showQuality: false }),
  ];
  for (const [n, t] of toggles.entries()) {
    const r = await t();
    if (r?.json?.jobId) await waitHomepage(r);
    sweep(await html('/'), n + 1);
  }
  check(
    `S2.14 (decision B) with a paid game + a paid story in every section that shows a list (${shownLists.length}: ${shownLists.join(', ')}), each section renders the "Promoted" label (game and story alike, never "Sponsored") with the advertiser in SSR under every switch combination (5 states)`,
    shownLists.length >= 6 &&
      shownLists.includes('trending') &&
      shownLists.includes('top_rated') &&
      missing.length === 0,
    missing.length
      ? `label missing in: ${missing.slice(0, 8).join(' ')}`
      : 'labels in every section, every state',
  );

  // Remove them all, recompute: C is the unpaid computation right after.
  for (const id of everywhere)
    await adminApi(`/ads/placements/${id}/status`, 'POST', { status: 'ended' });
  for (const key of shownLists) {
    await adminApi(`/homepage/sections/${key}`, 'PATCH', {
      paidPositions: s2Restore.sections.get(key)?.paidPositions ?? [],
    });
  }
  await recomputeHomepage();
  const orgC = await organicBySection();
  const dbC = dataFingerprint();
  const pubC = await publicFp();
  // Payment changed nothing iff the paid computation equals an unpaid one — the
  // one before (A) or right after (C; guards a time-window boundary in between).
  const sameOrg = (x, y) => Object.keys({ ...x, ...y }).every((k) => (x[k] ?? '') === (y[k] ?? ''));
  const orgOk = sameOrg(orgB, orgA) || sameOrg(orgB, orgC);
  const diffKeys = Object.keys(orgA).filter((k) => orgA[k] !== orgB[k]);
  check(
    `S2.23 (decision B) payment never changes data: with a paid game + a paid story in ${shownLists.length} sections, every organic list (order, metric, Δ), every score, player count, bias distribution and integrity signal equals the unpaid computation; each paid item sits at its position (1 and 3)`,
    placedOk.length === shownLists.length &&
      orgOk &&
      (dbB === dbA || dbB === dbC) &&
      (pubB === pubA || pubB === pubC),
    `placed ${placedOk.length}/${shownLists.length} · organic ${sameOrg(orgB, orgA) ? '=A' : sameOrg(orgB, orgC) ? '=C' : `DIFFERS in ${diffKeys.join(',')}`} · data ${dbB === dbA ? '=A' : dbB === dbC ? '=C' : 'DIFFERS'} · public ${pubB === pubA ? '=A' : pubB === pubC ? '=C' : 'DIFFERS'}`,
  );
  const ssrNow = ssrSections(await html('/'));

  // ── S2.15 Δ on the cards with its window; neutral colours ─────────────────
  const chips = (h) =>
    [
      ...(h ?? '').matchAll(
        /class="gk-delta is-([a-z]+)"[^>]*><b>([^<]*)<\/b><span class="gk-delta-win">([^<]*)<\/span>/g,
      ),
    ].map((m) => ({ kind: m[1], text: m[2], win: m[3] }));
  const trendCfgW = (await sectionsConfig()).find((x) => x.key === 'trending')?.deltaWindowHours;
  const trendWin =
    trendCfgW == null
      ? '?'
      : trendCfgW < 72 || trendCfgW % 24
        ? `${trendCfgW}h`
        : `${trendCfgW / 24}d`;
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
    `S2.15 Δ shows on the cards with its window (Trending "${trendWin}" = the configured window, By players "7d"), as New / — / ±%, never "−100%" in Trending (a quiet story doesn't trend); neutral colours (no green/red)`,
    trendChips.length >= 1 &&
      trendChips.every((c) => c.win === trendWin && textOk(c) && c.text !== '−100%') &&
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

  // ── S2.17 (decision B) the story coverage list: a sold slot → ONE labeled row ─
  const topicSlugs = psql(
    "SELECT string_agg(slug, ',') FROM (SELECT slug FROM topics WHERE bias_distribution IS NOT NULL ORDER BY last_activity_at DESC LIMIT 6) x;",
  ).split(',');
  const unsoldRows = [];
  for (const slug of topicSlugs) {
    const h = await html(`/topics/${slug}`);
    if (/data-paid-row|Promoted slot/.test(h)) unsoldRows.push(slug);
  }
  const covSlot = psql(
    "SELECT id || '|' || coalesce(list_position::text, '') FROM ad_slots WHERE key = 'topic-coverage';",
  ).split('|');
  const covPos = Number(covSlot[1]) || 1;
  const covTopic = psql(
    `SELECT t.slug FROM topics t JOIN article_topics at ON at.topic_id = t.id WHERE t.bias_distribution IS NOT NULL GROUP BY t.slug, t.last_activity_at HAVING count(*) >= ${covPos + 1} ORDER BY t.last_activity_at DESC LIMIT 1;`,
  );
  const rowSeq = (h) =>
    [...h.matchAll(/<article class="gk-srcrow( is-paid)?"[^>]*>([\s\S]*?)<\/article>/g)].map(
      (m) => ({
        paid: Boolean(m[1]),
        body: m[2],
        title: (m[2].match(/<h3 class="gk-srcrow-title">([\s\S]*?)<\/h3>/)?.[1] ?? '')
          .replace(/<[^>]+>/g, '')
          .trim(),
      }),
    );
  const countOf = (h) => h.match(/gk-coverage-count">(\d+)</)?.[1] ?? '?';
  const pageA = await html(`/topics/${covTopic}`);
  const covSale = await adminApi('/ad-placements', 'POST', {
    slotId: covSlot[0],
    advertiserName: `S2 Promo Cov ${RUN}`,
    headline: `Sponsored story ${RUN}`,
    promotedTopicSlug: paidStory,
    status: 'active',
  });
  if (covSale.json?.data?.id) s2Restore.placements.push(covSale.json.data.id);
  const badSlug = await adminApi('/ad-placements', 'POST', {
    slotId: covSlot[0],
    advertiserName: `S2 Promo Cov ${RUN}`,
    headline: 'x',
    promotedTopicSlug: `no-such-story-${RUN}`,
  });
  if (badSlug.json?.data?.id) s2Restore.placements.push(badSlug.json.data.id);
  const pageB = await html(`/topics/${covTopic}`);
  const rowsA2 = rowSeq(pageA);
  const rowsB2 = rowSeq(pageB);
  const paidIdx = rowsB2.findIndex((r) => r.paid);
  const paidRow = rowsB2[paidIdx];
  const outletA = rowsA2.map((r) => r.title).join('\n');
  const outletB = rowsB2
    .filter((r) => !r.paid)
    .map((r) => r.title)
    .join('\n');
  if (covSale.json?.data?.id) await adminApi(`/ad-placements/${covSale.json.data.id}`, 'DELETE');
  const pageC = await html(`/topics/${covTopic}`);
  check(
    `S2.17 (decision B) story coverage list: no paid row while the 'topic-coverage' slot is unsold (${topicSlugs.length} story pages); sold → ONE row labeled "Promoted" + advertiser at the slot's position (${covPos}), linking to the promoted story; the outlet rows and the count are unchanged; a placement for a missing story → 400`,
    topicSlugs.length >= 3 &&
      unsoldRows.length === 0 &&
      Boolean(covTopic) &&
      covSale.status < 300 &&
      rowsB2.filter((r) => r.paid).length === 1 &&
      paidIdx === Math.min(covPos, rowsA2.length + 1) - 1 &&
      paidRow?.body.includes('class="gk-slot-flag">Promoted<') &&
      paidByRe(`S2 Promo Cov ${RUN}`).test(paidRow?.body ?? '') &&
      paidRow?.body.includes(`href="/topics/${paidStory}"`) &&
      outletA === outletB &&
      countOf(pageA) === countOf(pageB) &&
      !/data-paid-row/.test(pageC) &&
      badSlug.status === 400,
    `unsold rows on: ${unsoldRows.join(',') || 'none'} · sold → paid rows=${rowsB2.filter((r) => r.paid).length} at #${paidIdx + 1} (slot ${covPos}) outlets kept=${outletA === outletB} count ${countOf(pageA)}→${countOf(pageB)} · removed=${!/data-paid-row/.test(pageC)} · bad slug=${badSlug.status}`,
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

  // ── S2.21 Our picks: hidden while empty; organic "Our pick"; paid → its label ─
  const emptyHidden = !ssrSections(home).order.includes('our_picks');
  await adminApi('/homepage/sections/our_picks', 'PATCH', { paidPositions: [2] });
  const opPromo = await adminApi('/homepage/sections/our_picks/promotions', 'POST', {
    advertiserName: `S2 Promo P ${RUN}`,
    gameSlug: 'cyberpunk-2077',
  });
  const opId = opPromo.json?.data?.id;
  if (opId) s2Restore.placements.push(opId);
  await waitHomepage(
    await adminApi(`/ads/placements/${opId}/status`, 'POST', { status: 'active' }),
  );
  const paidAloneHidden = !ssrSections(await html('/')).order.includes('our_picks');
  await waitHomepage(
    await adminApi('/homepage/sections/our_picks/pins', 'PUT', {
      pins: [{ position: 1, gameSlug: 'hades-ii' }],
    }),
  );
  const picks = ssrSections(await html('/')).byKey.get('our_picks') ?? '';
  const cards = picks.split('<article class="gk-hgcard').slice(1);
  const pickCard = cards.find((x) => x.includes('/games/hades-ii')) ?? '';
  const paidCard = cards.find((x) => x.includes('/games/cyberpunk-2077')) ?? '';
  await adminApi(`/ads/placements/${opId}/status`, 'POST', { status: 'ended' });
  await adminApi('/homepage/sections/our_picks', 'PATCH', {
    paidPositions: s2Restore.sections.get('our_picks')?.paidPositions ?? [],
  });
  check(
    'S2.21 Our picks is hidden while empty — a paid item alone never shows it; an organic pick renders the neutral "Our pick" label; a paid item inside Our picks shows "Promoted" + advertiser, never "Our pick"',
    emptyHidden &&
      paidAloneHidden &&
      cards.length === 2 &&
      pickCard.includes('Our pick') &&
      !/Promoted|Sponsored|Paid promotion/.test(pickCard) &&
      paidCard.includes('>Promoted<') &&
      paidByRe(`S2 Promo P ${RUN}`).test(paidCard) &&
      !paidCard.includes('Our pick'),
    `hiddenWhenEmpty=${emptyHidden} paidAloneHidden=${paidAloneHidden} cards=${cards.length} pick="Our pick"=${pickCard.includes('Our pick')} paid label=${paidCard.includes('>Promoted<')} paid "Our pick"=${paidCard.includes('Our pick')}`,
  );
}

async function s2Fixes() {
  // ── S2.25 (S2 review fix 3) the suggest rate limits are an admin setting ────
  const sSnap = snapshotSettings(['suggest']);
  const sGet = await adminApi('/catalog/suggest-settings');
  const sMod = await login('demo-moderator', DEMO_PW);
  const sModGet = await api(BACK, '/admin/api/catalog/suggest-settings', { jar: sMod.jar });
  const sModPatch = await api(BACK, '/admin/api/catalog/suggest-settings', {
    method: 'PATCH',
    jar: sMod.jar,
    csrf: sMod.csrf,
    body: { perIpMax: 999 },
  });
  const raise = await adminApi('/catalog/suggest-settings', 'PATCH', {
    perIpMax: 1000,
    globalMax: 100000,
  });
  const sAnon = await withCsrf();
  const suggest = (name) =>
    api(BACK, '/public/suggest-game', {
      method: 'POST',
      jar: sAnon.jar,
      csrf: sAnon.csrf,
      body: { name },
    });
  const sugA = await suggest(`Verify Suggest P ${RUN}`);
  const lower = await adminApi('/catalog/suggest-settings', 'PATCH', { perIpMax: 1 });
  const sugB = await suggest(`Verify Suggest Q ${RUN}`);
  const bad = [
    await adminApi('/catalog/suggest-settings', 'PATCH', { perIpMax: 0 }),
    await adminApi('/catalog/suggest-settings', 'PATCH', { windowMinutes: 5000 }),
    await adminApi('/catalog/suggest-settings', 'PATCH', { perIpMax: 500, globalMax: 100 }),
    await adminApi('/catalog/suggest-settings', 'PATCH', { unknownKey: 1 }),
  ].map((r) => r.status);
  const sAudit = Number(
    psql(
      "SELECT count(*) FROM audit_logs WHERE entity_type = 'app-settings' AND entity_id = 'suggest' AND created_at > now() - interval '5 minutes';",
    ),
  );
  restoreSettings(sSnap);
  const windowMin = sGet.json?.data?.windowMinutes ?? 10;
  // A later verify:upcoming waits out this run's suggestion too (its burst key).
  try {
    execSync(
      `docker exec gameskeep-redis-1 redis-cli SET gk:verify:upcoming:suggest-burst ${Date.now()} EX ${windowMin * 60}`,
      { encoding: 'utf8' },
    );
  } catch {
    /* best-effort */
  }
  psql(
    `BEGIN;
${auditSql({ action: 'delete', entityType: 'unmatched-games', entityId: `verify-run-${RUN}`, summary: `verify cleanup removed run ${RUN}'s test suggestions` })}
DELETE FROM unmatched_games WHERE raw_name IN (${lit(`Verify Suggest P ${RUN}`)}, ${lit(`Verify Suggest Q ${RUN}`)});
COMMIT;`,
  );
  const freshDefaults =
    sSnap.map.size > 0 ||
    JSON.stringify(sGet.json?.data) ===
      JSON.stringify({ perIpMax: 5, globalMax: 60, windowMinutes: 10 });
  check(
    'S2.25 (S2 review fix 3) the suggest-a-game rate limits are an admin setting (app_settings suggest; defaults 5 per IP / 60 overall / 10 min): moderator 403; raising them lets a suggestion through at once, lowering to 1 per IP → the next is 429; out-of-range / per-IP above overall / unknown key → 400; changes audited',
    sGet.status === 200 &&
      freshDefaults &&
      sModGet.status === 403 &&
      sModPatch.status === 403 &&
      raise.status === 200 &&
      sugA.status === 200 &&
      lower.status === 200 &&
      sugB.status === 429 &&
      bad.every((x) => x === 400) &&
      sAudit >= 2,
    `get=${sGet.status} ${JSON.stringify(sGet.json?.data)} mod=${sModGet.status}/${sModPatch.status} raise=${raise.status} → suggest ${sugA.status} · lower=${lower.status} → suggest ${sugB.status} · bad=${bad.join(',')} audit=${sAudit}`,
  );

  // ── S2.26 (S2 review fix 4) connection errors: diagnosed, never retried ─────
  let conns = 0;
  const resetter = net.createServer((sock) => {
    conns += 1;
    sock.destroy();
  });
  await new Promise((r) => resetter.listen(0, '127.0.0.1', r));
  const probeUrl = `http://127.0.0.1:${resetter.address().port}/netdiag-probe-${RUN}`;
  const captured = [];
  const realWrite = process.stderr.write;
  process.stderr.write = (chunk) => {
    captured.push(String(chunk));
    return true;
  };
  let thrown = null;
  try {
    await fetch(probeUrl);
  } catch (e) {
    thrown = e;
  } finally {
    process.stderr.write = realWrite;
  }
  resetter.close();
  const diag = captured.join('');
  const suites = readdirSync('scripts').filter((f) => f.endsWith('-check.mjs'));
  const unwired = suites.filter(
    (f) => !/^import '\.\/lib\/netdiag\.mjs';/m.test(readFileSync(`scripts/${f}`, 'utf8')),
  );
  check(
    'S2.26 (S2 review fix 4) every suite routes fetch through netdiag: a connection reset is NOT retried (one connection), the original error is rethrown, and one NETDIAG block logs time, method + URL, cause, docker compose ps and the backend + frontend logs around it',
    conns === 1 &&
      ['ECONNRESET', 'UND_ERR_SOCKET'].includes(thrown?.cause?.code) &&
      diag.includes('NETDIAG: connection error') &&
      diag.includes(`GET ${probeUrl}`) &&
      /time\s+\d{4}-\d\d-\d\dT/.test(diag) &&
      diag.includes('── docker compose ps ──') &&
      diag.includes('gameskeep-backend-1') &&
      diag.includes('── backend logs') &&
      diag.includes('── frontend logs') &&
      unwired.length === 0,
    `connections=${conns} rethrown=${thrown?.cause?.code ?? thrown?.message} block=${diag.includes('NETDIAG')} suites wired ${suites.length - unwired.length}/${suites.length}${unwired.length ? ` (missing: ${unwired.join(',')})` : ''}`,
  );
}

// ═══════════════════════ Phase P S3 — tags ═══════════════════════════════════
// Fixture pairs (game × tag) this group creates — removed in restoreS3 (audited).
const S3_PAIRS = [
  ['hades-ii', 'horror'],
  ['hades-ii', 'bugs'],
  ['hades-ii', 'always-online-drm'],
  ['stellar-drifter', 'cheaters'],
  ['stellar-drifter', 'pay-to-win'],
];
const s3Restore = {
  settings: null,
  pairs: [],
  section: null, // by_players card-tag config
  predatoryWas: null,
  reopenImport: null, // { id, state } of the import row the sticky-removal check touched
};
const tagRow = (game, tag) => {
  const r = psql(
    `SELECT gt.id || '|' || gt.state || '|' || gt.source || '|' || gt.weighted_score || '|' || gt.vote_count || '|' || gt.flagged FROM game_tags gt JOIN tags t ON t.id = gt.tag_id JOIN games g ON g.id = gt.game_id JOIN subjects s ON s.id = g.subject_id WHERE s.slug = ${lit(game)} AND t.slug = ${lit(tag)};`,
  );
  if (!r) return null;
  const [id, state, source, score, count, flagged] = r.split('|');
  return {
    id,
    state,
    source,
    score: Number(score),
    count: Number(count),
    flagged: flagged === 'true' || flagged === 't', // boolean || text → 'true'
  };
};
const tagVote = (u, game, tag, method = 'POST') =>
  api(BACK, `/community/tags/${game}/${tag}/vote`, { method, jar: u.jar, csrf: u.csrf });
const tagGroupsOf = async (slug) =>
  (await api(BACK, `/public/game/${slug}`)).json?.data?.tagGroups ?? { content: [], issues: [] };
// React separates adjacent SSR text nodes with <!-- -->; compare the text as read.
const tagsPanel = (h) =>
  (h.match(/<section class="gk-panel gk-gametags"[\s\S]*?<\/section>/)?.[0] ?? '').replace(
    /<!-- -->/g,
    '',
  );
const contentGroupOf = (panel) => {
  const a = panel.indexOf('>Content</h3>');
  const b = panel.indexOf('>Issues</h3>');
  return a < 0 ? '' : panel.slice(a, b < 0 ? undefined : b);
};
const issuesGroupOf = (panel) => {
  const b = panel.indexOf('>Issues</h3>');
  return b < 0 ? '' : panel.slice(b);
};
async function credibleUser(tag) {
  const u = await makeVerified(tag);
  // Aged + reputable → credibility 1.0 (email 0.45 + activity 0.35 + age 0.2).
  psql(
    `UPDATE users SET reputation = 80, created_at = now() - interval '60 days' WHERE id = ${lit(u.id)};`,
  );
  return u;
}
/** `<button class="gk-qv-btn">` occurrences that sit INSIDE an <a> (must be 0). */
function buttonsInsideAnchors(h, cls) {
  let depth = 0;
  let inside = 0;
  let total = 0;
  const re = new RegExp(`<a[\\s>]|</a>|<button[^>]*class="${cls}"`, 'gi');
  let m;
  while ((m = re.exec(h)) !== null) {
    if (m[0].startsWith('</')) depth = Math.max(0, depth - 1);
    else if (m[0].startsWith('<a')) depth += 1;
    else {
      total += 1;
      if (depth > 0) inside += 1;
    }
  }
  return { inside, total };
}
const modAct = (mod, path, body) =>
  api(BACK, `/admin/api/${path}`, { method: 'POST', jar: mod.jar, csrf: mod.csrf, body });

async function s3() {
  s3Restore.settings = snapshotSettings(['tags']);
  const taken = S3_PAIRS.filter(([g, t]) => tagRow(g, t));
  if (
    !check(
      'S3.0 the S3 fixture pairs (game × tag) are free before the run',
      taken.length === 0,
      taken.map((p) => p.join('/')).join(' ') || 'all free',
    )
  )
    return;
  s3Restore.pairs = S3_PAIRS;
  // A lower bar keeps the gate test independent of a reputation recompute that
  // could land mid-run (fresh accounts still score 0 — the floor, not the bar).
  await adminApi('/tag-settings', 'PATCH', { publishThreshold: 2 });
  const mod = await login('demo-moderator', DEMO_PW);
  clearOwnEmailThrottle();
  const voters = [];
  for (let i = 0; i < 4; i += 1) voters.push(await credibleUser(`tv${i}`));

  // ── S3.1 (acc.1) above the threshold but unconfirmed → not public ───────────
  const votes = [];
  for (const u of voters) votes.push((await tagVote(u, 'hades-ii', 'horror')).status);
  const again = (await tagVote(voters[0], 'hades-ii', 'horror')).status;
  const r1 = tagRow('hades-ii', 'horror');
  const q1 = ((await adminApi('/tag-queue')).json?.data?.pending ?? []).find(
    (x) => x.game.slug === 'hades-ii' && x.tag.slug === 'horror',
  );
  const pubBefore = (await tagGroupsOf('hades-ii')).content.some((t) => t.slug === 'horror');
  const panelBefore = tagsPanel(await html('/games/hades-ii'));
  const catBefore = ((await api(BACK, '/public/catalog?tag=horror')).json?.data?.games ?? []).some(
    (g) => g.slug === 'hades-ii',
  );
  const anonConfirm = await api(BACK, `/admin/api/tag-queue/${q1?.id}/confirm`, { method: 'POST' });
  const regConfirm = await api(BACK, `/admin/api/tag-queue/${q1?.id}/confirm`, {
    method: 'POST',
    jar: voters[0].jar,
    csrf: voters[0].csrf,
  });
  const modConfirm = await modAct(mod, `tag-queue/${q1?.id}/confirm`);
  const pubAfter = (await tagGroupsOf('hades-ii')).content.find((t) => t.slug === 'horror');
  const panelAfter = tagsPanel(await html('/games/hades-ii'));
  check(
    'S3.1 (acc.1) a tag whose credibility-weighted score is above the threshold is NOT public until an editor confirms (API, game page, catalog filter); one vote per user (a repeat changes nothing); anon 401 / reader 403 / moderator confirms → public; a content tag shows no provenance line',
    votes.every((s) => s === 200) &&
      again === 200 &&
      r1?.state === 'pending' &&
      r1?.count === 4 &&
      r1?.score >= 2 &&
      q1?.thresholdReached === true &&
      !pubBefore &&
      !panelBefore.includes('/games/tag/horror') &&
      !catBefore &&
      anonConfirm.status === 401 &&
      regConfirm.status === 403 &&
      modConfirm.status === 200 &&
      Boolean(pubAfter) &&
      panelAfter.includes('/games/tag/horror') &&
      !/Reported by players|Added by editors/.test(contentGroupOf(panelAfter)),
    `votes=${votes.join(',')} repeat=${again} → ${r1?.state} score=${r1?.score} votes=${r1?.count} reached=${q1?.thresholdReached} · public before=${pubBefore}/${panelBefore.includes('/games/tag/horror')}/${catBefore} · anon=${anonConfirm.status} reader=${regConfirm.status} mod=${modConfirm.status} → public=${Boolean(pubAfter)}`,
  );

  // ── S3.2 (acc.2) a brigade of fresh accounts can't publish; flag raised ─────
  clearOwnEmailThrottle();
  const ring = [];
  for (let i = 0; i < 8; i += 1) ring.push(await makeVerified(`tr${i}`));
  const ringVotes = [];
  for (const u of ring) ringVotes.push((await tagVote(u, 'stellar-drifter', 'cheaters')).status);
  const r2 = tagRow('stellar-drifter', 'cheaters');
  const q2 = ((await adminApi('/tag-queue')).json?.data?.pending ?? []).find(
    (x) => x.game.slug === 'stellar-drifter' && x.tag.slug === 'cheaters',
  );
  const brigadeConfirm = await modAct(mod, `tag-queue/${q2?.id}/confirm`);
  const issuesHidden = !(await tagGroupsOf('stellar-drifter')).issues.some(
    (t) => t.slug === 'cheaters',
  );
  // Editors may still publish it themselves; the public label follows the switch.
  const direct = await modAct(mod, 'tag-queue/publish', {
    gameSlug: 'stellar-drifter',
    tagSlug: 'cheaters',
  });
  const labelOff = tagsPanel(await html('/games/stellar-drifter')).includes(
    'Unusual voting activity',
  );
  const on = await adminApi('/tag-settings', 'PATCH', { showAnomalyLabel: true });
  const labelOn = issuesGroupOf(tagsPanel(await html('/games/stellar-drifter'))).includes(
    'Unusual voting activity',
  );
  await adminApi('/tag-settings', 'PATCH', { showAnomalyLabel: false });
  check(
    'S3.2 (acc.2) a brigade of 8 fresh verified accounts adds NOTHING to the score (below the credibility floor) — confirm → 409, nothing public — and raises the anomaly flag, always shown in the admin queue; publicly "Unusual voting activity" shows only with the switch on (default OFF)',
    ringVotes.every((s) => s === 200) &&
      r2?.count === 8 &&
      r2?.score === 0 &&
      r2?.flagged === true &&
      q2?.flagged === true &&
      q2?.thresholdReached === false &&
      brigadeConfirm.status === 409 &&
      issuesHidden &&
      direct.status === 201 &&
      !labelOff &&
      on.status === 200 &&
      labelOn,
    `ring votes=${r2?.count} score=${r2?.score} flagged=${r2?.flagged} queue flag=${q2?.flagged} · confirm=${brigadeConfirm.status} hidden=${issuesHidden} · direct=${direct.status} label off=${labelOff} on=${labelOn}`,
  );

  // ── S3.3 (acc.3) include / exclude; the URL round-trips; filtered = noindex ─
  const truth = new Set(
    psql(
      "SELECT string_agg(s.slug, ',') FROM game_tags gt JOIN tags t ON t.id = gt.tag_id JOIN games g ON g.id = gt.game_id JOIN subjects s ON s.id = g.subject_id WHERE t.slug = 'story-rich' AND gt.state = 'published' AND t.active;",
    )
      .split(',')
      .filter(Boolean),
  );
  const big = async (qs) => {
    const all = [];
    for (let page = 1; page < 30; page += 1) {
      const d = (await api(BACK, `/public/catalog?${qs}&page=${page}`)).json?.data;
      all.push(...(d?.games ?? []).map((g) => g.slug));
      if (!d || page >= d.totalPages) return { slugs: all, total: d?.total ?? 0 };
    }
    return { slugs: all, total: -1 };
  };
  const inc = await big('tag=story-rich');
  const exc = await big('xtag=story-rich');
  const catalogTotal = (await api(BACK, '/public/catalog')).json?.data?.total ?? -1;
  const browse = await html('/games/browse?tag=story-rich&xtag=open-world');
  const includeChip = browse.match(
    /class="gk-facetchip gk-tristate is-include[^"]*" href="([^"]+)"/,
  );
  const nextHref = (includeChip?.[1] ?? '').replace(/&amp;/g, '&');
  const nextData = (await api(BACK, `/public/catalog${nextHref.replace('/games/browse', '')}`)).json
    ?.data?.applied;
  check(
    'S3.3 (acc.3) include keeps exactly the games carrying the published tag, exclude removes every one of them (DB truth); a chip link round-trips its state through the URL; a tag-filtered page is noindex,follow with canonical to /games/browse',
    truth.size >= 2 &&
      inc.slugs.length === truth.size &&
      inc.slugs.every((s) => truth.has(s)) &&
      exc.slugs.every((s) => !truth.has(s)) &&
      exc.total === catalogTotal - truth.size &&
      /<meta name="robots" content="noindex, ?follow"/.test(browse) &&
      /<link rel="canonical" href="[^"]*\/games\/browse"/.test(browse) &&
      nextHref.includes('xtag=story-rich') &&
      nextData?.xtags?.includes('story-rich') &&
      !nextData?.tags?.includes('story-rich'),
    `story-rich=${truth.size} include=${inc.slugs.length} exclude=${exc.total} (catalog ${catalogTotal}) noindex=${/noindex/.test(browse)} include-chip → ${nextHref || 'none'} → applied xtags=${JSON.stringify(nextData?.xtags)}`,
  );

  // ── S3.4 (acc.4) an expired vote-driven issue → "Past issue" with dates ─────
  for (const u of voters) await tagVote(u, 'hades-ii', 'bugs');
  const bugs = tagRow('hades-ii', 'bugs');
  const bugsConfirm = await modAct(mod, `tag-queue/${bugs?.id}/confirm`);
  const activeFirst = (await tagGroupsOf('hades-ii')).issues.find((t) => t.slug === 'bugs')?.status;
  psql(
    `BEGIN;
UPDATE game_tag_votes SET created_at = now() - interval '100 days' WHERE game_id = (SELECT g.id FROM games g JOIN subjects s ON s.id = g.subject_id WHERE s.slug = 'hades-ii') AND tag_id = (SELECT id FROM tags WHERE slug = 'bugs');
UPDATE game_tags SET first_seen_at = now() - interval '110 days', last_vote_at = now() - interval '100 days', last_confirmed_at = now() - interval '100 days' WHERE id = ${lit(bugs?.id ?? '00000000-0000-0000-0000-000000000000')};
${auditSql({ entityType: 'game-tag', entityId: bugs?.id ?? 'none', summary: 'verify fixture: backdated a test issue tag 100 days (expiry check)' })}
COMMIT;`,
  );
  const past = (await tagGroupsOf('hades-ii')).issues.find((t) => t.slug === 'bugs');
  const issuesHtml = issuesGroupOf(tagsPanel(await html('/games/hades-ii')));
  check(
    'S3.4 (acc.4) a vote-driven issue with no fresh signal past the expiry (60 days) renders "Past issue" with its date range, muted, with its provenance + first-seen / last-confirmed dates',
    bugsConfirm.status === 200 &&
      activeFirst === 'active' &&
      past?.status === 'past' &&
      Boolean(past?.pastUntil) &&
      /Past issue · [A-Z][a-z]{2} \d{1,2}, \d{4} – [A-Z][a-z]{2} \d{1,2}, \d{4}/.test(issuesHtml) &&
      issuesHtml.includes('gk-issue is-past') &&
      issuesHtml.includes('Reported by players · confirmed by editors') &&
      /First seen [A-Z][a-z]{2} \d/.test(issuesHtml),
    `confirm=${bugsConfirm.status} fresh=${activeFirst} → backdated=${past?.status} until=${past?.pastUntil?.slice(0, 10)}`,
  );

  // ── S3.6 provenance: editor-added issue; resolve with a patch reference ─────
  const ed = await modAct(mod, 'tag-queue/publish', {
    gameSlug: 'hades-ii',
    tagSlug: 'always-online-drm',
  });
  const edRow = tagRow('hades-ii', 'always-online-drm');
  psql(
    `BEGIN;
UPDATE game_tags SET first_seen_at = now() - interval '400 days', last_confirmed_at = now() - interval '400 days' WHERE id = ${lit(edRow?.id ?? '00000000-0000-0000-0000-000000000000')};
${auditSql({ entityType: 'game-tag', entityId: edRow?.id ?? 'none', summary: 'verify fixture: backdated an editor-added test issue 400 days (no-expiry check)' })}
COMMIT;`,
  );
  const edStatus = (await tagGroupsOf('hades-ii')).issues.find(
    (t) => t.slug === 'always-online-drm',
  );
  const noPatch = await modAct(mod, `tag-queue/${edRow?.id}/resolve`, {});
  let dbCheck = 'ACCEPTED';
  try {
    psql(
      `UPDATE game_tags SET resolved_at = now(), patch_ref = NULL WHERE id = ${lit(edRow?.id)};`,
    );
  } catch (e) {
    dbCheck = /check constraint/i.test(String(e.stderr ?? e.message)) ? 'rejected' : 'error';
  }
  const resolved = await modAct(mod, `tag-queue/${edRow?.id}/resolve`, {
    patchRef: `Verify ${RUN}`,
  });
  const resolvedHtml = issuesGroupOf(tagsPanel(await html('/games/hades-ii')));
  check(
    'S3.6 provenance is truthful: an editor-added issue reads "Added by editors" (a voted one "Reported by players · confirmed by editors", S3.4) and never expires, even 400 days old; resolving needs a patch reference (API 400 + DB CHECK) and then shows "Resolved in <patch>"',
    ed.status === 201 &&
      edStatus?.provenance === 'Added by editors' &&
      edStatus?.status === 'active' &&
      noPatch.status === 400 &&
      dbCheck === 'rejected' &&
      resolved.status === 200 &&
      resolvedHtml.includes(`Resolved in Verify ${RUN}`) &&
      resolvedHtml.includes('Added by editors'),
    `publish=${ed.status} provenance="${edStatus?.provenance}" 400d-old status=${edStatus?.status} · resolve w/o patch=${noPatch.status} db=${dbCheck} · resolve=${resolved.status} shown=${resolvedHtml.includes(`Resolved in Verify ${RUN}`)}`,
  );

  // ── S3.5 (acc.5) tag pages: indexable ≥ N games, sitemap, no nested anchors ─
  const settingsNow = (await adminApi('/tag-settings')).json?.data;
  const minN = settingsNow?.indexMinGames ?? 5;
  const bigTag = psql(
    `SELECT t.slug FROM game_tags gt JOIN tags t ON t.id = gt.tag_id WHERE gt.state = 'published' AND t.active GROUP BY t.slug HAVING count(*) >= ${minN} ORDER BY count(*) DESC LIMIT 1;`,
  );
  const smallTag = psql(
    `SELECT t.slug FROM game_tags gt JOIN tags t ON t.id = gt.tag_id WHERE gt.state = 'published' AND t.active GROUP BY t.slug HAVING count(*) BETWEEN 1 AND ${minN - 1} ORDER BY count(*) DESC LIMIT 1;`,
  );
  const smallCount = Number(
    psql(
      `SELECT count(*) FROM game_tags gt JOIN tags t ON t.id = gt.tag_id WHERE gt.state = 'published' AND t.slug = ${lit(smallTag)};`,
    ),
  );
  const sitemap1 = await html('/sitemap.xml');
  const bigPage = await html(`/games/tag/${bigTag}`);
  const smallPage = await html(`/games/tag/${smallTag}`);
  await adminApi('/tag-settings', 'PATCH', { indexMinGames: Math.max(1, smallCount) });
  const sitemap2 = await html('/sitemap.xml');
  const smallPage2 = await html(`/games/tag/${smallTag}`);
  await adminApi('/tag-settings', 'PATCH', { indexMinGames: minN });
  const missing404 = (await api(FRONT, '/games/tag/no-such-tag-zz')).status;
  const browseHtml = await html('/games/browse');
  const qvBrowse = buttonsInsideAnchors(browseHtml, 'gk-qv-btn');
  const qvHome = buttonsInsideAnchors(await html('/'), 'gk-qv-btn');
  const qvTag = buttonsInsideAnchors(bigPage, 'gk-qv-btn');
  check(
    `S3.5 (acc.5) tag pages: SSR CollectionPage; indexable + in the sitemap only with ≥ ${minN} published games (admin-set) — a thinner one is noindex and out, and lowering the minimum brings it in; unknown tag 404; zero nested anchors on catalog / tag / home cards with quick view (the button is outside every link)`,
    Boolean(bigTag) &&
      Boolean(smallTag) &&
      sitemap1.includes(`/games/tag/${bigTag}<`) &&
      !sitemap1.includes(`/games/tag/${smallTag}<`) &&
      bigPage.includes('"@type":"CollectionPage"') &&
      !/<meta name="robots" content="noindex/.test(bigPage) &&
      /<meta name="robots" content="noindex/.test(smallPage) &&
      sitemap2.includes(`/games/tag/${smallTag}<`) &&
      !/<meta name="robots" content="noindex/.test(smallPage2) &&
      missing404 === 404 &&
      maxAnchorDepth(browseHtml) === 1 &&
      maxAnchorDepth(bigPage) === 1 &&
      qvBrowse.total > 0 &&
      qvBrowse.inside === 0 &&
      qvHome.inside === 0 &&
      qvTag.inside === 0,
    `big=${bigTag} small=${smallTag}(${smallCount}) sitemap big=${sitemap1.includes(`/games/tag/${bigTag}<`)} small=${sitemap1.includes(`/games/tag/${smallTag}<`)}→${sitemap2.includes(`/games/tag/${smallTag}<`)} · quick view buttons browse ${qvBrowse.total} (inside links ${qvBrowse.inside}) home inside ${qvHome.inside} · 404=${missing404}`,
  );

  // ── S3.7 homepage cards render the S2 tag families + count ─────────────────
  const bp0 = (await sectionsConfig()).find((x) => x.key === 'by_players');
  s3Restore.section = {
    cardTagFamilies: bp0?.cardTagFamilies ?? [],
    cardTagCount: bp0?.cardTagCount ?? 0,
  };
  await waitHomepage(
    await adminApi('/homepage/sections/by_players', 'PATCH', {
      cardTagFamilies: ['issue', 'content'],
      cardTagCount: 2,
    }),
  );
  const bp = (await homeSections()).find((x) => x.key === 'by_players');
  const expectFor = async (slug) => {
    const g = await tagGroupsOf(slug);
    return [...g.issues.filter((t) => t.status === 'active'), ...g.content]
      .slice(0, 2)
      .map((t) => t.slug)
      .join(',');
  };
  let cardsOk = (bp?.items ?? []).length > 0;
  for (const it of bp?.items ?? []) {
    if (!it.game) continue;
    if ((it.tags ?? []).map((t) => t.slug).join(',') !== (await expectFor(it.game.slug))) {
      cardsOk = false;
    }
  }
  const hd = (bp?.items ?? []).find((i) => i.game?.slug === 'helldivers-2');
  const bpHtml = ssrSections(await html('/')).byKey.get('by_players') ?? '';
  const badFamily = await adminApi('/homepage/sections/by_players', 'PATCH', {
    cardTagFamilies: ['ideology'],
  });
  await waitHomepage(await adminApi('/homepage/sections/by_players', 'PATCH', s3Restore.section));
  check(
    'S3.7 homepage cards render the S2-stored tag families + count: By players set to [issue, content] × 2 → every game card shows exactly its first 2 (current issues first), rendered as tag chips; an unknown family → 400',
    cardsOk &&
      (hd ? hd.tags?.[0]?.family === 'issue' : true) &&
      bpHtml.includes('gk-tagchip') &&
      badFamily.status === 400,
    `cards follow config=${cardsOk} helldivers=${(hd?.tags ?? []).map((t) => t.slug).join('+') || 'n/a'} chips in SSR=${bpHtml.includes('gk-tagchip')} bad family=${badFamily.status}`,
  );

  // ── S3.8 quick view: data, cache, BFF, accessible dialog markup ────────────
  const qv1 = await api(BACK, '/public/game/helldivers-2/quick');
  const qv2 = await api(BACK, '/public/game/helldivers-2/quick');
  const qvBff = await api(FRONT, '/api/public/game/helldivers-2/quick');
  const qvMissing = await api(BACK, '/public/game/no-such-game-zz/quick');
  const d = qv1.json?.data;
  const dialogOk =
    /<button[^>]*class="gk-qv-btn"[^>]*aria-haspopup="dialog"/.test(browseHtml) &&
    /<dialog[^>]*class="gk-qv"[^>]*aria-labelledby="[^"]+"/.test(browseHtml);
  check(
    'S3.8 quick view: the three rating layers, the disconnect, grouped tags and Steam players (current + Δ) from the cached public endpoint (miss → hit), reachable through the public BFF; unknown game 404; the button opens a native modal <dialog> labelled by its title',
    qv1.status === 200 &&
      d &&
      'critics' in d.layers &&
      'our' in d.layers &&
      'community' in d.layers &&
      d.disconnect &&
      Array.isArray(d.tags?.content) &&
      Array.isArray(d.tags?.issues) &&
      d.tags.issues.some((t) => t.slug === 'server-problems') &&
      d.players &&
      typeof d.players.current === 'number' &&
      qv2.res.headers.get('x-cache') === 'hit' &&
      qvBff.status === 200 &&
      qvMissing.status === 404 &&
      dialogOk,
    `layers=${JSON.stringify(d?.layers)} players=${d?.players?.current} Δ=${JSON.stringify(d?.players?.delta)} cache=${qv1.res.headers.get('x-cache')}→${qv2.res.headers.get('x-cache')} bff=${qvBff.status} 404=${qvMissing.status} dialog=${dialogOk}`,
  );

  // ── S3.9 the owner's migration decisions + an editor's removal sticks ──────
  const importRow = psql(
    "SELECT s.slug || '|' || gt.source FROM game_tags gt JOIN tags t ON t.id = gt.tag_id JOIN games g ON g.id = gt.game_id JOIN subjects s ON s.id = g.subject_id WHERE t.slug = 'story-rich' AND gt.source = 'import' LIMIT 1;",
  ).split('|');
  const queuedUnmatched = Number(
    psql(
      "SELECT count(*) FROM tag_suggestions WHERE source = 'import' AND status = 'pending' AND normalized = 'metroidvania';",
    ),
  );
  const indieTouched = Number(
    psql(
      "SELECT (SELECT count(*) FROM tag_suggestions WHERE normalized = 'indie') + (SELECT count(*) FROM tags WHERE slug = 'indie');",
    ),
  );
  // Editor removal sticks through a re-sync.
  const rogue = tagRow('hades-ii', 'roguelike');
  s3Restore.reopenImport = rogue ? { id: rogue.id, state: rogue.state } : null;
  const removed = rogue ? await modAct(mod, `tag-queue/${rogue.id}/reject`) : { status: 0 };
  // Pay-to-win: the legacy predatory flag becomes the issue tag on (re-)sync.
  s3Restore.predatoryWas = psql(
    "SELECT f.predatory_monetization::text FROM game_content_flags f JOIN games g ON g.id = f.game_id JOIN subjects s ON s.id = g.subject_id WHERE s.slug = 'stellar-drifter';",
  );
  psql(
    `BEGIN;
UPDATE game_content_flags SET predatory_monetization = true WHERE game_id = (SELECT g.id FROM games g JOIN subjects s ON s.id = g.subject_id WHERE s.slug = 'stellar-drifter');
${auditSql({ entityType: 'game-content-flags', entityId: 'stellar-drifter', summary: 'verify fixture: set the legacy predatory flag (Pay-to-win migration check)' })}
COMMIT;`,
  );
  const sync = await adminApi('/tag-queue/sync', 'POST', {});
  const rogueAfter = tagRow('hades-ii', 'roguelike');
  const sd = await api(BACK, '/public/game/stellar-drifter');
  const p2w = (sd.json?.data?.tagGroups?.issues ?? []).find((t) => t.slug === 'pay-to-win');
  check(
    'S3.9 owner migration decisions: a matching imported tag is published (source import, no provenance claim); an unmatched one waits as a suggestion; "indie" is never a tag (is_indie stays a property); the predatory content flag becomes the Pay-to-win ISSUE tag ("Added by editors", no expiry) and leaves the public content flags; an editor\'s removal survives a re-sync',
    importRow[1] === 'import' &&
      queuedUnmatched >= 1 &&
      indieTouched === 0 &&
      sync.status === 200 &&
      (sync.json?.data?.payToWin ?? 0) >= 1 &&
      p2w?.provenance === 'Added by editors' &&
      p2w?.status === 'active' &&
      !('payToWinPredatory' in (sd.json?.data?.contentFlags?.monetization ?? {})) &&
      removed.status === 200 &&
      rogueAfter?.state === 'rejected',
    `import=${importRow.join('/')} unmatched queued=${queuedUnmatched} indie=${indieTouched} · sync=${sync.status} p2w=${sync.json?.data?.payToWin} "${p2w?.provenance}" · removal ${rogue?.state}→${rogueAfter?.state}`,
  );

  // ── S3.10 reader vote rules + suggestions + GDPR export ─────────────────────
  const unv = {
    username: `p_tunv_${RUN}`,
    email: `p_tunv_${RUN}@example.test`,
    password: 'Str0ng-pass-tunv9!',
  };
  const reg = await withCsrf();
  await api(BACK, '/auth/register', { method: 'POST', jar: reg.jar, csrf: reg.csrf, body: unv });
  const unvLogin = await login(unv.username, unv.password);
  const unverified = await tagVote(unvLogin, 'hades-ii', 'co-op');
  const noCsrf = await api(BACK, '/community/tags/hades-ii/co-op/vote', {
    method: 'POST',
    jar: voters[1].jar,
  });
  const unknownTag = await tagVote(voters[1], 'hades-ii', 'no-such-tag-zz');
  const badSlug = await api(BACK, '/community/tags/Hades%20II/co-op/vote', {
    method: 'POST',
    jar: voters[1].jar,
    csrf: voters[1].csrf,
  });
  const withdraw = await tagVote(voters[3], 'hades-ii', 'horror', 'DELETE');
  const afterWithdraw = tagRow('hades-ii', 'horror');
  const sugNew = await api(BACK, '/community/tags/hades-ii/suggest', {
    method: 'POST',
    jar: voters[1].jar,
    csrf: voters[1].csrf,
    body: { name: `Verify Tag ${RUN}` },
  });
  const sugKnown = await api(BACK, '/community/tags/hades-ii/suggest', {
    method: 'POST',
    jar: voters[1].jar,
    csrf: voters[1].csrf,
    body: { name: 'Coop' },
  });
  const sugRow = psql(
    `SELECT status || '|' || source FROM tag_suggestions WHERE raw_name = ${lit(`Verify Tag ${RUN}`)};`,
  );
  const notInTaxonomy = Number(
    psql(`SELECT count(*) FROM tags WHERE name ILIKE ${lit(`Verify Tag ${RUN}`)};`),
  );
  const exp = await api(BACK, '/auth/export', { jar: voters[0].jar });
  const exported = (exp.json?.data?.tagVotes ?? exp.json?.tagVotes ?? []).some(
    (v) => v.game === 'hades-ii' && v.tag === 'horror',
  );
  check(
    "S3.10 reader rules: unverified 403, no CSRF 403, a non-taxonomy tag 404, a bad slug 400; a vote is withdrawable; a new tag NAME goes to the suggestion queue (pending, never live) while a known spelling points to the existing tag; the GDPR export carries the user's tag votes",
    unverified.status === 403 &&
      noCsrf.status === 403 &&
      unknownTag.status === 404 &&
      badSlug.status === 400 &&
      withdraw.status === 200 &&
      afterWithdraw?.count === 3 &&
      sugNew.json?.data?.status === 'queued' &&
      sugRow === 'pending|user' &&
      notInTaxonomy === 0 &&
      sugKnown.json?.data?.status === 'exists' &&
      sugKnown.json?.data?.tagSlug === 'co-op' &&
      exported,
    `unverified=${unverified.status} noCsrf=${noCsrf.status} unknown=${unknownTag.status} badSlug=${badSlug.status} withdraw=${withdraw.status}→votes ${afterWithdraw?.count} · suggest=${sugNew.json?.data?.status}/${sugRow} known→${sugKnown.json?.data?.tagSlug} · export=${exported}`,
  );

  // ── S3.11 RBAC + audit ─────────────────────────────────────────────────────
  const modQueue = await api(BACK, '/admin/api/tag-queue', { jar: mod.jar });
  const modSettings = await api(BACK, '/admin/api/tag-settings', {
    method: 'PATCH',
    jar: mod.jar,
    csrf: mod.csrf,
    body: { indexMinGames: 3 },
  });
  const modTaxonomy = await api(BACK, '/admin/api/tag-taxonomy', { jar: mod.jar });
  const readerQueue = await api(BACK, '/admin/api/tag-queue', { jar: voters[0].jar });
  // The admin UI's own path (bug-A lesson): frontend BFF + staff session + CSRF.
  const uiMod = await uiLogin('demo-moderator');
  const uiQueue = await uiApi(uiMod, '/admin/api/tag-queue');
  const cheaters = tagRow('stellar-drifter', 'cheaters');
  const uiReconfirm = await uiApi(
    uiMod,
    `/admin/api/tag-queue/${cheaters?.id}/reconfirm`,
    'POST',
    {},
  );
  const uiAdmin = await uiLogin('demo-admin');
  const tagCfg = (await adminApi('/tag-settings')).json?.data;
  const uiSettings = await uiApi(uiAdmin, '/admin/api/tag-settings', 'PATCH', {
    catalogCardCount: tagCfg?.catalogCardCount ?? 3,
  });
  const audits = psql(
    "SELECT string_agg(DISTINCT actor_label || ':' || entity_type, ',') FROM audit_logs WHERE entity_type IN ('game-tag', 'tag-suggestion') AND created_at > now() - interval '30 minutes';",
  );
  check(
    'S3.11 RBAC + audit: editors (moderator) read the queue and the taxonomy and act on tags; tag settings are admin-only (moderator 403); a reader 403; every editor action and suggestion is in the audit log; the queue + settings work through the admin UI path (BFF, session, CSRF)',
    modQueue.status === 200 &&
      modTaxonomy.status === 200 &&
      modSettings.status === 403 &&
      readerQueue.status === 403 &&
      uiQueue.status === 200 &&
      uiReconfirm.status === 200 &&
      uiSettings.status === 200 &&
      audits.includes('demo-moderator:game-tag') &&
      audits.includes('public: tag-suggestion:tag-suggestion'),
    `mod queue=${modQueue.status} taxonomy=${modTaxonomy.status} settings=${modSettings.status} · reader=${readerQueue.status} · UI path queue=${uiQueue.status} reconfirm=${uiReconfirm.status} settings=${uiSettings.status} · audit actors=${audits}`,
  );
}

async function restoreS3() {
  const stmts = [];
  for (const [g, t] of s3Restore.pairs) {
    stmts.push(
      `DELETE FROM game_tags WHERE game_id = (SELECT g.id FROM games g JOIN subjects s ON s.id = g.subject_id WHERE s.slug = ${lit(g)}) AND tag_id = (SELECT id FROM tags WHERE slug = ${lit(t)});`,
      `DELETE FROM game_tag_votes WHERE game_id = (SELECT g.id FROM games g JOIN subjects s ON s.id = g.subject_id WHERE s.slug = ${lit(g)}) AND tag_id = (SELECT id FROM tags WHERE slug = ${lit(t)});`,
    );
  }
  stmts.push(`DELETE FROM tag_suggestions WHERE raw_name = ${lit(`Verify Tag ${RUN}`)};`);
  if (s3Restore.reopenImport) {
    stmts.push(
      `UPDATE game_tags SET state = ${lit(s3Restore.reopenImport.state)} WHERE id = ${lit(s3Restore.reopenImport.id)};`,
    );
  }
  if (s3Restore.predatoryWas === 'false' || s3Restore.predatoryWas === 'true') {
    stmts.push(
      `UPDATE game_content_flags SET predatory_monetization = ${s3Restore.predatoryWas} WHERE game_id = (SELECT g.id FROM games g JOIN subjects s ON s.id = g.subject_id WHERE s.slug = 'stellar-drifter');`,
    );
  }
  if (stmts.length) {
    psql(
      `BEGIN;\n${auditSql({ action: 'delete', entityType: 'verify-run', entityId: `verify-run-${RUN}`, changes: { statements: stmts.length }, summary: `verify cleanup removed run ${RUN}'s tag fixtures` })}\n${stmts.join('\n')}\nCOMMIT;`,
    );
  }
  if (s3Restore.section)
    await adminApi('/homepage/sections/by_players', 'PATCH', s3Restore.section);
  if (s3Restore.settings) restoreSettings(s3Restore.settings);
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
    await s2Fixes();
    await s3();
  } finally {
    await restoreS3();
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
