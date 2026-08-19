'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '@/lib/client';
import type { AwardNominee } from '@/lib/public-api';
import { AwardNomineeMeta } from './AwardNomineeMeta';

interface TallyNominee {
  nominationId: string;
  votes: number;
  weightSum: number;
}
interface TallyResponse {
  tally?: { totalVotes: number; totalWeight: number; nominees: TallyNominee[] };
  my?: { nominationId: string } | null;
}

/**
 * Live ballot for one category during the `voting` phase (SPEC I7, Slice 3).
 * SEO-safe: the nominees + scores are seeded from SSR props, so the crawler sees
 * them without JS; hydration adds the vote buttons + the live weighted counter.
 * The vote goes through the same-origin BFF (session cookie + CSRF); the server
 * enforces one-per-category, verified-only, and the voting window — here we only
 * reflect its result and surface a friendly message on 401/403/409.
 */
export function AwardBallot({
  editionCategoryId,
  nominees: initial,
}: {
  editionCategoryId: string;
  nominees: AwardNominee[];
}): React.JSX.Element {
  const [nominees, setNominees] = useState<AwardNominee[]>(initial);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [needSignIn, setNeedSignIn] = useState(false);
  const [busy, setBusy] = useState(false);

  function applyTally(tally: NonNullable<TallyResponse['tally']>): void {
    setNominees((prev) =>
      prev.map((n) => {
        const t = tally.nominees.find((x) => x.nominationId === n.nominationId);
        if (!t) return { ...n, votes: 0, weightSum: 0 };
        return { ...n, votes: t.votes, weightSum: t.weightSum };
      }),
    );
  }

  useEffect(() => {
    let alive = true;
    apiGet<TallyResponse>(`/api/awards/categories/${editionCategoryId}/tally`).then((r) => {
      if (!alive || !r.ok) return;
      if (r.data?.tally) applyTally(r.data.tally);
      setMyVote(r.data?.my?.nominationId ?? null);
    });
    return () => {
      alive = false;
    };
  }, [editionCategoryId]);

  async function vote(nominationId: string): Promise<void> {
    setBusy(true);
    setMsg('');
    setNeedSignIn(false);
    const r = await apiPost<TallyResponse>(`/api/awards/categories/${editionCategoryId}/vote`, {
      nominationId,
    });
    setBusy(false);
    if (r.ok) {
      setMyVote(r.data?.my?.nominationId ?? nominationId);
      if (r.data?.tally) applyTally(r.data.tally);
    } else if (r.status === 401) {
      setNeedSignIn(true);
      setMsg('Sign in to vote.');
    } else if (r.status === 403) {
      setMsg('Verify your email address to vote.');
    } else if (r.status === 409) {
      setMsg('Voting isn’t open right now.');
    } else {
      setMsg(r.message ?? 'Could not record your vote — please retry.');
    }
  }

  const totalWeight = nominees.reduce((s, n) => s + n.weightSum, 0);

  return (
    <div className="gk-aw-ballot">
      {nominees.map((n) => {
        const pct = totalWeight > 0 ? Math.round((n.weightSum / totalWeight) * 100) : 0;
        const mine = myVote === n.nominationId;
        return (
          <div key={n.nominationId} className={`gk-aw-nom${mine ? ' is-mine' : ''}`}>
            <div className="gk-aw-nom-head">
              <a className="gk-aw-nom-name" href={`/games/${n.slug}`}>
                {n.name}
              </a>
              <button
                type="button"
                className="gk-aw-vote-btn"
                onClick={() => vote(n.nominationId)}
                disabled={busy}
                aria-pressed={mine}
              >
                {mine ? '✓ Your vote' : 'Vote'}
              </button>
            </div>
            {n.blurb ? <p className="gk-aw-nom-blurb">{n.blurb}</p> : null}
            <AwardNomineeMeta nominee={n} />
            <div className="gk-aw-bar" aria-hidden="true">
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="gk-aw-bar-label">
              {pct}% · {n.votes} {n.votes === 1 ? 'vote' : 'votes'}
            </div>
          </div>
        );
      })}
      {msg ? (
        <p className="gk-aw-msg" role="alert">
          {msg} {needSignIn ? <a href="/login?next=/awards">Sign in</a> : null}
        </p>
      ) : null}
    </div>
  );
}
