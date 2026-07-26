/**
 * schema.org JSON-LD builders (SPEC I5a SEO). Pure functions — no rendering —
 * so the structured data is unit-testable and identical wherever it's emitted.
 * We output the types that earn rich results for a news + ratings platform:
 * NewsArticle (the story), AggregateRating on a VideoGame (where a linked game
 * has scores), and BreadcrumbList. Every value is drawn from the SAME leak-proof
 * public DTO the page renders — the internal assessment is not in that shape.
 */
import { scoreToTen } from './format';
import type {
  CatalogGame,
  GameDetail,
  SourceDetail,
  TopicDetail,
  UpcomingGame,
} from './public-api';

const SITE_NAME = 'GamesKeep';

// [[OWNER-TODO: provide a real 1200×630 social/OG share image at
// public/assets/og-default.png; the logo SVG below is a validating placeholder]]
function shareImage(siteUrl: string): string {
  return `${siteUrl}/assets/logo.svg`;
}

function publisher(siteUrl: string): Record<string, unknown> {
  return {
    '@type': 'Organization',
    name: SITE_NAME,
    url: siteUrl,
    logo: { '@type': 'ImageObject', url: `${siteUrl}/assets/logo.svg` },
  };
}

/** Drop undefined keys so the emitted JSON-LD stays clean for validators. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
  return obj;
}

/** The site-level WebSite node (homepage). */
export function webSiteLd(siteUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: siteUrl,
    description:
      'Gaming news with a bias lens and honest, separated game ratings (critic vs community).',
    publisher: publisher(siteUrl),
  };
}

/** A breadcrumb trail (user + SEO). `items` are ordered root → current. */
export function breadcrumbLd(items: { name: string; url: string }[]): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

/** The story as a NewsArticle (headline, dates, publisher, what it's about). */
export function newsArticleLd(topic: TopicDetail, siteUrl: string): Record<string, unknown> {
  const url = `${siteUrl}/topics/${topic.slug}`;
  return compact({
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: topic.title.slice(0, 110),
    description: topic.tldr ?? topic.aiSummary?.slice(0, 250) ?? undefined,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    image: [shareImage(siteUrl)],
    datePublished: topic.publishedAt ?? undefined,
    dateModified: topic.lastActivityAt ?? topic.publishedAt ?? undefined,
    // Aggregated coverage is bylined to GamesKeep as the curating organization;
    // individual outlet authorship stays on each linked source (we link out).
    author: { '@type': 'Organization', name: SITE_NAME, url: siteUrl },
    publisher: publisher(siteUrl),
    about: topic.primaryGame ? { '@type': 'VideoGame', name: topic.primaryGame.name } : undefined,
    isAccessibleForFree: true,
  });
}

/**
 * A VideoGame node carrying an AggregateRating — emitted ONLY when the primary
 * linked game has a real score AND a non-zero rating count (so it validates and
 * is truthful, never a fabricated rating). Score is the familiar 1–10.
 */
export function videoGameRatingLd(
  topic: TopicDetail,
  siteUrl: string,
): Record<string, unknown> | null {
  const r = topic.gameRating;
  if (!r) return null;
  const headline = r.critics ?? r.our ?? r.community;
  const value = scoreToTen(headline);
  const count = (r.criticsOutletCount ?? 0) + (r.communityCount ?? 0);
  if (value == null || count < 1) return null;
  return compact({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: r.name,
    url: `${siteUrl}/games/${r.slug}`,
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: value,
      bestRating: '10',
      worstRating: '1',
      ratingCount: count,
    },
  });
}

/**
 * The game page's full VideoGame node (SPEC I5b SEO) — identity + metadata, with
 * AggregateRating (only when a real score + count ≥ 1 exists) and our Review
 * (only when we've published one) nested so they earn rich results. Drawn entirely
 * from the same leak-proof public DTO the page renders.
 */
export function videoGameLd(game: GameDetail, siteUrl: string): Record<string, unknown> {
  const url = `${siteUrl}/games/${game.slug}`;
  const node: Record<string, unknown> = compact({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: game.name,
    url,
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    description: game.summary ?? game.description?.slice(0, 250) ?? undefined,
    image: [shareImage(siteUrl)],
    genre: game.genres.length > 0 ? game.genres : undefined,
    gamePlatform: game.platforms.length > 0 ? game.platforms : undefined,
    datePublished: game.releaseDate ?? undefined,
    publisher: game.publisher ? { '@type': 'Organization', name: game.publisher } : undefined,
    author: game.developer ? { '@type': 'Organization', name: game.developer } : undefined,
  });

  // AggregateRating — truthful only: a real headline score + a non-zero count.
  const r = game.rating;
  if (r) {
    const headline = r.critics.score ?? r.our.score ?? r.community.score;
    const value = scoreToTen(headline);
    const count = (r.critics.count ?? 0) + (r.community.count ?? 0);
    if (value != null && count >= 1) {
      node.aggregateRating = {
        '@type': 'AggregateRating',
        ratingValue: value,
        bestRating: '10',
        worstRating: '1',
        ratingCount: count,
      };
    }
  }

  // Our Review — only where we've actually published one with a score.
  const ourValue = scoreToTen(game.review?.ourScore ?? null);
  if (game.review && ourValue != null) {
    node.review = compact({
      '@type': 'Review',
      reviewRating: {
        '@type': 'Rating',
        ratingValue: ourValue,
        bestRating: '10',
        worstRating: '1',
      },
      author: { '@type': 'Organization', name: SITE_NAME, url: siteUrl },
      datePublished: game.review.publishedAt ?? undefined,
      reviewBody: game.review.verdict ?? game.review.body?.slice(0, 280) ?? undefined,
    });
  }

  return node;
}

/**
 * An ItemList of VideoGame nodes (SPEC I5b SEO) for the catalog / upcoming
 * collections — each entry carries name + url, a release date where known, and an
 * AggregateRating ONLY where a real headline score exists (truthful, validating).
 * Drawn from the same leak-proof catalog DTO the page renders.
 */
export function gameCollectionLd(
  games: (CatalogGame | UpcomingGame)[],
  opts: { name: string; url: string; siteUrl: string },
): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: opts.name,
    url: opts.url,
    numberOfItems: games.length,
    itemListElement: games.map((g, i) => {
      const rating = 'critics' in g ? (g.critics ?? g.our ?? g.community ?? null) : null;
      const value = scoreToTen(rating);
      const node: Record<string, unknown> = compact({
        '@type': 'VideoGame',
        name: g.name,
        url: `${opts.siteUrl}/games/${g.slug}`,
        genre: g.genres.length > 0 ? g.genres : undefined,
        gamePlatform: g.platforms.length > 0 ? g.platforms : undefined,
        datePublished: g.releaseDate ?? undefined,
      });
      if (value != null) {
        node.aggregateRating = {
          '@type': 'AggregateRating',
          ratingValue: value,
          bestRating: '10',
          worstRating: '1',
          ratingCount: 1,
        };
      }
      return { '@type': 'ListItem', position: i + 1, item: node };
    }),
  };
}

/**
 * A source outlet as an Organization (SPEC I5b SEO) — name, site, and its parent
 * company where known (the ownership signal, also useful structured data).
 */
export function sourceOrganizationLd(
  source: SourceDetail,
  siteUrl: string,
): Record<string, unknown> {
  return compact({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: source.name,
    url: `${siteUrl}/sources/${source.slug}`,
    sameAs: source.websiteUrl ?? undefined,
    description: source.description ?? undefined,
    parentOrganization: source.parentCompany
      ? { '@type': 'Organization', name: source.parentCompany }
      : undefined,
  });
}
