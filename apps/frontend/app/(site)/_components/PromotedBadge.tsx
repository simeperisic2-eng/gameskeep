import type { GamePromotion } from '@/lib/public-api';
import { isHttpUrl } from '@/lib/url';

/**
 * "Promoted" badge on a game page (SPEC I8, Slice 2) when the game has an ACTIVE
 * paid placement. Transparency rule: it's labeled as prominently as a bias flag —
 * whoever pays gets the promotion, but the reader always knows it's paid. The
 * advertiser text is UGC (React-escaped); the link is nofollow/sponsored.
 */
export function PromotedBadge({
  promotion,
}: {
  promotion: GamePromotion | null;
}): React.JSX.Element | null {
  if (!promotion) return null;
  const inner = (
    <>
      <span className="gk-promoted-flag">Promoted</span>
      <span className="gk-promoted-text">Paid promotion · {promotion.advertiser}</span>
    </>
  );
  return isHttpUrl(promotion.ctaUrl) ? (
    <a
      className="gk-promoted-badge"
      href={promotion.ctaUrl}
      rel="nofollow sponsored noopener"
      target="_blank"
    >
      {inner}
      <span aria-hidden="true"> ↗</span>
    </a>
  ) : (
    <div className="gk-promoted-badge">{inner}</div>
  );
}
