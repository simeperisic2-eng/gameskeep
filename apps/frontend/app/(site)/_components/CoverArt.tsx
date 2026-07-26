/**
 * Branded cover treatment (SPEC I5a). The demo is OFFLINE and we never scrape an
 * outlet's article image (that would break the same excerpt+link-only safeguard
 * the I1 copyright CHECK enforces). So where a real licensed cover isn't present,
 * this renders a CLEAN, DESIGNED typographic placeholder — a deterministic
 * warm-charcoal/amber panel with a refined monogram — not a blurry giant letter.
 * The `imageUrl` slot is where a licensed IGDB/RAWG game cover (I2 source) drops
 * in for production with no layout change.
 */
const PALETTE: [string, string][] = [
  ['#3a2f1c', '#15120b'],
  ['#33291d', '#14110a'],
  ['#2c2a1a', '#12110a'],
  ['#3a2718', '#150f09'],
  ['#26291e', '#11120b'],
  ['#352513', '#140f08'],
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(label: string): string {
  const words = label.split(/\s+/).filter((w) => /^[a-zA-Z]/.test(w));
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  const w = words[0] ?? label;
  return w.slice(0, 2).toUpperCase();
}

export function CoverArt({
  label,
  kicker,
  imageUrl,
  variant = 'feature',
}: {
  label: string;
  kicker?: string;
  imageUrl?: string | null;
  variant?: 'feature' | 'thumb';
}): React.JSX.Element {
  const [a, b] = PALETTE[hash(label) % PALETTE.length]!;
  const mono = initials(label);
  return (
    <div
      className="gk-cover"
      data-variant={variant}
      style={{ ['--gk-cover-a' as string]: a, ['--gk-cover-b' as string]: b }}
    >
      <div className="gk-cover-art" aria-hidden />
      <div className="gk-cover-frame" aria-hidden />
      {imageUrl ? <img className="gk-cover-img" src={imageUrl} alt="" aria-hidden /> : null}
      {variant === 'feature' ? (
        <div className="gk-cover-text">
          <span className="gk-cover-mono" aria-hidden>
            {mono}
          </span>
          <div>
            {kicker ? <div className="gk-cover-kicker">{kicker}</div> : null}
            <div className="gk-cover-label">{label}</div>
          </div>
        </div>
      ) : (
        <span className="gk-cover-mono center" aria-hidden>
          {mono}
        </span>
      )}
    </div>
  );
}
