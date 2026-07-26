/**
 * Display formatting for the public site. Scores are stored 0..100 internally
 * (BLUEPRINT 2.3); the public face is the familiar 1–10, one decimal.
 */

/** 0..100 → "8.4" (1–10, one decimal). Null-safe → null. */
export function scoreToTen(score: number | null | undefined): string | null {
  if (score == null || !Number.isFinite(score)) return null;
  const clamped = Math.max(0, Math.min(100, score));
  return (clamped / 10).toFixed(1);
}

/**
 * Truncate to ~maxChars at a word boundary, appending "…" when cut (the
 * "read more" signal). Null/short text passes through unchanged.
 */
export function truncateWords(text: string | null | undefined, maxChars = 200): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;
  const slice = trimmed.slice(0, maxChars);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s.,;:!–—-]+$/, '')}…`;
}

/** A short relative-time label ("3h ago", "2d ago"). Null-safe → null. */
export function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}
