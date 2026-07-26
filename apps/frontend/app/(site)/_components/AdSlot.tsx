/**
 * Ad / promoted slot (BLUEPRINT global rule: every page has ≥1 slot). Empty +
 * labeled "AD" in demo — no real ad-serving/payment (that's the I8 ad-management
 * dashboard). The slot exists from day one so monetization needs no refactor; a
 * sold slot renders page-native content in its place.
 */
export function AdSlot({ label = 'AD' }: { label?: string }): React.JSX.Element {
  return (
    <div className="gk-slot" role="complementary" aria-label="Advertisement slot">
      {label}
      <small>Promoted slot — unsold</small>
    </div>
  );
}
