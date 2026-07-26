/**
 * Round source attribution badge (BLUEPRINT 3.3). A deterministic amber-tinted
 * monogram of the outlet's name — NOT the outlet's logo or its scraped article
 * image (that would break the excerpt+link-only copyright posture the I1 CHECK
 * enforces). The `logoUrl` slot is where an owner-supplied, licensed source logo
 * can drop in later with no layout change.
 */
function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w));
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  return (words[0] ?? name).slice(0, 2).toUpperCase();
}

const HUES = [38, 30, 45, 22, 50];

export function SourceIcon({ name }: { name: string }): React.JSX.Element {
  const hue = HUES[hash(name) % HUES.length]!;
  return (
    <span
      className="gk-srcicon"
      aria-hidden
      style={{ ['--gk-srcicon-hue' as string]: String(hue) }}
    >
      {initials(name)}
    </span>
  );
}
