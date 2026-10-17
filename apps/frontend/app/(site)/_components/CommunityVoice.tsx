import type { GameDetail } from '@/lib/public-api';
import { AiLabel } from './AiLabel';

/**
 * "What the community says" (Phase P S5) — two parts, each only when present:
 *  - the EDITOR note: 2–3 sentences with its source links, as-of date and the
 *    editor's name. Editorial content (an editor wrote / approved it) → no AI label.
 *  - the Steam reviews summary + its stats. Automatic AI text → the LOCKED label
 *    "AI summary of N Steam reviews, last D days"; an editor-approved or edited
 *    text is editorial and says "Summary of …" instead.
 * Links out are nofollow + new tab. Reviewer data is never stored or shown.
 */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./u, '');
  } catch {
    return 'source';
  }
};
const day = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(d);
};

export function CommunityVoice({
  note,
  steam,
  title,
  sourcesNote,
}: {
  note: GameDetail['communityNote'];
  steam: GameDetail['steamReviews'];
  title: string;
  sourcesNote: string;
}): React.JSX.Element | null {
  if (!note && !steam) return null;
  return (
    <section className="gk-panel gk-community-voice" aria-label={title}>
      <div className="gk-panel-head">
        <h2 className="gk-panel-title">{title}</h2>
      </div>

      {note ? (
        <div className="gk-cv-note">
          <p className="gk-cv-text">{note.text}</p>
          <p className="gk-cv-meta">
            {note.editor ? (
              <>
                By <b>{note.editor}</b>
              </>
            ) : null}
            {note.editor && note.asOf ? ' · ' : null}
            {note.asOf ? (
              <>
                as of <time dateTime={note.asOf}>{day(note.asOf)}</time>
              </>
            ) : null}
          </p>
          <p className="gk-cv-sources">
            <span className="gk-cv-sources-label">Sources:</span>{' '}
            {note.sources.map((s, i) => (
              <span key={`${s.url}:${i}`}>
                {i > 0 ? ' · ' : null}
                <a href={s.url} target="_blank" rel="noopener noreferrer nofollow">
                  {s.label || hostOf(s.url)} <span aria-hidden>↗</span>
                </a>
              </span>
            ))}
          </p>
          <p className="gk-cv-fine">{sourcesNote}</p>
        </div>
      ) : null}

      {steam ? (
        <div className="gk-cv-steam">
          {steam.isAi ? (
            <AiLabel steam={{ reviews: steam.reviewCount, days: steam.windowDays }} />
          ) : (
            <span className="gk-ai-label">
              <span className="gk-chip-dot" aria-hidden />
              {`Summary of ${steam.reviewCount.toLocaleString('en-US')} Steam reviews, last ${steam.windowDays} days`}
            </span>
          )}
          <p className="gk-cv-text">{steam.text}</p>
          <p className="gk-cv-meta">
            {steam.positivePct != null ? (
              <>
                <b>{Math.round(steam.positivePct)}%</b> positive ·{' '}
              </>
            ) : null}
            {steam.reviewCount.toLocaleString('en-US')} reviews in the last {steam.windowDays} days
            {steam.storeUrl ? (
              <>
                {' · '}
                <a href={steam.storeUrl} target="_blank" rel="noopener noreferrer nofollow">
                  Steam page <span aria-hidden>↗</span>
                </a>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
    </section>
  );
}
