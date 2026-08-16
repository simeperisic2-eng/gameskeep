import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getComments, getTopic, type TopicDetail } from '@/lib/public-api';
import { JsonLd } from '@/lib/jsonld';
import { relativeTime, scoreToTen, truncateWords } from '@/lib/format';
import { breadcrumbLd, newsArticleLd, videoGameRatingLd } from '@/lib/schema';
import { Breadcrumbs } from '../../_components/Breadcrumbs';
import { BiasBar } from '../../_components/BiasBar';
import { FollowButton } from '../../_components/FollowButton';
import { BiasVotes } from '../../_components/BiasVotes';
import { Comments } from '../../_components/Comments';
import { TopicArticles } from '../../_components/TopicArticles';
import { StoryTimeline } from '../../_components/StoryTimeline';
import { CoverArt } from '../../_components/CoverArt';

// Live, server-rotated bias data — render per request so crawlers always get the
// full story (SSR), not a cached shell.
export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// Memoize per request so generateMetadata + the page share one backend fetch.
const loadTopic = cache((slug: string): Promise<TopicDetail | null> => getTopic(slug));

const STATUS_LABEL: Record<string, string> = {
  developing: 'Developing',
  ongoing: 'Ongoing',
  resolved: 'Resolved',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const topic = await loadTopic(slug);
  if (!topic) return { title: 'Story not found', robots: { index: false } };

  const url = `${siteUrl}/topics/${topic.slug}`;
  const description =
    topic.tldr ??
    truncateWords(topic.aiSummary, 180) ??
    `How ${topic.sourceCount} outlets are covering this story — with an influence + quality bias lens.`;

  return {
    title: topic.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      title: topic.title,
      description,
      publishedTime: topic.publishedAt ?? undefined,
      modifiedTime: topic.lastActivityAt ?? undefined,
    },
    twitter: { card: 'summary_large_image', title: topic.title, description },
  };
}

function MetaDot(): React.JSX.Element {
  return (
    <span className="dot" aria-hidden>
      ·
    </span>
  );
}

export default async function TopicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;
  const topic = await loadTopic(slug);
  if (!topic) notFound();

  const statusLabel = STATUS_LABEL[topic.status] ?? topic.status;
  const updated = relativeTime(topic.lastActivityAt);
  const summary = truncateWords(topic.aiSummary, 600);

  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Topics', url: `${siteUrl}/topics` },
    { name: topic.title, url: `${siteUrl}/topics/${topic.slug}` },
  ];

  const jsonLd: Record<string, unknown>[] = [breadcrumbLd(crumbs), newsArticleLd(topic, siteUrl)];
  const gameLd = videoGameRatingLd(topic, siteUrl);
  if (gameLd) jsonLd.push(gameLd);

  return (
    <>
      <JsonLd data={jsonLd} />

      <div className="gk-container gk-story">
        <Breadcrumbs
          items={crumbs.map((c) => ({ name: c.name, url: c.url.replace(siteUrl, '') || '/' }))}
        />

        {/* HEADER */}
        <header className="gk-story-head">
          <div className="gk-story-head-main">
            <div className="gk-chips">
              <span className={`gk-status gk-status-${topic.status}`}>{statusLabel}</span>
              {topic.typeLabel ? <span className="gk-chip amber">{topic.typeLabel}</span> : null}
              {topic.games.map((g) => (
                <a key={g.slug} className="gk-chip gk-chip-link" href={`/games/${g.slug}`}>
                  {g.name}
                </a>
              ))}
            </div>
            <div className="gk-title-row">
              <h1 className="gk-story-title">{topic.title}</h1>
              <FollowButton entityType="topic" slug={topic.slug} />
            </div>
            {topic.tldr ? <p className="gk-story-tldr">{topic.tldr}</p> : null}
            <div className="gk-story-meta">
              <span>
                {topic.sourceCount} {topic.sourceCount === 1 ? 'outlet' : 'outlets'}
              </span>
              <MetaDot />
              <span>
                {topic.articleCount} {topic.articleCount === 1 ? 'article' : 'articles'}
              </span>
              {updated ? (
                <>
                  <MetaDot />
                  <span>Updated {updated}</span>
                </>
              ) : null}
            </div>
          </div>
          {topic.primaryGame ? (
            <div className="gk-story-cover">
              <CoverArt label={topic.primaryGame.name} kicker={topic.typeLabel ?? 'Story'} />
            </div>
          ) : null}
        </header>

        <div className="gk-story-grid">
          <div className="gk-story-main">
            {summary ? (
              <section className="gk-panel gk-story-summary">
                <span className="gk-ai-label">
                  <span className="gk-chip-dot" aria-hidden />
                  AI summary
                </span>
                <p>{summary}</p>
                <p className="gk-ai-note">
                  Auto-generated neutral recap of what happened — not an opinion. Read the sources
                  below for each outlet&apos;s framing.
                </p>
              </section>
            ) : null}

            {/* BIAS DISPLAY — influence flags + quality scale, with hover "why". */}
            <section className="gk-panel">
              <div className="gk-panel-head">
                <h2 className="gk-panel-title">How it&apos;s being told</h2>
              </div>
              <BiasBar
                flags={topic.flags}
                distribution={topic.distribution}
                sourceCount={topic.sourceCount}
              />
            </section>

            <TopicArticles articles={topic.articles} />

            {topic.status === 'developing' ? <StoryTimeline entries={topic.timeline} /> : null}

            {/* COMMUNITY (I6) — reader trust/bias votes + discussion. */}
            <section className="gk-panel" aria-label="Community">
              <div className="gk-panel-head">
                <h2 className="gk-panel-title">Reader read</h2>
              </div>
              <BiasVotes topicId={topic.id} />
            </section>
            <section className="gk-panel" aria-label="Discussion">
              <Comments
                entityType="topic"
                entityId={topic.id}
                title="Reader discussion"
                initial={await getComments('topic', topic.id)}
              />
            </section>
          </div>

          {/* ASIDE — ratings cross-link + related stories. */}
          <aside className="gk-side">
            {topic.gameRating ? (
              <section className="gk-panel gk-rating-card" aria-label="Game ratings">
                <div className="gk-panel-head">
                  <h2 className="gk-panel-title">{topic.gameRating.name}</h2>
                </div>
                <div className="gk-rating-scores">
                  {scoreToTen(topic.gameRating.critics) ? (
                    <div className="gk-scorecol">
                      <span className="label">Critics</span>
                      <span className="val">{scoreToTen(topic.gameRating.critics)}</span>
                    </div>
                  ) : null}
                  {scoreToTen(topic.gameRating.community) ? (
                    <div className="gk-scorecol">
                      <span className="label">Community</span>
                      <span className="val">{scoreToTen(topic.gameRating.community)}</span>
                    </div>
                  ) : null}
                  {scoreToTen(topic.gameRating.our) ? (
                    <div className="gk-scorecol">
                      <span className="label">Our score</span>
                      <span className="val amber">{scoreToTen(topic.gameRating.our)}</span>
                    </div>
                  ) : null}
                </div>
                <a className="gk-readlink" href={`/games/${topic.gameRating.slug}`}>
                  Full ratings &amp; disconnect →
                </a>
              </section>
            ) : null}

            {topic.related.length > 0 ? (
              <section className="gk-panel" aria-label="Related stories">
                <div className="gk-panel-head">
                  <h2 className="gk-panel-title">Related stories</h2>
                </div>
                <ul className="gk-related">
                  {topic.related.map((r) => (
                    <li key={r.slug}>
                      <a href={`/topics/${r.slug}`}>
                        <span className="gk-related-title">{r.title}</span>
                        <span className="gk-related-meta">
                          {r.sourceCount} {r.sourceCount === 1 ? 'outlet' : 'outlets'} ·{' '}
                          {r.articleCount} {r.articleCount === 1 ? 'article' : 'articles'}
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </aside>
        </div>
      </div>
    </>
  );
}
