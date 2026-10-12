'use client';

import { useId, useRef, useState } from 'react';
import type { QuickViewData } from '@/lib/public-api';
import { deltaText, scoreToTen, windowLabel } from '@/lib/format';

/**
 * Quick view (Phase P S3): a button on a game card — OUTSIDE the card's links —
 * opens an accessible dialog (native <dialog>: modal, focus moves in, Esc
 * closes, focus returns to the button) with the three rating layers, the
 * disconnect, grouped tags and player data (current + Δ). The data is the cached
 * public quick-view endpoint; nothing is computed in the browser.
 */
const BAND_LABEL: Record<string, string> = {
  agree: 'In agreement',
  mild: 'Mild gap',
  notable: 'Notable gap',
  large: 'Large gap',
};

export function QuickView({ slug, name }: { slug: string; name: string }): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const [data, setData] = useState<QuickViewData | null>(null);
  const [error, setError] = useState(false);

  async function open(): Promise<void> {
    dialogRef.current?.showModal();
    if (data) return;
    try {
      const r = await fetch(`/api/public/game/${encodeURIComponent(slug)}/quick`, {
        cache: 'no-store',
      });
      const b = (await r.json()) as { data?: QuickViewData };
      if (!r.ok || !b.data) throw new Error('quick view');
      setData(b.data);
    } catch {
      setError(true);
    }
  }
  function close(): void {
    dialogRef.current?.close();
  }

  const layer = (label: string, v: number | null, amber = false): React.JSX.Element => (
    <div className="gk-qv-layer">
      <span className="gk-qv-layer-label">{label}</span>
      <span className={`gk-qv-layer-val${amber ? ' amber' : ''}`}>{scoreToTen(v) ?? '—'}</span>
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="gk-qv-btn"
        aria-haspopup="dialog"
        onClick={() => void open()}
      >
        Quick view<span className="gk-sr-only">: {name}</span>
      </button>
      <dialog
        ref={dialogRef}
        className="gk-qv"
        aria-labelledby={titleId}
        onClose={() => buttonRef.current?.focus()}
      >
        <div className="gk-qv-head">
          <h2 className="gk-qv-title" id={titleId}>
            {name}
          </h2>
          <button type="button" className="gk-qv-close" onClick={close} aria-label="Close">
            ×
          </button>
        </div>
        {error ? (
          <p className="gk-section-sub">Couldn’t load this game right now.</p>
        ) : !data ? (
          <p className="gk-section-sub" aria-busy="true">
            Loading…
          </p>
        ) : (
          <div className="gk-qv-body">
            <div className="gk-qv-layers">
              {layer('Critics', data.layers.critics)}
              {layer('Our', data.layers.our, true)}
              {layer('Players', data.layers.community)}
            </div>
            {data.disconnect.value != null ? (
              <p className="gk-qv-line">
                Disconnect {(data.disconnect.value / 10).toFixed(1)} ·{' '}
                <span>{BAND_LABEL[data.disconnect.band ?? ''] ?? 'Gap'}</span>
              </p>
            ) : null}
            {data.tags.content.length ? (
              <p className="gk-qv-line">
                <span className="gk-qv-k">Content</span>{' '}
                <span>{data.tags.content.map((t) => t.name).join(' · ')}</span>
              </p>
            ) : null}
            {data.tags.issues.length ? (
              <p className="gk-qv-line">
                <span className="gk-qv-k">Issues</span>{' '}
                <span>{data.tags.issues.map((t) => t.name).join(' · ')}</span>
              </p>
            ) : null}
            {data.players ? (
              <p className="gk-qv-line">
                <span className="gk-qv-k">Players (Steam)</span>{' '}
                <span>
                  {data.players.current != null
                    ? `${data.players.current.toLocaleString('en-US')} now`
                    : '—'}
                  {data.players.delta
                    ? ` · ${deltaText(data.players.delta) ?? ''} ${windowLabel(data.players.windowHours) ?? ''}`
                    : ''}
                </span>
              </p>
            ) : null}
            <a className="gk-readlink" href={`/games/${data.slug}`}>
              Open the game page →
            </a>
          </div>
        )}
      </dialog>
    </>
  );
}
