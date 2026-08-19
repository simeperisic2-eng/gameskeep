'use client';

import { useState } from 'react';
import type { AdminGameRating, RatingStatus, VoteWeightView } from '../lib';
import { adminFetch } from '../_lib/adminFetch';

interface Props {
  status: RatingStatus;
  games: AdminGameRating[];
}

async function call(
  path: string,
  method: 'POST' | 'PATCH',
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await adminFetch(`/admin/api/${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: unknown = await res.json().catch(() => ({}));
    const data = (json ?? {}) as { message?: string };
    if (!res.ok) return { ok: false, message: data.message ?? `HTTP ${res.status}` };
    return { ok: true, message: '✓ done — recompute runs in the background, refresh shortly' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

const reloadSoon = (): void => void setTimeout(() => window.location.reload(), 1200);
const fmt = (n: number | null): string => (n == null ? '—' : String(n));

export default function RatingsManager({ status, games }: Props) {
  const [settings, setSettings] = useState(status.settings);
  const [selectedId, setSelectedId] = useState(games[0]?.gameId ?? '');
  const [ovCritics, setOvCritics] = useState('');
  const [ovCommunity, setOvCommunity] = useState('');
  const [ovReason, setOvReason] = useState('');
  const [tag, setTag] = useState('');
  const [votes, setVotes] = useState<VoteWeightView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const selected = games.find((g) => g.gameId === selectedId);

  async function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setMsg(r.message);
    setBusy(false);
    if (r.ok) reloadSoon();
  }

  function setParam(group: 'credibility' | 'burst' | 'disconnect', key: string, value: string) {
    setSettings((s) => ({ ...s, [group]: { ...s[group], [key]: Number(value) } }));
  }

  async function loadVotes(gameId: string) {
    setVotes(null);
    const res = await adminFetch(`/admin/api/ratings/game/${gameId}/votes`);
    const json = (await res.json().catch(() => ({}))) as {
      data?: { votes: VoteWeightView[] };
    };
    setVotes(json.data?.votes ?? []);
  }

  return (
    <div>
      {/* Settings */}
      <section className="gk-card" style={{ marginBottom: 18 }}>
        <h2 className="gk-card-title">Weighting / burst / disconnect params (tunable)</h2>
        <p className="gk-sub">
          Credibility curve (0→1.0), burst detection, and disconnect bands — nothing hardcoded.
          Saving re-tunes AUTO scores/flags on the next recompute; editor overrides are never
          clobbered.
        </p>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {(['credibility', 'burst', 'disconnect'] as const).map((group) => (
            <div key={group}>
              <strong className="gk-sub">{group}</strong>
              {Object.entries(settings[group]).map(([k, v]) => (
                <div key={k} style={{ marginTop: 4 }}>
                  <label className="gk-sub">
                    {k}{' '}
                    <input
                      type="number"
                      step="0.05"
                      value={v}
                      onChange={(e) => setParam(group, k, e.target.value)}
                      style={{ width: 70 }}
                    />
                  </label>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="gk-rel-row" style={{ marginTop: 12 }}>
          <button
            className="gk-btn gk-btn-sm gk-btn-primary"
            disabled={busy}
            onClick={() => run(() => call('ratings/settings', 'PATCH', settings))}
          >
            Save settings + recompute
          </button>
          <button
            className="gk-btn gk-btn-sm"
            disabled={busy}
            onClick={() => run(() => call('ratings/recompute', 'POST', {}))}
          >
            Recompute now
          </button>
        </div>
      </section>

      {/* Per-game inspect + override */}
      <section className="gk-card" style={{ marginBottom: 18 }}>
        <h2 className="gk-card-title">Inspect &amp; override a game</h2>
        <select
          value={selectedId}
          onChange={(e) => {
            setSelectedId(e.target.value);
            setVotes(null);
          }}
        >
          <option value="">pick a game…</option>
          {games.map((g) => (
            <option key={g.gameId} value={g.gameId}>
              {g.name}
            </option>
          ))}
        </select>
        {selected ? (
          <div style={{ marginTop: 12 }}>
            <ul className="gk-admin-grid">
              <li>Our: {fmt(selected.our.score)}</li>
              <li>
                Critics: {fmt(selected.critics.score)} ({selected.critics.count} outlets)
                {selected.critics.override != null ? ' ✎' : ''}
              </li>
              <li>
                Community (weighted): {fmt(selected.community.score)}
                {selected.community.override != null ? ' ✎' : ''} · naive{' '}
                {fmt(selected.community.naive)} · {selected.community.count} votes
              </li>
              <li>Web (estimate): {fmt(selected.web.score)}</li>
              <li>
                Disconnect: {fmt(selected.disconnect.value)} [{selected.disconnect.band ?? '—'}]
              </li>
              <li style={{ color: selected.community.burstFlag ? '#e0a72c' : undefined }}>
                Unusual activity: {selected.community.burstFlag ? '⚠ FLAGGED' : 'no'}
              </li>
            </ul>
            {selected.community.burstInfo ? (
              <p className="gk-sub">
                burst: window {selected.community.burstInfo.windowCount} votes · extremeFrac{' '}
                {selected.community.burstInfo.extremeFraction} · damped{' '}
                {selected.community.burstInfo.dampedVoteCount} · naive{' '}
                {fmt(selected.community.burstInfo.naive)} vs weighted{' '}
                {fmt(selected.community.burstInfo.weighted)}
              </p>
            ) : null}

            <div className="gk-rel-row" style={{ marginTop: 10 }}>
              <label className="gk-sub">
                critics override{' '}
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={ovCritics}
                  onChange={(e) => setOvCritics(e.target.value)}
                  style={{ width: 70 }}
                />
              </label>
              <label className="gk-sub">
                community override{' '}
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={ovCommunity}
                  onChange={(e) => setOvCommunity(e.target.value)}
                  style={{ width: 70 }}
                />
              </label>
              <input
                type="text"
                placeholder="reason (audited)"
                value={ovReason}
                onChange={(e) => setOvReason(e.target.value)}
                style={{ width: 200 }}
              />
              <button
                className="gk-btn gk-btn-sm"
                disabled={busy || (!ovCritics && !ovCommunity)}
                onClick={() =>
                  run(() =>
                    call(`ratings/game/${selected.gameId}/override`, 'POST', {
                      ...(ovCritics ? { criticsScore: Number(ovCritics) } : {}),
                      ...(ovCommunity ? { communityScore: Number(ovCommunity) } : {}),
                      reason: ovReason || 'editor override',
                    }),
                  )
                }
              >
                Override
              </button>
            </div>

            <div className="gk-rel-row" style={{ marginTop: 10 }}>
              <button
                className="gk-btn gk-btn-sm"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    call(`ratings/game/${selected.gameId}/burst-flag`, 'POST', {
                      flagged: false,
                      reason: 'editor reviewed — not manipulation',
                    }),
                  )
                }
              >
                Clear burst flag
              </button>
              <button
                className="gk-btn gk-btn-sm"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    call(`ratings/game/${selected.gameId}/burst-flag`, 'POST', { flagged: null }),
                  )
                }
              >
                Reset flag to auto
              </button>
            </div>

            <div className="gk-rel-row" style={{ marginTop: 10 }}>
              <input
                type="text"
                placeholder={
                  selected.disconnect.contextTag ??
                  'disconnect context tag (editor-only — e.g. "monetization anger")'
                }
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                style={{ width: 360 }}
              />
              <button
                className="gk-btn gk-btn-sm"
                disabled={busy || !tag}
                onClick={() =>
                  run(() =>
                    call(`ratings/game/${selected.gameId}/disconnect-tag`, 'POST', {
                      contextTag: tag,
                    }),
                  )
                }
              >
                Set context tag
              </button>
            </div>

            <div className="gk-rel-row" style={{ marginTop: 10 }}>
              <button
                className="gk-btn gk-btn-sm"
                disabled={busy}
                onClick={() => loadVotes(selected.gameId)}
              >
                Load per-vote weighting breakdown
              </button>
            </div>
            {votes ? (
              <section className="gk-card" style={{ padding: 0, overflowX: 'auto', marginTop: 10 }}>
                <table className="gk-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Score</th>
                      <th>Credibility (email/act/age)</th>
                      <th>In burst</th>
                      <th>Effective weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {votes.map((v, i) => (
                      <tr key={i}>
                        <td>{v.username ?? '—'}</td>
                        <td>{v.score}</td>
                        <td className="gk-sub">
                          {v.credibility.total} ({v.credibility.email}/{v.credibility.activity}/
                          {v.credibility.age})
                        </td>
                        <td>{v.inFlaggedBurst ? '⚠' : v.inWindow ? 'window' : ''}</td>
                        <td>{v.effectiveWeight}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ) : null}
          </div>
        ) : null}
      </section>

      {msg ? (
        <p className="gk-rel-msg" style={{ display: 'block', marginBottom: 12 }}>
          {msg}
        </p>
      ) : null}

      {/* Games overview */}
      <section className="gk-card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="gk-table">
          <thead>
            <tr>
              <th>Game</th>
              <th>Our</th>
              <th>Critics</th>
              <th>Community</th>
              <th>Web</th>
              <th>Disconnect</th>
              <th>Flag</th>
            </tr>
          </thead>
          <tbody>
            {games.map((g) => (
              <tr key={g.gameId}>
                <td>{g.name}</td>
                <td>{fmt(g.our.score)}</td>
                <td>
                  {fmt(g.critics.score)}
                  {g.critics.override != null ? ' ✎' : ''}
                </td>
                <td>
                  {fmt(g.community.score)}
                  {g.community.override != null ? ' ✎' : ''}
                </td>
                <td>{fmt(g.web.score)}</td>
                <td>
                  {fmt(g.disconnect.value)} {g.disconnect.band ? `[${g.disconnect.band}]` : ''}
                  {g.disconnect.contextTag ? ` · ${g.disconnect.contextTag}` : ''}
                </td>
                <td style={{ color: g.community.burstFlag ? '#e0a72c' : undefined }}>
                  {g.community.burstFlag ? '⚠' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
