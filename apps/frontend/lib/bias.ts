/**
 * Plain-language bias readouts (SPEC I5a, Ground-News pattern). A bias bar pairs
 * a compact visual with a sentence a first-time visitor can actually read — no
 * raw "avg 0.0/10". Pure + unit-testable; no rendering here.
 */
import type { InfluenceFlag, TopicFlagTally } from './public-api';

export type BiasTone = 'good' | 'mixed' | 'warn';

// ── influence FLAGS (factual labels, not a scale) ────────────────────────────
// The influence axis is mostly binary facts, so the public UI names the actual
// signals present instead of a fake "% influenced" bar. These are labels (what
// the coverage carries), never a verdict — neutral/amber in the UI, never red.

export const FLAG_LABEL: Record<InfluenceFlag, string> = {
  sponsored: 'Sponsored',
  affiliate: 'Affiliate',
  reviewCopy: 'Review copy',
  opinion: 'Opinion',
};

/** Canonical render order for the four flags. */
const FLAG_ORDER: InfluenceFlag[] = ['sponsored', 'affiliate', 'reviewCopy', 'opinion'];

/** One part of a topic-level flag distribution, e.g. "5 independent" / "1 sponsored". */
export interface FlagPart {
  key: string;
  label: string;
  kind: 'independent' | 'signal';
}

/**
 * Topic-level flag distribution → render parts ("5 independent · 1 sponsored").
 * Independent first, then any present signal flags, lower-cased into the count
 * phrase. Counts come straight from the stored breakdowns (facts, not a score).
 */
export function flagParts(tally: TopicFlagTally): FlagPart[] {
  const parts: FlagPart[] = [];
  if (tally.independent > 0) {
    parts.push({
      key: 'independent',
      label: `${tally.independent} independent`,
      kind: 'independent',
    });
  }
  for (const f of FLAG_ORDER) {
    const n = tally[f];
    if (n > 0) parts.push({ key: f, label: `${n} ${FLAG_LABEL[f].toLowerCase()}`, kind: 'signal' });
  }
  return parts;
}

/**
 * A compact single-token summary of a topic's flags for dense spots (the trending
 * list): "Independent" when nothing fires, else the leading signal + "+N" extra.
 */
export function topicFlagSummary(tally: TopicFlagTally): {
  kind: 'independent' | 'signal';
  label: string;
} {
  const present = FLAG_ORDER.filter((f) => tally[f] > 0);
  if (present.length === 0) return { kind: 'independent', label: 'Independent' };
  const first = FLAG_LABEL[present[0]!];
  return {
    kind: 'signal',
    label: present.length === 1 ? first : `${first} +${present.length - 1}`,
  };
}

export interface BiasReadout {
  /** Short label, e.g. "Mostly independent" or "5 of 5 independent". */
  phrase: string;
  tone: BiasTone;
}

/** Quality axis (Low-effort / AI ↔ Quality) → words. */
export function qualityReadout(top: number, slop: number): BiasReadout {
  const total = top + slop;
  if (total === 0) return { phrase: 'No quality data', tone: 'mixed' };
  if (slop === 0) return { phrase: `${top} of ${total} high-effort`, tone: 'good' };
  if (top === 0) return { phrase: `${slop} of ${total} low-effort`, tone: 'warn' };
  const ratio = top / total;
  if (ratio >= 0.8) return { phrase: 'Mostly quality', tone: 'good' };
  if (ratio >= 0.6) return { phrase: 'Leans quality', tone: 'good' };
  if (ratio > 0.4) return { phrase: 'Mixed quality', tone: 'mixed' };
  if (ratio >= 0.2) return { phrase: 'Often low-effort', tone: 'warn' };
  return { phrase: 'Mostly low-effort', tone: 'warn' };
}
