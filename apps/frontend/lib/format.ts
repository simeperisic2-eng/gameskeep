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

/** Letters + digits only, lower-cased (curly/straight quotes, dashes, spacing ignored). */
function headlineKey(text: string): string {
  return text
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * A subtitle worth showing under a title (hygiene 3): null when it is empty or only
 * repeats the title (feeds often send the headline as the description).
 */
export function distinctSubtitle(
  title: string | null | undefined,
  subtitle: string | null | undefined,
): string | null {
  const sub = subtitle?.trim();
  if (!sub) return null;
  const key = headlineKey(sub);
  if (!key) return null;
  return key === headlineKey(title ?? '') ? null : sub;
}

/**
 * Topic status chip label for PUBLIC pages (hygiene 3). "Resolved" is internal
 * clustering state, not reader information — it renders nothing.
 */
export function publicTopicStatus(status: string | null | undefined): string | null {
  if (status === 'developing') return 'Developing';
  if (status === 'ongoing') return 'Ongoing';
  return null;
}

/** A Δ window as shown on a card: "48h" under three days, else whole days ("7d"). */
export function windowLabel(hours: number | null | undefined): string | null {
  if (hours == null || !Number.isFinite(hours) || hours <= 0) return null;
  const h = Math.round(hours);
  return h < 72 || h % 24 !== 0 ? `${h}h` : `${h / 24}d`;
}

/**
 * A Δ as text (Phase P S2). "New" when the previous window was empty, "—" when
 * there isn't enough history — never "0%" or a guess. Minus is a real minus.
 */
export function deltaText(
  delta: { kind: 'pct'; value: number } | { kind: 'new' } | { kind: 'none' } | null | undefined,
): string | null {
  if (!delta) return null;
  if (delta.kind === 'new') return 'New';
  if (delta.kind === 'none') return '—';
  if (!Number.isFinite(delta.value)) return '—';
  const v = Math.round(delta.value);
  return v === 0 ? '±0%' : `${v > 0 ? '+' : '−'}${Math.abs(v)}%`;
}

/**
 * Drop a summary's first sentence when it only repeats the headline (the
 * extractive summarizer often opens with it). Null-safe; never empties a summary.
 */
export function stripLeadingTitle(
  summary: string | null | undefined,
  title: string | null | undefined,
): string | null {
  const s = summary?.trim();
  if (!s) return null;
  const titleKey = headlineKey(title ?? '');
  if (!titleKey) return s;
  const m = s.match(/^(.+?[.!?])\s+(\S[\s\S]*)$/);
  if (!m) return s;
  return headlineKey(m[1]!) === titleKey ? m[2]!.trim() : s;
}

/** "Oct 3, 2026" in UTC (stable across server + client). Null-safe → null. */
export function shortDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}
