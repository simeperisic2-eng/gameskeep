'use client';

import { useState } from 'react';
import { adminFetch } from '../_lib/adminFetch';
import type {
  HomepageConfig,
  HomepagePreview,
  HomepageRuleDimension,
  HomepageSectionConfig,
  HomepageSettingsConfig,
} from '../lib';

/**
 * Homepage sections (Phase P S2). Order, enable, mode, item count, Δ window,
 * card tags, feed rules, pins, minimum items and PAID placements. Owner decision
 * B: any section with a list can carry paid items (games or stories) at the
 * positions set here. Two things never change: every paid item renders its label
 * ("Promoted" for a game, "Sponsored" for a story), and a paid item is INSERTED —
 * the organic list and everyone's numbers stay exactly as computed. Every save is
 * audited and refreshes the stored snapshots (the homepage reads only those).
 */
type Draft = Pick<
  HomepageSectionConfig,
  | 'title'
  | 'enabled'
  | 'mode'
  | 'itemCount'
  | 'deltaWindowHours'
  | 'cardTagFamilies'
  | 'cardTagCount'
  | 'minItems'
> & { paidPositions: string; include: Record<string, string>; exclude: Record<string, string> };

// The section kind is an informational label only (owner decision B).
const KIND_HINT: Record<HomepageSectionConfig['kind'], string> = {
  data: 'data',
  discovery: 'discovery',
  block: 'block',
};
const MODE_LABEL = { auto: 'Auto', manual: 'Manual (pins only)', pins_auto: 'Pins + auto' };

const listText = (v: string[] | undefined): string => (v ?? []).join(', ');
const textList = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const when = (v: string | null): string =>
  v
    ? new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC',
      }).format(new Date(v)) + ' UTC'
    : 'not computed yet';

async function send(
  path: string,
  method: string,
  body?: unknown,
): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const res = await adminFetch(path, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  // An empty / non-JSON error body still says WHICH failure it was.
  if (!res.ok && !json.message && !json.issues) json.message = `HTTP ${res.status}`;
  return { ok: res.ok, json };
}
const errorOf = (j: Record<string, unknown>): string => {
  if (typeof j.message === 'string') return j.message;
  const issues = j.issues as { message?: string }[] | undefined;
  return issues?.map((i) => i.message).join('; ') || 'request failed';
};

function draftOf(s: HomepageSectionConfig): Draft {
  const side = (r: Partial<Record<HomepageRuleDimension, string[]>>): Record<string, string> =>
    Object.fromEntries(s.ruleDimensions.map((d) => [d, listText(r[d])]));
  return {
    title: s.title,
    enabled: s.enabled,
    mode: s.mode,
    itemCount: s.itemCount,
    deltaWindowHours: s.deltaWindowHours,
    cardTagFamilies: s.cardTagFamilies,
    cardTagCount: s.cardTagCount,
    minItems: s.minItems,
    paidPositions: s.paidPositions.join(', '),
    include: side(s.rules.include),
    exclude: side(s.rules.exclude),
  };
}

function SectionEditor({
  section,
  onSaved,
  flash,
}: {
  section: HomepageSectionConfig;
  onSaved: () => void;
  flash: (m: string) => void;
}): React.JSX.Element {
  const [d, setD] = useState<Draft>(draftOf(section));
  const [pins, setPins] = useState(
    section.pins.map((p) => ({
      position: p.position,
      kind: p.topicSlug ? 'story' : 'game',
      slug: p.topicSlug ?? p.gameSlug ?? '',
      name: p.name,
    })),
  );
  const [promo, setPromo] = useState({
    advertiserName: '',
    kind: section.items === 'topic' ? 'story' : 'game',
    slug: '',
    startsAt: '',
    endsAt: '',
  });
  const [busy, setBusy] = useState(false);
  const isBlock = section.kind === 'block';
  const canPin = !isBlock;

  async function save(): Promise<void> {
    setBusy(true);
    const rules = {
      include: Object.fromEntries(Object.entries(d.include).map(([k, v]) => [k, textList(v)])),
      exclude: Object.fromEntries(Object.entries(d.exclude).map(([k, v]) => [k, textList(v)])),
    };
    const body: Record<string, unknown> = { title: d.title, enabled: d.enabled };
    if (!isBlock) {
      body.mode = d.mode;
      body.itemCount = d.itemCount;
      body.cardTagFamilies = d.cardTagFamilies;
      body.cardTagCount = d.cardTagCount;
      if (section.ruleDimensions.length) body.rules = rules;
    } else if (section.key === 'genres') body.itemCount = d.itemCount;
    if (section.delta) body.deltaWindowHours = d.deltaWindowHours;
    if (!isBlock) {
      const positions = textList(d.paidPositions).map(Number);
      if (positions.some((n) => !Number.isInteger(n) || n < 1 || n > 24)) {
        setBusy(false);
        flash('Save failed: paid positions are whole numbers from 1 to 24, comma-separated.');
        return;
      }
      body.paidPositions = positions;
      body.minItems = d.minItems;
    }
    const r = await send(`/admin/api/homepage/sections/${section.key}`, 'PATCH', body);
    setBusy(false);
    flash(
      r.ok
        ? `Saved "${d.title}" — the homepage refreshes in a moment.`
        : `Save failed: ${errorOf(r.json)}`,
    );
    if (r.ok) onSaved();
  }

  async function savePins(): Promise<void> {
    setBusy(true);
    const body = {
      pins: pins
        .filter((p) => p.slug.trim())
        .map((p) =>
          p.kind === 'story'
            ? { position: p.position, topicSlug: p.slug.trim() }
            : { position: p.position, gameSlug: p.slug.trim() },
        ),
    };
    const r = await send(`/admin/api/homepage/sections/${section.key}/pins`, 'PUT', body);
    setBusy(false);
    flash(r.ok ? 'Pins saved.' : `Pins not saved: ${errorOf(r.json)}`);
    if (r.ok) onSaved();
  }

  async function createPromotion(): Promise<void> {
    setBusy(true);
    const body: Record<string, unknown> = { advertiserName: promo.advertiserName };
    if (promo.kind === 'story') body.topicSlug = promo.slug.trim();
    else body.gameSlug = promo.slug.trim();
    if (promo.startsAt) body.startsAt = promo.startsAt;
    if (promo.endsAt) body.endsAt = promo.endsAt;
    const r = await send(`/admin/api/homepage/sections/${section.key}/promotions`, 'POST', body);
    setBusy(false);
    flash(
      r.ok
        ? 'Promotion created as a draft — activate it after payment.'
        : `Not created: ${errorOf(r.json)}`,
    );
    if (r.ok) onSaved();
  }

  async function setStatus(id: string, status: string): Promise<void> {
    setBusy(true);
    const r = await send(`/admin/api/ads/placements/${id}/status`, 'POST', { status });
    setBusy(false);
    flash(r.ok ? `Placement → ${status}.` : `Status not changed: ${errorOf(r.json)}`);
    if (r.ok) onSaved();
  }

  return (
    <div className="gk-hp-editor">
      <div className="gk-nl-form">
        <label className="gk-nl-field">
          <span>
            Title <span className="gk-cp-dim">· default “{section.defaultTitle}”</span>
          </span>
          <input
            value={d.title}
            maxLength={80}
            onChange={(e) => setD({ ...d, title: e.target.value })}
          />
        </label>
        <label className="gk-nl-check">
          <input
            type="checkbox"
            checked={d.enabled}
            onChange={(e) => setD({ ...d, enabled: e.target.checked })}
          />
          <span>Shown on the homepage</span>
        </label>
        {!isBlock && (
          <label className="gk-nl-field">
            <span>Mode</span>
            <select
              value={d.mode}
              disabled={section.key === 'our_picks'}
              onChange={(e) => setD({ ...d, mode: e.target.value as Draft['mode'] })}
            >
              {(Object.keys(MODE_LABEL) as Draft['mode'][]).map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
        )}
        {(!isBlock || section.key === 'genres') && (
          <label className="gk-nl-field">
            <span>Items</span>
            <input
              type="number"
              min={1}
              max={24}
              value={String(d.itemCount)}
              onChange={(e) => setD({ ...d, itemCount: Number(e.target.value) })}
            />
          </label>
        )}
        {section.delta && (
          <label className="gk-nl-field">
            <span>
              Δ window (hours) <span className="gk-cp-dim">· shown on the card, e.g. 48h / 7d</span>
            </span>
            <input
              type="number"
              min={1}
              max={2160}
              value={String(d.deltaWindowHours ?? '')}
              onChange={(e) => setD({ ...d, deltaWindowHours: Number(e.target.value) || null })}
            />
          </label>
        )}
        {!isBlock && (
          <>
            <label className="gk-nl-field">
              <span>
                Card tag families{' '}
                <span className="gk-cp-dim">· comma-separated (rendered once tags exist, S3)</span>
              </span>
              <input
                value={listText(d.cardTagFamilies)}
                onChange={(e) => setD({ ...d, cardTagFamilies: textList(e.target.value) })}
              />
            </label>
            <label className="gk-nl-field">
              <span>Tags per card</span>
              <input
                type="number"
                min={0}
                max={10}
                value={String(d.cardTagCount)}
                onChange={(e) => setD({ ...d, cardTagCount: Number(e.target.value) })}
              />
            </label>
          </>
        )}
        {!isBlock && (
          <>
            <label className="gk-nl-field">
              <span>
                Paid positions{' '}
                <span className="gk-cp-dim">
                  · comma-separated, e.g. 2, 6 · empty = no paid items · first booked fills the
                  first position
                </span>
              </span>
              <input
                value={d.paidPositions}
                onChange={(e) => setD({ ...d, paidPositions: e.target.value })}
              />
            </label>
            <label className="gk-nl-field">
              <span>
                Minimum items <span className="gk-cp-dim">· fewer qualify → section hidden</span>
              </span>
              <input
                type="number"
                min={1}
                max={24}
                value={d.minItems == null ? '' : String(d.minItems)}
                onChange={(e) =>
                  setD({ ...d, minItems: e.target.value ? Number(e.target.value) : null })
                }
              />
            </label>
          </>
        )}
        {section.ruleDimensions.map((dim) => (
          <div key={dim} className="gk-hp-rule">
            <label className="gk-nl-field">
              <span>
                Include {dim} <span className="gk-cp-dim">· any of (comma-separated)</span>
              </span>
              <input
                value={d.include[dim] ?? ''}
                onChange={(e) => setD({ ...d, include: { ...d.include, [dim]: e.target.value } })}
              />
            </label>
            <label className="gk-nl-field">
              <span>Exclude {dim}</span>
              <input
                value={d.exclude[dim] ?? ''}
                onChange={(e) => setD({ ...d, exclude: { ...d.exclude, [dim]: e.target.value } })}
              />
            </label>
          </div>
        ))}
        <div className="gk-nl-actions">
          <button className="gk-cp-btn is-primary" type="button" disabled={busy} onClick={save}>
            Save section
          </button>
        </div>
      </div>

      {canPin && (
        <div className="gk-hp-sub">
          <h3 className="gk-lists-preview-h">
            Pins · each holds its position; auto fills the rest
          </h3>
          {pins.map((p, i) => (
            <div key={i} className="gk-hp-pin">
              <input
                type="number"
                min={1}
                max={24}
                aria-label="Position"
                value={String(p.position)}
                onChange={(e) =>
                  setPins(
                    pins.map((x, j) => (j === i ? { ...x, position: Number(e.target.value) } : x)),
                  )
                }
              />
              {section.items === 'mixed' ? (
                <select
                  aria-label="Item type"
                  value={p.kind}
                  onChange={(e) =>
                    setPins(pins.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))
                  }
                >
                  <option value="game">game</option>
                  <option value="story">story</option>
                </select>
              ) : (
                <span className="gk-cp-dim">{section.items === 'topic' ? 'story' : 'game'}</span>
              )}
              <input
                aria-label="Slug"
                placeholder="slug"
                value={p.slug}
                onChange={(e) =>
                  setPins(pins.map((x, j) => (j === i ? { ...x, slug: e.target.value } : x)))
                }
              />
              {p.name === null && p.slug ? <span className="gk-cp-dim">not found</span> : null}
              <button
                className="gk-cp-btn is-small"
                type="button"
                onClick={() => setPins(pins.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          ))}
          <div className="gk-nl-actions">
            <button
              className="gk-cp-btn is-small"
              type="button"
              onClick={() =>
                setPins([
                  ...pins,
                  {
                    position: pins.length + 1,
                    kind: section.items === 'topic' ? 'story' : 'game',
                    slug: '',
                    name: '',
                  },
                ])
              }
            >
              Add pin
            </button>
            <button
              className="gk-cp-btn is-primary"
              type="button"
              disabled={busy}
              onClick={savePins}
            >
              Save pins
            </button>
          </div>
        </div>
      )}

      {!isBlock && (
        <div className="gk-hp-sub">
          <h3 className="gk-lists-preview-h">
            Paid placements · always labeled (game “Promoted”, story “Sponsored”) · inserted at the
            paid positions, never changing the organic list
          </h3>
          {section.promotions.length === 0 ? (
            <p className="gk-cp-dim">None yet.</p>
          ) : (
            <table className="gk-cp-table">
              <tbody>
                {section.promotions.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <b>{p.advertiser}</b>
                      <span className="gk-cp-dim">
                        {' · '}
                        {p.topicSlug
                          ? `story ${p.topicTitle ?? p.topicSlug}`
                          : `game ${p.gameName ?? p.gameSlug ?? '—'}`}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`gk-adstate is-${p.status === 'active' ? 'active' : 'free'}`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td>
                      {p.status === 'active' ? (
                        <button
                          className="gk-cp-btn is-small"
                          type="button"
                          disabled={busy}
                          onClick={() => setStatus(p.id, 'ended')}
                        >
                          End
                        </button>
                      ) : (
                        <button
                          className="gk-cp-btn is-small"
                          type="button"
                          disabled={busy}
                          onClick={() => setStatus(p.id, 'active')}
                        >
                          Activate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="gk-nl-form">
            <label className="gk-nl-field">
              <span>Advertiser</span>
              <input
                value={promo.advertiserName}
                onChange={(e) => setPromo({ ...promo, advertiserName: e.target.value })}
              />
            </label>
            <label className="gk-nl-field">
              <span>Promotes</span>
              <select
                value={promo.kind}
                onChange={(e) => setPromo({ ...promo, kind: e.target.value })}
              >
                <option value="game">a game (“Promoted”)</option>
                <option value="story">a story (“Sponsored”)</option>
              </select>
            </label>
            <label className="gk-nl-field">
              <span>{promo.kind === 'story' ? 'Story slug' : 'Game slug'}</span>
              <input
                value={promo.slug}
                onChange={(e) => setPromo({ ...promo, slug: e.target.value })}
              />
            </label>
            <label className="gk-nl-field">
              <span>Starts (optional)</span>
              <input
                type="date"
                value={promo.startsAt}
                onChange={(e) => setPromo({ ...promo, startsAt: e.target.value })}
              />
            </label>
            <label className="gk-nl-field">
              <span>Ends (optional)</span>
              <input
                type="date"
                value={promo.endsAt}
                onChange={(e) => setPromo({ ...promo, endsAt: e.target.value })}
              />
            </label>
            <div className="gk-nl-actions">
              <button className="gk-cp-btn" type="button" disabled={busy} onClick={createPromotion}>
                Create draft placement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SettingsCard({
  initial,
  flash,
}: {
  initial: HomepageSettingsConfig;
  flash: (m: string) => void;
}): React.JSX.Element {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const num = (v: string): number => Number(v);
  async function save(): Promise<void> {
    setBusy(true);
    const r = await send('/admin/api/homepage/settings', 'PATCH', s);
    setBusy(false);
    if (r.ok) setS(r.json.data as HomepageSettingsConfig);
    flash(r.ok ? 'Settings saved.' : `Settings not saved: ${errorOf(r.json)}`);
  }
  const W = ({
    k,
    label,
  }: {
    k: keyof HomepageSettingsConfig['trendingWeights'];
    label: string;
  }): React.JSX.Element => (
    <label className="gk-nl-field">
      <span>{label}</span>
      <input
        type="number"
        step="0.1"
        min={0}
        max={10}
        value={String(s.trendingWeights[k])}
        onChange={(e) =>
          setS({ ...s, trendingWeights: { ...s.trendingWeights, [k]: num(e.target.value) } })
        }
      />
    </label>
  );
  return (
    <section className="gk-cp-card">
      <h2 className="gk-cp-card-title">Ranking &amp; display switches</h2>
      <p className="gk-cp-dim">
        Trending score = articles × w + outlets × w + comments × w + follows × w in the window.
        Comments and follows count with each account’s credibility (0 → 1.0, the community-rating
        curve), only from accounts at or above the credibility floor, at most “per-account cap”
        units per story, and never more than the story’s own coverage × the engagement cap — a ring
        of new accounts cannot lift a quiet story into Trending.
      </p>
      <div className="gk-nl-form">
        <W k="articles" label="Weight · articles" />
        <W k="sources" label="Weight · outlets" />
        <W k="comments" label="Weight · comments (credibility-weighted)" />
        <W k="follows" label="Weight · follows (credibility-weighted)" />
        <label className="gk-nl-field">
          <span>Per-account cap (units per signal per story)</span>
          <input
            type="number"
            min={1}
            max={10}
            value={String(s.perUserCap)}
            onChange={(e) => setS({ ...s, perUserCap: num(e.target.value) })}
          />
        </label>
        <label className="gk-nl-field">
          <span>
            Min. credibility that counts{' '}
            <span className="gk-cp-dim">· 0–1; a verified email alone is 0.45</span>
          </span>
          <input
            type="number"
            step="0.05"
            min={0}
            max={1}
            value={String(s.minCredibility)}
            onChange={(e) => setS({ ...s, minCredibility: num(e.target.value) })}
          />
        </label>
        <label className="gk-nl-field">
          <span>
            Engagement cap{' '}
            <span className="gk-cp-dim">· × the story’s coverage score (0 = coverage only)</span>
          </span>
          <input
            type="number"
            step="0.1"
            min={0}
            max={5}
            value={String(s.maxEngagementShare)}
            onChange={(e) => setS({ ...s, maxEngagementShare: num(e.target.value) })}
          />
        </label>
        <label className="gk-nl-field">
          <span>
            By players · min samples per window <span className="gk-cp-dim">· fewer → “—”</span>
          </span>
          <input
            type="number"
            min={1}
            max={50}
            value={String(s.deltaMinPoints)}
            onChange={(e) => setS({ ...s, deltaMinPoints: num(e.target.value) })}
          />
        </label>
        <label className="gk-nl-field">
          <span>Snapshot refresh (minutes)</span>
          <input
            type="number"
            min={5}
            max={1440}
            value={String(s.refreshMinutes)}
            onChange={(e) => setS({ ...s, refreshMinutes: num(e.target.value) })}
          />
        </label>
        <label className="gk-nl-field">
          <span>
            Steam sampling (hours) <span className="gk-cp-dim">· production sweep cadence</span>
          </span>
          <input
            type="number"
            min={1}
            max={168}
            value={String(s.steamSampleEveryHours)}
            onChange={(e) => setS({ ...s, steamSampleEveryHours: num(e.target.value) })}
          />
        </label>
        <label className="gk-nl-check gk-nl-field-wide">
          <input
            type="checkbox"
            checked={s.showUnsoldPlaceholder}
            onChange={(e) => setS({ ...s, showUnsoldPlaceholder: e.target.checked })}
          />
          <span>
            Show the “AD” placeholder in unsold slots{' '}
            <span className="gk-cp-dim">· off = an unsold slot renders nothing</span>
          </span>
        </label>
        <div className="gk-nl-actions">
          <button className="gk-cp-btn is-primary" type="button" disabled={busy} onClick={save}>
            Save switches
          </button>
        </div>
      </div>
    </section>
  );
}

export function HomepageManager({
  initial,
  preview,
}: {
  initial: HomepageConfig;
  preview: HomepagePreview;
}): React.JSX.Element {
  const [sections, setSections] = useState(initial.sections);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const orderChanged =
    sections.map((s) => s.key).join(',') !== initial.sections.map((s) => s.key).join(',');

  const move = (i: number, by: number): void => {
    const j = i + by;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setSections(next);
  };
  const reload = (): void => window.location.reload();

  async function saveOrder(): Promise<void> {
    setBusy(true);
    const r = await send('/admin/api/homepage/order', 'PUT', { keys: sections.map((s) => s.key) });
    setBusy(false);
    setMsg(
      r.ok
        ? 'Order saved — the homepage refreshes in a moment.'
        : `Order not saved: ${errorOf(r.json)}`,
    );
  }
  async function recompute(): Promise<void> {
    setBusy(true);
    const r = await send('/admin/api/homepage/recompute', 'POST');
    setBusy(false);
    setMsg(r.ok ? 'Refresh queued.' : `Refresh failed: ${errorOf(r.json)}`);
  }

  return (
    <div className="gk-cp-page">
      <header className="gk-cp-page-head">
        <h1 className="gk-cp-page-title">Homepage</h1>
        <p className="gk-cp-page-sub">
          Sections, their order and what lands in each. Rankings and Δ values are computed in the
          background and stored — last computed {when(initial.lastComputedAt)}.{' '}
          <button className="gk-cp-btn is-small" type="button" disabled={busy} onClick={recompute}>
            Refresh now
          </button>
        </p>
      </header>

      {msg && <div className="gk-cp-note gk-cp-flash">{msg}</div>}

      <section className="gk-cp-card">
        <div className="gk-cp-card-head">
          <h2 className="gk-cp-card-title">Sections · page order</h2>
          <button
            className="gk-cp-btn is-primary"
            type="button"
            disabled={busy || !orderChanged}
            onClick={saveOrder}
          >
            Save order
          </button>
        </div>
        <ol className="gk-hp-list">
          {sections.map((s, i) => (
            <li key={s.key} className="gk-hp-row">
              <div className="gk-hp-row-head">
                <span className="gk-hp-move">
                  <button
                    className="gk-cp-btn is-small"
                    type="button"
                    aria-label={`Move ${s.title} up`}
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </button>
                  <button
                    className="gk-cp-btn is-small"
                    type="button"
                    aria-label={`Move ${s.title} down`}
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </button>
                </span>
                <b>{s.title}</b>
                <span className="gk-cp-dim">
                  {s.key} · {KIND_HINT[s.kind]}
                  {s.enabled ? '' : ' · hidden'}
                </span>
                <button
                  className="gk-cp-btn is-small"
                  type="button"
                  onClick={() => setOpen(open === s.key ? null : s.key)}
                >
                  {open === s.key ? 'Close' : 'Edit'}
                </button>
              </div>
              {open === s.key && <SectionEditor section={s} onSaved={reload} flash={setMsg} />}
            </li>
          ))}
        </ol>
      </section>

      <SettingsCard initial={initial.settings} flash={setMsg} />

      <section className="gk-cp-card">
        <h2 className="gk-cp-card-title">What the homepage shows now</h2>
        <div className="gk-lists-preview">
          {preview.sections
            .filter((sec) => sec.items.length > 0)
            .map((sec) => (
              <div key={sec.key}>
                <h3 className="gk-lists-preview-h">
                  {sec.title} ({sec.items.length})
                  {sec.windowHours ? ` · Δ ${sec.windowHours}h` : ''}
                </h3>
                <ol className="gk-lists-preview-list">
                  {sec.items.map((it, n) => (
                    <li key={n}>
                      {it.label}
                      {it.pinned ? <span className="gk-lists-pin">pinned</span> : null}
                      {it.promoted ? <span className="gk-lists-pin">{it.promoted}</span> : null}
                      {it.delta ? <span className="gk-cp-dim"> {it.delta}</span> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
