import type { CleanArticle } from './normalize';

/**
 * Detected signals (auto, FACTUAL — not opinion) — SPEC I3 §2, BLUEPRINT 2.2.
 * We capture the raw factual signals here; the bias *scoring* that turns them
 * into the two public axes (Influenced↔Independent, Slop↔Top) is I4.
 *
 * Two inputs combine: signals the provider already asserted (the mock feed sets
 * them explicitly; a live RSS adapter rarely does) PLUS light text/URL detection
 * so a live feed that says nothing still yields the obvious signals. Detection is
 * conservative — better to miss a weak signal than to mislabel an honest article.
 */
export interface DetectedSignals {
  isPaywalled: boolean;
  hasAffiliateLinks: boolean;
  isSponsored: boolean;
  basedOnReviewCopy: boolean;
}

const SPONSORED_RE =
  /\b(sponsored|in partnership with|paid (?:content|post)|advertorial|promoted)\b/i;
const AFFILIATE_RE =
  /\b(affiliate|best deals?|best price|where to buy|discount code|deals? (?:of|this week))\b/i;
const REVIEW_COPY_RE =
  /\b(review (?:copy|code)|provided by the publisher|code (?:was )?provided|early access (?:code|copy))\b/i;

const AFFILIATE_HOST_HINTS = ['/deals', 'tag=', 'aff_', 'utm_campaign=affiliate'];

function matches(text: string, re: RegExp): boolean {
  return re.test(text);
}

export function detectSignals(article: CleanArticle): DetectedSignals {
  const haystack = `${article.title} ${article.excerpt ?? ''}`;
  const url = article.url ?? '';

  const hasAffiliateLinks =
    article.hasAffiliateLinks ||
    matches(haystack, AFFILIATE_RE) ||
    AFFILIATE_HOST_HINTS.some((h) => url.includes(h));

  const isSponsored = article.isSponsored || matches(haystack, SPONSORED_RE);

  const basedOnReviewCopy =
    article.basedOnReviewCopy ||
    matches(haystack, REVIEW_COPY_RE) ||
    // A straight review almost always involved a publisher-provided copy.
    article.articleType === 'review';

  return {
    isPaywalled: article.isPaywalled,
    hasAffiliateLinks,
    isSponsored,
    basedOnReviewCopy,
  };
}
