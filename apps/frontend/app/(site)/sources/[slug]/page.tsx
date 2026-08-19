import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getSource, type SourceDetail } from '@/lib/public-api';
import { JsonLd } from '@/lib/jsonld';
import { relativeTime, scoreToTen, truncateWords } from '@/lib/format';
import { breadcrumbLd, sourceOrganizationLd } from '@/lib/schema';
import { Breadcrumbs } from '../../_components/Breadcrumbs';
import { SourceIcon } from '../../_components/SourceIcon';
import { ArticleFlags } from '../../_components/BiasBar';
import { AdSlot } from '../../_components/AdSlot';

export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

const loadSource = cache((slug: string): Promise<SourceDetail | null> => getSource(slug));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const source = await loadSource(slug);
  if (!source) return { title: 'Source not found', robots: { index: false } };
  const url = `${siteUrl}/sources/${source.slug}`;
  const owner = source.parentCompany ? ` Owned by ${source.parentCompany}.` : '';
  const description =
    source.description ??
    `${source.name} — ownership, reputation and the bias signals in its games coverage on GamesKeep.${owner}`;
  return {
    title: source.name,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url, title: source.name, description },
    twitter: { card: 'summary', title: source.name, description },
  };
}

/** Independent vs influenced share for the coverage-profile bar. */
function profile(flags: SourceDetail['flags']): {
  total: number;
  independent: number;
  influenced: number;
  independentPct: number;
} {
  const total = flags.total;
  const independent = flags.independent;
  const influenced = Math.max(0, total - independent);
  const independentPct = total > 0 ? Math.round((independent / total) * 100) : 0;
  return { total, independent, influenced, independentPct };
}

const SIGNAL_LABELS: { key: keyof SourceDetail['flags']; label: string }[] = [
  { key: 'sponsored', label: 'Sponsored' },
  { key: 'affiliate', label: 'Affiliate' },
  { key: 'reviewCopy', label: 'Review copy' },
  { key: 'opinion', label: 'Opinion' },
];

export default async function SourcePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;
  const source = await loadSource(slug);
  if (!source) notFound();

  const reputation = scoreToTen(source.reputation);
  const prof = profile(source.flags);

  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Sources', url: `${siteUrl}/sources` },
    { name: source.name, url: `${siteUrl}/sources/${source.slug}` },
  ];
  const jsonLd: Record<string, unknown>[] = [
    breadcrumbLd(crumbs),
    sourceOrganizationLd(source, siteUrl),
  ];

  return (
    <>
      <JsonLd data={jsonLd} />

      <div className="gk-container gk-game">
        <Breadcrumbs
          items={crumbs.map((c) => ({ name: c.name, url: c.url.replace(siteUrl, '') || '/' }))}
        />

        {/* HEADER */}
        <header className="gk-source-head">
          <div className="gk-source-id">
            <SourceIcon name={source.name} />
            <div>
              <div className="gk-chips">
                {source.typeLabel ? <span className="gk-chip">{source.typeLabel}</span> : null}
                {source.parentCompany ? (
                  <span className="gk-chip ghost">{source.parentCompany}</span>
                ) : null}
              </div>
              <h1 className="gk-source-title">{source.name}</h1>
              {source.description ? (
                <p className="gk-source-desc">{source.description}</p>
              ) : (
                <p className="gk-source-desc gk-source-desc-dim">
                  A games outlet GamesKeep aggregates. Reputation and signals below are measured
                  from its coverage in our index.
                </p>
              )}
              {source.websiteUrl ? (
                <a
                  className="gk-readlink"
                  href={source.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                >
                  Visit {source.name} ↗
                </a>
              ) : null}
            </div>
          </div>

          <dl className="gk-source-stats">
            <div className="gk-source-stat">
              <dt>Reputation</dt>
              <dd className="amber">{reputation ?? '—'}</dd>
              <span className="gk-source-stat-sub">avg coverage quality</span>
            </div>
            <div className="gk-source-stat">
              <dt>Commercial</dt>
              <dd>{source.affiliatePct != null ? `${source.affiliatePct}%` : '—'}</dd>
              <span className="gk-source-stat-sub">affiliate / sponsored</span>
            </div>
            <div className="gk-source-stat">
              <dt>Stories</dt>
              <dd>{source.articleCount}</dd>
              <span className="gk-source-stat-sub">in our index</span>
            </div>
          </dl>
        </header>

        <div className="gk-game-body">
          <aside className="gk-game-aside">
            {/* OWNERSHIP & CONFLICT — the BLUEPRINT 2.5 differentiator. */}
            <section className="gk-panel" aria-label="Ownership">
              <div className="gk-panel-head">
                <h2 className="gk-panel-title">Ownership</h2>
              </div>
              {source.owner ? (
                <>
                  <p className="gk-own-line">
                    <span className="gk-own-label">Parent company</span>
                    <span className="gk-own-value">{source.owner.name}</span>
                  </p>
                  {source.owner.siblings.length > 0 ? (
                    <>
                      <p className="gk-conflict-note">
                        <span className="gk-conflict">
                          <span className="gk-conflict-dot" aria-hidden />
                          Shared ownership
                        </span>
                        Also owns {source.owner.siblings.length} other indexed{' '}
                        {source.owner.siblings.length === 1 ? 'outlet' : 'outlets'} — coverage may
                        align.
                      </p>
                      <ul className="gk-own-siblings">
                        {source.owner.siblings.map((s) => (
                          <li key={s.slug}>
                            <a href={`/sources/${s.slug}`}>{s.name}</a>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="gk-own-clean">No other indexed outlet shares this owner.</p>
                  )}
                </>
              ) : (
                <p className="gk-own-clean">Independently owned — no parent company on record.</p>
              )}
            </section>

            {source.topGames.length > 0 ? (
              <section className="gk-panel" aria-label="Most covered">
                <div className="gk-panel-head">
                  <h2 className="gk-panel-title">Covers most</h2>
                </div>
                <ul className="gk-relgames">
                  {source.topGames.map((g) => (
                    <li key={g.slug}>
                      <a href={`/games/${g.slug}`}>
                        <span className="gk-relgame-main">
                          <span className="gk-relgame-name">{g.name}</span>
                        </span>
                        <span className="gk-relgame-score">{g.count}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <AdSlot slotKey="source-page" />
          </aside>

          {/* COVERAGE PROFILE — the bias signals in this outlet's coverage. */}
          <section className="gk-panel" aria-label="Coverage profile">
            <div className="gk-panel-head">
              <h2 className="gk-panel-title">Coverage profile</h2>
            </div>
            {prof.total > 0 ? (
              <>
                <div className="gk-bias-axis">
                  <div className="gk-bias-axis-head">
                    <span className="gk-bias-axis-name">
                      Influence <small>across {prof.total} stories</small>
                    </span>
                    <span
                      className={`gk-bias-phrase ${prof.independentPct >= 60 ? 'tone-good' : 'tone-mixed'}`}
                    >
                      {prof.independentPct}% independent
                    </span>
                  </div>
                  <div className="gk-bias-track">
                    <span
                      className="gk-bias-seg good"
                      style={{ width: `${prof.independentPct}%` }}
                    />
                    <span
                      className="gk-bias-seg warn"
                      style={{ width: `${100 - prof.independentPct}%` }}
                    />
                  </div>
                </div>
                <div className="gk-source-flags">
                  <span className="gk-flag independent">Independent {prof.independent}</span>
                  {SIGNAL_LABELS.map(({ key, label }) => {
                    const n = source.flags[key];
                    if (!n) return null;
                    return (
                      <span key={key} className="gk-flag signal">
                        {label} {n}
                      </span>
                    );
                  })}
                </div>
                <p className="gk-source-profile-note">
                  Signals are factual (affiliate links, sponsorship, review copies, opinion framing)
                  — what the coverage carries, not a verdict on it.
                </p>
              </>
            ) : (
              <p className="gk-section-sub" style={{ margin: 0 }}>
                No scored coverage from this outlet yet — its bias profile appears here as stories
                land.
              </p>
            )}
          </section>

          {/* RECENT COVERAGE — excerpt + link only (I1 copyright). */}
          <section className="gk-panel" aria-label="Recent coverage">
            <div className="gk-panel-head">
              <h2 className="gk-panel-title">Recent coverage</h2>
            </div>
            {source.recentArticles.length > 0 ? (
              <div className="gk-srcrows">
                {source.recentArticles.map((a) => {
                  const excerpt = truncateWords(a.excerpt, 200);
                  const time = relativeTime(a.publishDate);
                  return (
                    <article key={a.id} className="gk-srcrow">
                      <SourceIcon name={source.name} />
                      <div className="gk-srcrow-body">
                        <div className="gk-srcrow-top">
                          <span className="gk-srcrow-type">{a.articleType}</span>
                          {a.origin === 'ours' ? <span className="gk-chip amber">Ours</span> : null}
                        </div>
                        {/* B1: headline links out to the original article. */}
                        <h3 className="gk-srcrow-title">
                          {a.url ? (
                            <a
                              className="gk-title-link"
                              href={a.url}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                            >
                              {a.title}
                            </a>
                          ) : (
                            a.title
                          )}
                        </h3>
                        {excerpt ? <p className="gk-srcrow-excerpt">{excerpt}</p> : null}
                        <div className="gk-srcrow-foot">
                          <ArticleFlags flags={a.flags} reasons={a.reasons} />
                          <span className="gk-srcrow-meta">{time ?? ''}</span>
                          {a.url ? (
                            <a
                              className="gk-readlink"
                              href={a.url}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                            >
                              Read ↗
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="gk-section-sub" style={{ margin: 0 }}>
                No recent coverage from this outlet in our index yet.
              </p>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
