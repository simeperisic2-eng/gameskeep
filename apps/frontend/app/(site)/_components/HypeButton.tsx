'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiPost, fetchMe } from '@/lib/client';

/**
 * Upcoming-game hype toggle (SPEC I6, Slice 8) — fills the disabled I5 "▲ Hype"
 * placeholder. Verified-gated; the count is credibility-weighted at read. A
 * signed-out visitor gets a sign-in link (the affordance is never dead).
 */
export function HypeButton({ gameId }: { gameId: string }): React.JSX.Element {
  const [count, setCount] = useState<number | null>(null);
  const [mine, setMine] = useState(false);
  const [gate, setGate] = useState<'loading' | 'guest' | 'unverified' | 'ok'>('loading');
  const [busy, setBusy] = useState(false);
  const base = `/api/community/games/${gameId}/hype`;

  const load = useCallback(async () => {
    const me = await fetchMe();
    setGate(!me ? 'guest' : me.isEmailVerified ? 'ok' : 'unverified');
    const r = await fetch(base, { cache: 'no-store' });
    if (r.ok) {
      const b = (await r.json()) as { data?: { count: number; mine: boolean } };
      setCount(b.data?.count ?? 0);
      setMine(Boolean(b.data?.mine));
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const r = await apiPost<{ hyped: boolean }>(base, undefined);
    if (r.ok) {
      setMine(Boolean(r.data?.hyped));
      setCount((c) => (c ?? 0) + (r.data?.hyped ? 1 : -1));
    }
    setBusy(false);
  }, [base, busy]);

  if (gate === 'ok') {
    return (
      <button
        type="button"
        className={`gk-hype-btn${mine ? ' is-hyped' : ''}`}
        onClick={toggle}
        disabled={busy}
        aria-pressed={mine}
      >
        ▲ Hype{count != null ? ` · ${count}` : ''}
      </button>
    );
  }
  return (
    <a className="gk-hype-btn" href={gate === 'guest' ? '/login' : '/account'}>
      ▲ Hype{count != null ? ` · ${count}` : ''}
    </a>
  );
}
