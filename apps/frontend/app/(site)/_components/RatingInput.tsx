'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiPost, fetchMe } from '@/lib/client';

/**
 * Community rating input + aggregate (SPEC I6, Slice 8). Verified users rate a
 * game 0–100; the panel shows the CREDIBILITY-WEIGHTED community score (not the
 * naive average) with the count and a manipulation-aware "unusual activity"
 * flag. Reads the pre-computed aggregate — the weighting/burst math already ran
 * in the background (I4b engine).
 */
interface Aggregate {
  weighted: number | null;
  naive: number | null;
  count: number;
  burstFlag: boolean;
  myScore: number | null;
}

const toTen = (n: number | null): string => (n == null ? '—' : (n / 10).toFixed(1));

export function RatingInput({ gameId }: { gameId: string }): React.JSX.Element {
  const [agg, setAgg] = useState<Aggregate | null>(null);
  const [verified, setVerified] = useState<boolean | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [score, setScore] = useState(70);
  const [busy, setBusy] = useState(false);
  const base = `/api/community/games/${gameId}/rating`;

  const load = useCallback(async () => {
    const me = await fetchMe();
    setSignedIn(Boolean(me));
    setVerified(me ? me.isEmailVerified : null);
    const r = await fetch(base, { cache: 'no-store' });
    if (r.ok) {
      const b = (await r.json()) as { data?: Aggregate };
      if (b.data) {
        setAgg(b.data);
        if (b.data.myScore != null) setScore(b.data.myScore);
      }
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = useCallback(async () => {
    setBusy(true);
    await apiPost(base, { score });
    // the weighted aggregate recomputes in the background; re-read shortly.
    setTimeout(() => void load(), 700);
    setBusy(false);
  }, [base, score, load]);

  return (
    <div className="gk-ratepanel">
      <div className="gk-ratepanel-agg">
        <div className="gk-ratepanel-score">
          <strong>{toTen(agg?.weighted ?? null)}</strong>
          <span>/10</span>
        </div>
        <div className="gk-ratepanel-meta">
          <span>
            {agg?.count ?? 0} player {agg?.count === 1 ? 'rating' : 'ratings'} · weighted
          </span>
          {agg?.burstFlag ? (
            <span className="gk-flag-unusual">⚠ Unusual activity — weighting applied</span>
          ) : null}
        </div>
      </div>

      {signedIn && verified ? (
        <div className="gk-rate-input">
          <label className="gk-rate-slider">
            <input
              type="range"
              min={0}
              max={100}
              value={score}
              onChange={(e) => setScore(Number(e.target.value))}
            />
            <span className="gk-rate-value">{(score / 10).toFixed(1)}</span>
          </label>
          <button className="gk-btn-amber" type="button" onClick={submit} disabled={busy}>
            {busy ? 'Saving…' : agg?.myScore != null ? 'Update rating' : 'Rate'}
          </button>
        </div>
      ) : (
        <p className="gk-comments-gate">
          {signedIn ? (
            <>Verify your email to rate.</>
          ) : (
            <>
              <a href="/login">Sign in</a> to rate this game.
            </>
          )}
        </p>
      )}
    </div>
  );
}
