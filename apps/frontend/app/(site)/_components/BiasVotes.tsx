'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiPost, fetchMe } from '@/lib/client';

/**
 * Reader trust/bias votes on a topic (SPEC I6, Slice 8). Three axes; each vote
 * is −1 / 0 / +1 and the shown aggregate is CREDIBILITY-WEIGHTED (decision 13),
 * so a throwaway ring can't swing it. Verified-gated writes.
 */
type AxisAgg = { weightedMean: number | null; count: number; myVote: number | null };
const AXES: { key: string; label: string; neg: string; pos: string }[] = [
  { key: 'influence', label: 'Influence', neg: 'Independent', pos: 'Influenced' },
  { key: 'quality', label: 'Quality', neg: 'Low-effort', pos: 'Top' },
  { key: 'trust', label: 'Trust', neg: 'Skeptical', pos: 'Trusted' },
];

export function BiasVotes({ topicId }: { topicId: string }): React.JSX.Element {
  const [agg, setAgg] = useState<Record<string, AxisAgg>>({});
  const [gate, setGate] = useState<'loading' | 'guest' | 'unverified' | 'ok'>('loading');
  const base = `/api/community/topics/${topicId}`;

  const load = useCallback(async () => {
    const me = await fetchMe();
    setGate(!me ? 'guest' : me.isEmailVerified ? 'ok' : 'unverified');
    const r = await fetch(`${base}/bias`, { cache: 'no-store' });
    if (r.ok) {
      const b = (await r.json()) as { data?: Record<string, AxisAgg> };
      setAgg(b.data ?? {});
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const vote = useCallback(
    async (axis: string, value: number) => {
      const r = await apiPost(`${base}/bias-vote`, { axis, value });
      if (r.ok) void load();
    },
    [base, load],
  );

  return (
    <div className="gk-biasvotes">
      {AXES.map((a) => {
        const row = agg[a.key];
        const mine = row?.myVote ?? 0;
        const pct =
          row?.weightedMean != null ? Math.round(((row.weightedMean + 1) / 2) * 100) : null;
        return (
          <div key={a.key} className="gk-biasvote">
            <div className="gk-biasvote-head">
              <span className="gk-biasvote-label">{a.label}</span>
              <span className="gk-biasvote-count">{row?.count ?? 0} votes</span>
            </div>
            <div className="gk-biasvote-bar" aria-hidden>
              <span className="gk-biasvote-fill" style={{ width: `${pct ?? 50}%` }} />
            </div>
            <div className="gk-biasvote-ends">
              <span>{a.neg}</span>
              <span>{a.pos}</span>
            </div>
            {gate === 'ok' ? (
              <div className="gk-biasvote-controls" role="group" aria-label={`${a.label} vote`}>
                <button
                  type="button"
                  className={mine === -1 ? 'is-on' : ''}
                  onClick={() => vote(a.key, mine === -1 ? 0 : -1)}
                >
                  ◀ {a.neg}
                </button>
                <button
                  type="button"
                  className={mine === 1 ? 'is-on' : ''}
                  onClick={() => vote(a.key, mine === 1 ? 0 : 1)}
                >
                  {a.pos} ▶
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
      {gate === 'guest' ? (
        <p className="gk-comments-gate">
          <a href="/login">Sign in</a> to add your read.
        </p>
      ) : gate === 'unverified' ? (
        <p className="gk-comments-gate">Verify your email to vote.</p>
      ) : null}
    </div>
  );
}
