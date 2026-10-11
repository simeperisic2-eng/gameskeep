import type { PublicIntegrityRow, TopicArticleRow } from '@/lib/public-api';
import { NO_SIGNALS_EXPLAINER, NO_SIGNALS_LABEL } from '@/lib/bias';
import { isHttpUrl } from '@/lib/url';
import { ArticleFlags } from './BiasBar';

/**
 * Evidence date, always in UTC: this block renders in both server and client
 * components, and a runtime-local zone made the same date read differently per
 * page (and mismatch on hydration).
 */
function shortDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * The review-integrity block (Phase P S1): up to three rows — review copy from
 * the publisher · embargo · sponsored event or press trip — each ONLY when a
 * signal was found, with its evidence (a short quoted snippet that links to the
 * source article, or an editor note) and a date. Nothing found → one line.
 * Evidence text is rendered escaped (React children), never as HTML.
 */
export function IntegrityBlock({
  rows,
  sourceUrl,
}: {
  rows: PublicIntegrityRow[];
  sourceUrl: string | null;
}): React.JSX.Element {
  return (
    <div className="gk-integrity" aria-label="Review integrity">
      <span className="gk-integrity-head">Review integrity</span>
      {rows.length === 0 ? (
        <p className="gk-integrity-none">
          {NO_SIGNALS_LABEL}
          <span className="gk-integrity-hint"> — {NO_SIGNALS_EXPLAINER}</span>
        </p>
      ) : (
        <ul className="gk-integrity-rows">
          {rows.map((r) => {
            const date = shortDate(r.date);
            return (
              <li key={r.kind} className="gk-integrity-row">
                <span className="gk-integrity-label">{r.label}</span>
                {r.evidenceType === 'snippet' ? (
                  <q className="gk-integrity-evidence">{r.evidence}</q>
                ) : (
                  <span className="gk-integrity-evidence">Editor note: {r.evidence}</span>
                )}
                <span className="gk-integrity-meta">
                  {date ? <span>{date}</span> : null}
                  <span>{r.confirmed ? 'Confirmed by an editor' : 'Auto-detected'}</span>
                  {/* Render-time scheme guard (as I8 F4): only an http(s) href. */}
                  {isHttpUrl(sourceUrl) ? (
                    <a href={sourceUrl} target="_blank" rel="noopener noreferrer nofollow">
                      Source ↗
                    </a>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The full panel for a review row: its public chips (sponsored / affiliate /
 * opinion — review copy lives in the integrity block) + the integrity block.
 */
export function ReviewSignals({ row }: { row: TopicArticleRow }): React.JSX.Element {
  return (
    <div className="gk-review-panel">
      {row.flags.length > 0 ? (
        <ArticleFlags flags={row.flags} reasons={row.reasons} mode="panel" />
      ) : null}
      <IntegrityBlock rows={row.integrity ?? []} sourceUrl={row.url} />
    </div>
  );
}
