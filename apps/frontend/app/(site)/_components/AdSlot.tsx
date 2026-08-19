import { getAdSlot } from '@/lib/public-api';

/**
 * Ad / promoted slot (SPEC I8, Slice 2; BLUEPRINT slot rule). A slot references a
 * configured `slotKey`; if an ACTIVE placement fills it, we render the
 * advertiser's creative WITH a mandatory, prominent "Promoted" label (the
 * transparency rule is not relaxed for our own revenue). The creative is UGC, so
 * it is rendered ESCAPED (React children/attributes — never dangerouslySetInnerHTML)
 * and the CTA is `rel="nofollow sponsored noopener"`. When unsold, the slot shows
 * its fallback: the demo "AD" box, or nothing (`hide`) — never an empty ad box.
 */
export async function AdSlot({ slotKey }: { slotKey: string }): Promise<React.JSX.Element | null> {
  const view = await getAdSlot(slotKey);
  const placement = view?.placement ?? null;

  if (placement) {
    return (
      <aside className="gk-slot gk-slot-promoted" aria-label="Promoted content">
        <span className="gk-slot-flag">Promoted</span>
        <div className="gk-slot-promo">
          <b className="gk-slot-promo-headline">{placement.headline}</b>
          {placement.body ? <p className="gk-slot-promo-body">{placement.body}</p> : null}
          <div className="gk-slot-promo-foot">
            <span className="gk-slot-promo-by">Paid promotion · {placement.advertiser}</span>
            {placement.ctaUrl ? (
              <a
                className="gk-slot-promo-cta"
                href={placement.ctaUrl}
                rel="nofollow sponsored noopener"
                target="_blank"
              >
                {placement.ctaLabel ?? 'Learn more'} ↗
              </a>
            ) : null}
          </div>
        </div>
      </aside>
    );
  }

  if (view?.fallback === 'hide') return null;
  // 'ad' (demo default) or 'organic' (page renders its own content elsewhere).
  return (
    <div className="gk-slot" role="complementary" aria-label="Advertisement slot">
      AD
      <small>Promoted slot — unsold</small>
    </div>
  );
}
