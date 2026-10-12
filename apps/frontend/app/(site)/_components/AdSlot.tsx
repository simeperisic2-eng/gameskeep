import { getAdSlot } from '@/lib/public-api';
import { isHttpUrl } from '@/lib/url';
import { paidWord } from './PaidLabel';

/**
 * Ad / promoted slot (SPEC I8, Slice 2; BLUEPRINT slot rule). A slot references a
 * configured `slotKey`; if an ACTIVE placement fills it, we render the
 * advertiser's creative WITH a mandatory, prominent "Promoted" label (the
 * transparency rule is not relaxed for our own revenue). The creative is UGC, so
 * it is rendered ESCAPED (React children/attributes — never dangerouslySetInnerHTML)
 * and the CTA is `rel="nofollow sponsored noopener"`. UNSOLD (Phase P S2): the slot
 * renders NOTHING unless `ads.showUnsoldPlaceholder` is on (default off) — then
 * its fallback: the "AD" box, or nothing (`hide`). Never an empty ad box.
 * Owner decision B: a placement may promote a story or a game; the label is
 * "Promoted" either way ("Sponsored" is the outlet's own signal), render-forced,
 * and the headline links to the promoted page.
 */
export async function AdSlot({ slotKey }: { slotKey: string }): Promise<React.JSX.Element | null> {
  const view = await getAdSlot(slotKey);
  const placement = view?.placement ?? null;

  if (placement) {
    const word = paidWord(placement.story ? 'story' : placement.game ? 'game' : 'creative');
    const internal = placement.story
      ? `/topics/${placement.story.slug}`
      : placement.game
        ? `/games/${placement.game.slug}`
        : null;
    return (
      <aside className="gk-slot gk-slot-promoted" aria-label={`${word} content`}>
        <span className="gk-slot-flag">{word}</span>
        <div className="gk-slot-promo">
          {internal ? (
            <a className="gk-slot-promo-headline" href={internal}>
              {placement.headline}
            </a>
          ) : (
            <b className="gk-slot-promo-headline">{placement.headline}</b>
          )}
          {placement.body ? <p className="gk-slot-promo-body">{placement.body}</p> : null}
          <div className="gk-slot-promo-foot">
            <span className="gk-slot-promo-by">Paid promotion · {placement.advertiser}</span>
            {isHttpUrl(placement.ctaUrl) ? (
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

  if (!view?.showPlaceholder || view.fallback === 'hide') return null;
  // 'ad' (demo default) or 'organic' (page renders its own content elsewhere).
  return (
    <div className="gk-slot" role="complementary" aria-label="Advertisement slot">
      AD
      <small>Promoted slot — unsold</small>
    </div>
  );
}
