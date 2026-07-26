'use client';

import { useState } from 'react';

interface QueueItem {
  id: string;
  rawName: string;
  attempts: number;
  context: string;
}
type GameOption = { subjectId: string; label: string };

interface Props {
  items: QueueItem[];
  games: GameOption[];
}

async function call(
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`/admin/api/${path}`, {
      method: 'POST',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const json: unknown = await res.json().catch(() => ({}));
    const data = (json ?? {}) as { message?: string; data?: { status?: string } };
    if (!res.ok) return { ok: false, message: data.message ?? `HTTP ${res.status}` };
    return { ok: true, message: data.data?.status ? `✓ ${data.data.status}` : '✓ done' };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}

function Row({ item, games }: { item: QueueItem; games: GameOption[] }) {
  const [subjectId, setSubjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function run(fn: () => Promise<{ ok: boolean; message: string }>) {
    setBusy(true);
    setMsg(null);
    const r = await fn();
    setMsg(r.message);
    setBusy(false);
    if (r.ok) setTimeout(() => window.location.reload(), 600);
  }

  return (
    <tr>
      <td>
        <strong>{item.rawName}</strong>
        {item.context ? <div className="gk-mono">{item.context}</div> : null}
      </td>
      <td>{item.attempts}</td>
      <td style={{ minWidth: 360 }}>
        <div className="gk-rel-row">
          <button
            className="gk-btn gk-btn-sm"
            disabled={busy}
            onClick={() => run(() => call(`unmatched-games/${item.id}/retry`))}
          >
            Retry
          </button>
          <button
            className="gk-btn gk-btn-sm gk-btn-primary"
            disabled={busy}
            onClick={() =>
              run(() => call(`unmatched-games/${item.id}/resolve-create`, { name: item.rawName }))
            }
          >
            Create game
          </button>
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} disabled={busy}>
            <option value="">link to existing…</option>
            {games.map((g) => (
              <option key={g.subjectId} value={g.subjectId}>
                {g.label}
              </option>
            ))}
          </select>
          <button
            className="gk-btn gk-btn-sm"
            disabled={busy || !subjectId}
            onClick={() =>
              run(() => call(`unmatched-games/${item.id}/resolve-link`, { subjectId }))
            }
          >
            Link
          </button>
          <button
            className="gk-btn gk-btn-sm gk-btn-danger"
            disabled={busy}
            onClick={() => run(() => call(`unmatched-games/${item.id}/dismiss`, {}))}
          >
            Dismiss
          </button>
          {msg ? <span className="gk-rel-msg">{msg}</span> : null}
        </div>
      </td>
    </tr>
  );
}

export default function UnmatchedManager({ items, games }: Props) {
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function resolveName() {
    if (!name.trim()) return;
    setBusy(true);
    setMsg(null);
    const r = await call('game-resolve', { name });
    setMsg(r.message);
    setBusy(false);
    if (r.ok) setTimeout(() => window.location.reload(), 600);
  }

  async function reimport() {
    setBusy(true);
    setMsg(null);
    const r = await call('catalog/import', {});
    setMsg(r.ok ? '✓ import enqueued (runs in background)' : r.message);
    setBusy(false);
  }

  return (
    <div>
      <section className="gk-card" style={{ marginBottom: 18 }}>
        <h2 className="gk-card-title">Resolve a game reference</h2>
        <p className="gk-sub">
          Simulates the I3 trigger: tries the DB, then the provider (mock in demo). Resolves &amp;
          auto-creates if known, otherwise files it below.
        </p>
        <div className="gk-rel-row">
          <input
            value={name}
            placeholder="e.g. Elden Ring, or some unknown title"
            onChange={(e) => setName(e.target.value)}
            style={{ minWidth: 280 }}
          />
          <button className="gk-btn gk-btn-primary gk-btn-sm" disabled={busy} onClick={resolveName}>
            Resolve
          </button>
          <button className="gk-btn gk-btn-sm" disabled={busy} onClick={reimport}>
            Re-run catalog import
          </button>
          {msg ? <span className="gk-rel-msg">{msg}</span> : null}
        </div>
      </section>

      <section className="gk-card" style={{ padding: 0, overflowX: 'auto' }}>
        {items.length === 0 ? (
          <div style={{ padding: 16 }}>No pending unmatched references. 🎉</div>
        ) : (
          <table className="gk-table">
            <thead>
              <tr>
                <th>Reference</th>
                <th>Tries</th>
                <th>Resolve</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <Row key={item.id} item={item} games={games} />
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
