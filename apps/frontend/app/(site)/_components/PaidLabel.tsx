import type { PaidInfo } from '@/lib/public-api';

/**
 * The label word for ANY paid item — game, story or plain creative — is
 * "Promoted" (owner, S2 review). "Sponsored" is reserved for an outlet's own
 * sponsored article (the bias signal), so a reader can tell whether WE or the
 * OUTLET were paid. The kind stays in the data; it no longer changes the word.
 */
export function paidWord(_kind: PaidInfo['kind'] | 'creative'): 'Promoted' {
  return 'Promoted';
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
