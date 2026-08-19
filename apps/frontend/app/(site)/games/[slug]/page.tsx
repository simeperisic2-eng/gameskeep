import { cache } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getComments, getGame, getGameAwardWins, type GameDetail } from '@/lib/public-api';
import { JsonLd } from '@/lib/jsonld';
import { truncateWords } from '@/lib/format';
import { breadcrumbLd, videoGameLd } from '@/lib/schema';
import { Breadcrumbs } from '../../_components/Breadcrumbs';
import { CoverArt } from '../../_components/CoverArt';
import { FollowButton } from '../../_components/FollowButton';
import { AwardBadges } from '../../_components/AwardBadges';
import { RatingInput } from '../../_components/RatingInput';
import { Comments } from '../../_components/Comments';
import { RatingBlock } from '../../_components/RatingBlock';
import { ContentFlags, hasContentFlagData } from '../../_components/ContentFlags';
import { OurReview } from '../../_components/OurReview';
import { GameArticles } from '../../_components/GameArticles';
import { GameMedia } from '../../_components/GameMedia';
import { RelatedGames } from '../../_components/RelatedGames';
import { PlayerActivity } from '../../_components/PlayerActivity';
import { AdSlot } from '../../_components/AdSlot';

// Render per request so crawlers always get the full hub (SSR), not a shell.
export const dynamic = 'force-dynamic';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

// Memoize per request so generateMetadata + the page share one backend fetch.
const loadGame = cache((slug: string): Promise<GameDetail | null> => getGame(slug));

const STATUS_LABEL: Record<string, string> = {
  announced: 'Announced',
  in_development: 'In development',
  early_access: 'Early access',
  released: 'Released',
  delisted: 'Delisted',
};

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  // Release dates are stored YYYY-MM-DD (often partial); show as-is if not parseable.
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const game = await loadGame(slug);
  if (!game) return { title: 'Game not found', robots: { index: false } };

  const url = `${siteUrl}/games/${game.slug}`;
  const description =
    game.summary ??
    truncateWords(game.description, 180) ??
    `${game.name} — separated critic, our and community scores, the critic↔community disconnect, and content flags.`;

  return {
    title: game.name,
    description,
    alternates: { canonical: url },
    openGraph: { type: 'website', url, title: game.name, description },
    twitter: { card: 'summary_large_image', title: game.name, description },
  };
}

function compactNum(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** Aside "at a glance" facts — each rendered only where the data exists. */
function AtAGlance({ game }: { game: GameDetail }): React.JSX.Element | null {
  const rows: { label: string; value: string }[] = [];
  const steam = game.rating?.webEntries.find((w) => w.sentimentPct != null) ?? null;
  if (steam?.sentimentPct != null) {
    rows.push({
      label: 'Steam reviews',
      value: `${Math.round(steam.sentimentPct)}% positive${steam.sampleSize ? ` (${compactNum(steam.sampleSize)})` : ''}`,
    });
  }
  if (game.hltbMainHours) rows.push({ label: 'Main story', value: `${game.hltbMainHours}h` });
  if (game.hltbCompletionistHours)
    rows.push({ label: 'Completionist', value: `${game.hltbCompletionistHours}h` });
  if (game.steamCompletionRate != null)
    rows.push({ label: 'Finished it', value: `${Math.round(game.steamCompletionRate)}% on Steam` });
  if (rows.length === 0) return null;
  return (
    <section className="gk-panel" aria-label="At a glance">
      <div className="gk-panel-head">
        <h2 className="gk-panel-title">At a glance</h2>
      </div>
      <dl className="gk-glance">
        {rows.map((r) => (
          <div key={r.label} className="gk-glance-row">
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      <p className="gk-glance-note">HowLongToBeat + Steam · sample data.</p>
    </section>
  );
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.JSX.Element> {
  const { slug } = await params;
  const game = await loadGame(slug);
  if (!game) notFound();

  const statusLabel = STATUS_LABEL[game.status] ?? game.status;
  const releaseDate = formatDate(game.releaseDate);

  const facts: { label: string; value: string }[] = [];
  if (game.developer) facts.push({ label: 'Developer', value: game.developer });
  if (game.publisher && game.publisher !== game.developer)
    facts.push({ label: 'Publisher', value: game.publisher });
  if (releaseDate) facts.push({ label: 'Release', value: releaseDate });
  if (game.engine) facts.push({ label: 'Engine', value: game.engine });
  if (game.ageRatingValue)
    facts.push({
      label: 'Age rating',
      value: `${game.ageRatingSystem ? `${game.ageRatingSystem} ` : ''}${game.ageRatingValue}`,
    });

  const crumbs = [
    { name: 'Home', url: `${siteUrl}/` },
    { name: 'Games', url: `${siteUrl}/games` },
    { name: game.name, url: `${siteUrl}/games/${game.slug}` },
  ];
  const jsonLd: Record<string, unknown>[] = [breadcrumbLd(crumbs), videoGameLd(game, siteUrl)];

  const contentFlags =
    game.contentFlags && hasContentFlagData(game.contentFlags) ? game.contentFlags : null;

  // Award wins (decided, published editions only) — the game-page winner badge.
  const awardWins = await getGameAwardWins(game.slug);

  return (
    <>
      <JsonLd data={jsonLd} />

      <div className="gk-container gk-game">
        <Breadcrumbs
          items={crumbs.map((c) => ({ name: c.name, url: c.url.replace(siteUrl, '') || '/' }))}
        />

        {/* HEADER */}
        <header className="gk-game-head">
          <div className="gk-game-cover">
            <CoverArt
              label={game.name}
              kicker={statusLabel}
              imageUrl={game.coverUrl}
              variant="feature"
            />
          </div>
          <div className="gk-game-head-main">
            <div className="gk-chips">
              <span className={`gk-status gk-status-game-${game.status}`}>{statusLabel}</span>
              {game.series ? <span className="gk-chip">{game.series}</span> : null}
            </div>
            <AwardBadges wins={awardWins} />
            <div className="gk-title-row">
              <h1 className="gk-game-title">{game.name}</h1>
              <FollowButton entityType="game" slug={game.slug} />
            </div>
            {game.summary ? <p className="gk-game-summary">{game.summary}</p> : null}

            {facts.length > 0 ? (
              <dl className="gk-game-facts">
                {facts.map((f) => (
                  <div key={f.label} className="gk-game-fact">
                    <dt>{f.label}</dt>
                    <dd>{f.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}

            <div className="gk-game-taxos">
              {/* B1: genre/platform chips deep-link into the filtered catalog
                  (A1 URLs). Mode chips stay plain — the catalog has no mode
                  facet, and a chip that filters nothing shouldn't pretend to. */}
              {game.genres.map((g) => (
                <a
                  key={`ge-${g}`}
                  className="gk-chip gk-chip-link"
                  href={`/games/browse?genre=${encodeURIComponent(g)}`}
                >
                  {g}
                </a>
              ))}
              {game.platforms.map((p) => (
                <a
                  key={`pl-${p}`}
                  className="gk-chip ghost gk-chip-link"
                  href={`/games/browse?platform=${encodeURIComponent(p)}`}
                >
                  {p}
                </a>
              ))}
              {game.mode.map((m) => (
                <span key={`mo-${m}`} className="gk-chip ghost">
                  {m}
                </span>
              ))}
            </div>
          </div>
        </header>

        {/* The HUB. The aside FLOATS right at a fixed width; the main sections flow
            beside it and then reflow to FULL WIDTH once the aside ends (the standard
            magazine pattern) — so the page never leaves a dead right-hand gap, no
            matter how short the aside is. */}
        <div className="gk-game-body">
          <aside className="gk-game-aside">
            <AtAGlance game={game} />

            {game.relatedTopics.length > 0 ? (
              <section className="gk-panel" aria-label="Related stories">
                <div className="gk-panel-head">
                  <h2 className="gk-panel-title">Related stories</h2>
                </div>
                <ul className="gk-related">
                  {game.relatedTopics.map((r) => (
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

            <RelatedGames games={game.relatedGames} />

            <AdSlot />
          </aside>

          {game.rating ? (
            <RatingBlock rating={game.rating} name={game.name} />
          ) : (
            <section className="gk-panel" aria-label="Ratings">
              <div className="gk-panel-head">
                <h2 className="gk-panel-title">Ratings</h2>
              </div>
              <p className="gk-section-sub" style={{ margin: 0 }}>
                No scores yet — critic, our and community ratings appear here as they land.
              </p>
            </section>
          )}

          <PlayerActivity
            playerCount={game.playerCount}
            history={game.playerCountHistory}
            steamAppId={game.steamAppId}
          />

          {contentFlags ? <ContentFlags flags={contentFlags} /> : null}

          {game.review ? <OurReview review={game.review} name={game.name} /> : null}

          <GameMedia
            videos={game.videos}
            prices={game.prices}
            sysReqs={game.sysReqs}
            dlc={game.dlc}
            gameName={game.name}
          />

          <GameArticles articles={game.articles} />

          {game.description ? (
            <section className="gk-panel" aria-label="About">
              <div className="gk-panel-head">
                <h2 className="gk-panel-title">About {game.name}</h2>
              </div>
              <p className="gk-about-body">{game.description}</p>
            </section>
          ) : null}

          {/* COMMUNITY (I6) — verified ratings + discussion, credibility-weighted. */}
          <section className="gk-panel" aria-label="Community">
            <div className="gk-panel-head">
              <h2 className="gk-panel-title">Community</h2>
            </div>
            <RatingInput gameId={game.id} />
            <Comments
              entityType="game"
              entityId={game.id}
              title="Player discussion"
              initial={await getComments('game', game.id)}
            />
          </section>
        </div>
      </div>
    </>
  );
}
