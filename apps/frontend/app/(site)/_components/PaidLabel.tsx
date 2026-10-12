import type { PaidInfo } from '@/lib/public-api';

/** The label word for a paid item: a story is "Sponsored", a game (or a plain ad) "Promoted". */
export function paidWord(kind: PaidInfo['kind'] | 'creative'): 'Sponsored' | 'Promoted' {
  return kind === 'story' ? 'Sponsored' : 'Promoted';
}

/**
 * The paid-item label (owner decision B; EU rules on hidden advertising and
 * undisclosed paid ranking). RENDER-FORCED: every paid item renders this, and no
 * prop, setting or role can hide it. Advertiser text is UGC — React-escaped.
 */
export function PaidLabel({
  paid,
  compact = false,
}: {
  paid: { advertiser: string; kind: PaidInfo['kind'] | 'creative' };
  compact?: boolean;
}): React.JSX.Element {
  return (
    <span
      className={`gk-paid${compact ? ' is-compact' : ''}`}
      aria-label={`${paidWord(paid.kind)} content`}
    >
      <span className="gk-slot-flag">{paidWord(paid.kind)}</span>
      {compact ? null : <span className="gk-paid-by">Paid promotion · {paid.advertiser}</span>}
    </span>
  );
}
