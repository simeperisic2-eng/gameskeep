'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type { BriefingOverrideConfig, RuleLeaf, RulesConfig, RuleTree } from '../lib';

/**
 * Rules & limits (Phase P S3b) — every product behaviour that used to be a
 * constant in code. Defaults are exactly the previous behaviour; each save
 * writes only what changed and is audited old → new per rule. Homepage rules
 * recompute the stored sections in the background.
 */
const GROUPS: { key: string; title: string; sub: string }[] = [
  { key: 'homepage', title: 'Homepage', sub: 'How the homepage sections are assembled.' },
  { key: 'clustering', title: 'Clustering', sub: 'Story status from the clustering engine.' },
  { key: 'display', title: 'Display', sub: 'Filters, evidence and excerpt lengths.' },
  { key: 'sources', title: 'Sources', sub: 'Source data rules.' },
  { key: 'community', title: 'Community', sub: 'Reader feed.' },
  { key: 'upcoming', title: '/upcoming', sub: 'Ordering of the upcoming slate.' },
  { key: 'lists', title: 'List sizes', sub: 'How many items each list shows.' },
];

const LABELS: Record<string, string> = {
  'homepage.topRatedExcludeFocus': 'Top rated skips the first N “Games in focus” (0 = off)',
  'homepage.latestExcludesTrending': 'Latest skips stories already in Trending',
  'homepage.heroRotateMinutes': 'Trending spotlight rotates every N minutes (0 = never)',
  'homepage.heroSecondaryCount': 'Stacked story cards under the spotlight',
  'homepage.latestInitial': 'Latest shows N cards before “Load more”',
  'homepage.coverageRows': 'Outlet headlines per Trending story (“How it’s being covered”)',
  'homepage.ourPicksManualOnly': 'Our picks takes editors’ pins only',
  'clustering.ongoingAt': 'A story reads “ongoing” from this many articles',
  'display.qualityFilterMin': '“Top quality only” filter: quality at or above',
  'display.integritySnippetMax': 'Review-integrity evidence snippets clipped to (characters)',
  'display.excerpt.coverageRow': 'Excerpt · story coverage rows',
  'display.excerpt.spotlight': 'Excerpt · Trending spotlight summary',
  'display.excerpt.gameArticle': 'Excerpt · game page coverage',
  'display.excerpt.sourcePage': 'Excerpt · source page coverage',
  'display.excerpt.feed': 'Excerpt · Your Feed',
  'display.excerpt.latest': 'Excerpt · Latest news rail',
  'display.excerpt.topicSummary': 'Excerpt · story page AI summary',
  'display.excerpt.metaDescription': 'Excerpt · search-result description (story / game)',
  'sources.parentBlocksStandalone': 'A source with a parent company can’t be typed “Standalone”',
  'community.feedLimit': 'Items in a reader’s feed',
  'upcoming.featuredFirst': 'Editor-featured games float to the front',
  'upcoming.paidPositions':
    'Paid game positions (comma-separated, e.g. 1, 4) — empty = paid games lead',
  'lists.topicRelatedStories': 'Story page · related stories',
  'lists.gameRelatedStories': 'Game page · related stories',
  'lists.gameRelatedGames': 'Game page · related games',
  'lists.gameVideos': 'Game page · videos',
  'lists.sourceRecentCoverage': 'Source page · recent coverage',
  'lists.sourceTopGames': 'Source page · most-covered games',
  'lists.discoveryTopRated': '/games · top rated',
  'lists.discoveryMostDiscussed': '/games · most discussed',
  'lists.discoveryComingSoon': '/games · coming soon',
  'lists.whyReasons': 'Why-it’s-ranked reasons per item',
};

const isTree = (v: unknown): v is RuleTree =>
  Boolean(v) && typeof v === 'object' && !Array.isArray(v);

function leaves(tree: RuleTree, prefix = ''): [string, RuleLeaf][] {
  return Object.entries(tree).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return isTree(v) ? leaves(v, path) : [[path, v] as [string, RuleLeaf]];
  });
}

function getAt(tree: RuleTree, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (isTree(o) ? o[k] : undefined), tree);
}

/** A deep patch holding only `path` = value. */
function patchOf(path: string, value: RuleLeaf): RuleTree {
  const keys = path.split('.');
  const out: RuleTree = {};
  let at = out;
  keys.forEach((k, i) => {
    if (i === keys.length - 1) at[k] = value;
    else {
      const next: RuleTree = {};
      at[k] = next;
      at = next;
    }
  });
  return out;
}

function mergeInto(a: RuleTree, b: RuleTree): RuleTree {
  const out: RuleTree = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = isTree(v) && isTree(out[k]) ? mergeInto(out[k] as RuleTree, v) : v;
  }
  return out;
}

const todayUtc = (): string => new Date().toISOString().slice(0, 10);

export function RulesManager({
  initial,
  briefing,
}: {
  initial: RulesConfig;
  briefing: BriefingOverrideConfig;
}): React.JSX.Element {
  const [saved, setSaved] = useState<RuleTree>(initial.settings);
  // Draft values as typed (numbers as strings so a field can be emptied mid-edit).
  const [draft, setDraft] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(
      leaves(initial.settings).map(([p, v]) => [
        p,
        typeof v === 'boolean' ? v : Array.isArray(v) ? v.join(', ') : String(v),
      ]),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [brief, setBrief] = useState<BriefingOverrideConfig>({
    date: briefing.date ?? todayUtc(),
    text: briefing.text,
    hidden: briefing.hidden,
  });
  const [briefMsg, setBriefMsg] = useState<string | null>(null);

  function parsed(path: string): RuleLeaf | { error: string } {
    const def = getAt(initial.defaults, path);
    const raw = draft[path];
    if (typeof def === 'boolean') return Boolean(raw);
    if (Array.isArray(def)) {
      const parts = String(raw ?? '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const nums = parts.map(Number);
      if (nums.some((n) => !Number.isInteger(n) || n < 1 || n > 50)) {
        return { error: `${LABELS[path] ?? path}: whole numbers from 1 to 50` };
      }
      return nums;
    }
    const n = Number(raw);
    const [min, max] = initial.bounds[path] ?? [0, Number.MAX_SAFE_INTEGER];
    if (String(raw ?? '').trim() === '' || !Number.isInteger(n) || n < min || n > max) {
      return { error: `${LABELS[path] ?? path}: a whole number from ${min} to ${max}` };
    }
    return n;
  }

  async function save(): Promise<void> {
    setMsg(null);
    let patch: RuleTree = {};
    const errors: string[] = [];
    for (const [path, current] of leaves(saved)) {
      const next = parsed(path);
      if (typeof next === 'object' && !Array.isArray(next)) {
        errors.push(next.error);
        continue;
      }
      if (JSON.stringify(next) !== JSON.stringify(current)) {
        patch = mergeInto(patch, patchOf(path, next));
      }
    }
    if (errors.length) {
      setMsg(errors.join(' · '));
      return;
    }
    if (Object.keys(patch).length === 0) {
      setMsg('Nothing changed.');
      return;
    }
    setBusy(true);
    try {
      const res = await adminFetch('/admin/api/rules', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: RuleTree;
        changed?: string[];
        recomputeJobId?: string | null;
        message?: string;
      };
      if (res.ok && body.data) {
        setSaved(body.data);
        setMsg(
          `Saved ${body.changed?.length ?? 0} rule(s).${
            body.recomputeJobId ? ` Homepage recompute queued (job ${body.recomputeJobId}).` : ''
          }`,
        );
      } else {
        setMsg(`Save failed: ${body.message ?? res.status}`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveBriefing(clear: boolean): Promise<void> {
    setBriefMsg(null);
    const res = await adminFetch('/admin/api/rules/briefing', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        clear
          ? { date: null }
          : { date: brief.date, text: brief.text?.trim() || null, hidden: brief.hidden },
      ),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: BriefingOverrideConfig;
      message?: string;
    };
    if (res.ok && body.data) {
      setBrief({ ...body.data, date: body.data.date ?? todayUtc() });
      setBriefMsg(clear ? 'Override cleared.' : `Saved for ${body.data.date}.`);
    } else {
      setBriefMsg(`Save failed: ${body.message ?? res.status}`);
    }
  }

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Rules &amp; limits</h1>
        <p className="gk-cp-page-sub">
          Product behaviour that used to be fixed in code. Defaults are the previous behaviour;
          every change is audited. Paid labels, payment never changing data, GDPR / age / DSA rules
          and the three editorial guards are not settings.
        </p>
      </header>

      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}

      {GROUPS.map((g) => {
        const tree = saved[g.key];
        if (!isTree(tree)) return null;
        return (
          <section key={g.key} className="gk-cp-card" data-rules-group={g.key}>
            <h2 className="gk-cp-card-title">{g.title}</h2>
            <p className="gk-cp-dim">{g.sub}</p>
            <div className="gk-nl-form">
              {leaves(tree, g.key).map(([path]) => {
                const def = getAt(initial.defaults, path);
                const value = draft[path];
                const label = LABELS[path] ?? path;
                if (typeof def === 'boolean') {
                  return (
                    <label key={path} className="gk-nl-check gk-nl-field-wide">
                      <input
                        type="checkbox"
                        name={path}
                        checked={Boolean(value)}
                        onChange={(e) => setDraft((d) => ({ ...d, [path]: e.target.checked }))}
                      />
                      <span>
                        {label} <span className="gk-cp-dim">· default {def ? 'on' : 'off'}</span>
                      </span>
                    </label>
                  );
                }
                const bounds = initial.bounds[path];
                return (
                  <label key={path} className="gk-nl-field">
                    <span>
                      {label}{' '}
                      <span className="gk-cp-dim">
                        · default {Array.isArray(def) ? def.join(', ') || 'none' : String(def)}
                        {bounds ? ` · ${bounds[0]}–${bounds[1]}` : ''}
                      </span>
                    </span>
                    <input
                      name={path}
                      inputMode={Array.isArray(def) ? 'text' : 'numeric'}
                      value={String(value ?? '')}
                      onChange={(e) => setDraft((d) => ({ ...d, [path]: e.target.value }))}
                    />
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}

      <div className="gk-nl-actions">
        <button type="button" className="gk-cp-btn is-primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save rules'}
        </button>
      </div>

      <section className="gk-cp-card" data-briefing-override>
        <h2 className="gk-cp-card-title">Briefing override (one day)</h2>
        <p className="gk-cp-dim">
          For one UTC day, replace the homepage briefing counts with your own line, or hide the
          briefing. It lapses by itself the next day.
        </p>
        {briefMsg && <div className="gk-cp-note">{briefMsg}</div>}
        <div className="gk-nl-form">
          <label className="gk-nl-field">
            <span>Day (UTC)</span>
            <input
              type="date"
              value={brief.date ?? ''}
              onChange={(e) => setBrief((b) => ({ ...b, date: e.target.value }))}
            />
          </label>
          <label className="gk-nl-field gk-nl-field-wide">
            <span>
              Text instead of the counts <span className="gk-cp-dim">· up to 300 characters</span>
            </span>
            <input
              maxLength={300}
              value={brief.text ?? ''}
              onChange={(e) => setBrief((b) => ({ ...b, text: e.target.value }))}
            />
          </label>
          <label className="gk-nl-check gk-nl-field-wide">
            <input
              type="checkbox"
              checked={brief.hidden}
              onChange={(e) => setBrief((b) => ({ ...b, hidden: e.target.checked }))}
            />
            <span>Hide the briefing that day</span>
          </label>
        </div>
        <div className="gk-nl-actions">
          <button
            type="button"
            className="gk-cp-btn is-primary"
            onClick={() => saveBriefing(false)}
          >
            Save override
          </button>
          <button type="button" className="gk-cp-btn" onClick={() => saveBriefing(true)}>
            Clear
          </button>
        </div>
      </section>
    </div>
  );
}
