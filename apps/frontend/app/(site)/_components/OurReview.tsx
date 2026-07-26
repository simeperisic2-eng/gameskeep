import type { PublicReview } from '@/lib/public-api';
import { scoreToTen, relativeTime } from '@/lib/format';

/**
 * Our structured review (BLUEPRINT 2.3) — lives ONLY on the game page, never in
 * the article feed. One review = one score = one game. Clearly badged "ours".
 * Every sub-part (verdict, pros/cons, body, platform/hours/author/date) renders
 * only where present, so a verdict-only review stays clean.
 */
export function OurReview({
  review,
  name,
}: {
  review: PublicReview;
  name: string;
}): React.JSX.Element {
  const score = scoreToTen(review.ourScore);
  const date = relativeTime(review.publishedAt);
  const meta = [
    review.author,
    review.platformTested ? `on ${review.platformTested}` : null,
    review.hoursPlayed ? `${review.hoursPlayed}h played` : null,
    date,
  ].filter((x): x is string => Boolean(x));
  return (
    <section className="gk-panel gk-review" aria-label={`Our review of ${name}`}>
      <div className="gk-panel-head">
        <h2 className="gk-panel-title">
          Our review <span className="gk-chip amber">Ours</span>
        </h2>
        {score ? (
          <span className="gk-review-score">
            {score}
            <span className="gk-pillar-of">/10</span>
          </span>
        ) : null}
      </div>

      {review.verdict ? <p className="gk-review-verdict">“{review.verdict}”</p> : null}

      {review.pros.length > 0 || review.cons.length > 0 ? (
        <div className="gk-proscons">
          {review.pros.length > 0 ? (
            <div className="gk-procon gk-pros">
              <h3>Pros</h3>
              <ul>
                {review.pros.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {review.cons.length > 0 ? (
            <div className="gk-procon gk-cons">
              <h3>Cons</h3>
              <ul>
                {review.cons.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {review.body ? <p className="gk-review-body">{review.body}</p> : null}

      {meta.length > 0 ? <p className="gk-review-meta">{meta.join(' · ')}</p> : null}
    </section>
  );
}
