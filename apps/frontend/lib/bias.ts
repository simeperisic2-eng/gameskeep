/**
 * Plain-language bias readouts (SPEC I5a, Ground-News pattern; Phase P S1). A
 * bias display pairs a compact visual with a sentence a first-time visitor can
 * actually read. Pure + unit-testable; no rendering here.
 *
 * Phase P S1 posture: prove presence, never absence. Where no signal was found
 * the label is "No signals found" — never "independent"/"clean". What renders
 * where is the display scope (decided server-side per row; topic-level here).
 */
import type { BiasDisplayScope } from '@gameskeep/shared/constants';
import { label } from './labels';
import type { InfluenceFlag, IntegrityTally, TopicFlagTally } from './public-api';

export type BiasTone = 'good' | 'mixed' | 'warn';

/** The public empty state for signals. We can show what we found, not prove absence. */
/** The registry default (tests); render through noSignalsLabel(). */
export const NO_SIGNALS_LABEL = 'No signals found';
/** The no-signals label as currently set (Control Panel → Copy → labels). */
export const noSignalsLabel = (): string => label('label.noSignals');

/** One-line explainer used in tooltips and the Methodology page. */
export const NO_SIGNALS_EXPLAINER = 'We can show what we found; we cannot prove what isn’t there.';
export const noSignalsExplainer = (): string => label('label.noSignalsExplainer');

/**
 * The once-per-block note (hygiene 3): rows show the short label only; the block
 * that lists them explains it once.
 */
export const NO_SIGNALS_NOTE = `“${NO_SIGNALS_LABEL}” means we checked for sponsorship, affiliate links, review copy and opinion framing and found none. ${NO_SIGNALS_EXPLAINER}`;

/** The fields that decide whether a coverage row renders the "No signals found" label. */
export interface SignalRowLike {
  biasMode: 'panel' | 'chip' | 'none';
  flags: readonly string[];
  isReview?: boolean;
  integrity?: readonly unknown[] | null;
}

/**
 * Whether a row renders the "No signals found" label — mirrors the row markup: a
 * review panel shows it in its integrity block when no integrity row is public; a
 * news panel shows it as its only chip when it carries no flag. Chip/none never do.
 */
export function rowShowsNoSignals(row: SignalRowLike): boolean {
  if (row.biasMode !== 'panel') return false;
  if (row.isReview) return (row.integrity?.length ?? 0) === 0;
  return row.flags.length === 0;
}

// ── influence FLAGS (factual labels, not a scale) ────────────────────────────
// The influence axis is mostly binary facts, so the public UI names the actual
// signals present instead of a fake "% influenced" bar. These are labels (what
// the coverage carries), never a verdict — neutral/amber in the UI, never red.

export const FLAG_LABEL: Record<InfluenceFlag, string> = {
  get sponsored() {
    return label('label.flag.sponsored');
  },
  get affiliate() {
    return label('label.flag.affiliate');
  },
  get reviewCopy() {
    return label('label.flag.reviewCopy');
  },
  get opinion() {
    return label('label.flag.opinion');
  },
};

/** Canonical render order for the four flags. */
const FLAG_ORDER: InfluenceFlag[] = ['sponsored', 'affiliate', 'reviewCopy', 'opinion'];

/** One part of a topic-level flag distribution, e.g. "1 sponsored". */
export interface FlagPart {
  key: string;
  label: string;
  kind: 'nosignal' | 'signal';
}

/**
 * Topic-level flag distribution → render parts ("2 sponsored · 4 with no signals
 * found"). Present signals first, then the neutral no-signal count. Counts come
 * straight from the stored public breakdowns (facts, not a score).
 */
export function flagParts(tally: TopicFlagTally, integrity?: IntegrityTally): FlagPart[] {
  const parts: FlagPart[] = [];
  for (const f of FLAG_ORDER) {
    const n = tally[f];
    if (n > 0) parts.push({ key: f, label: `${n} ${FLAG_LABEL[f].toLowerCase()}`, kind: 'signal' });
  }
  // Review-integrity rows found on the story's reviews (review copy is a flag above).
  if (integrity?.embargo) {
    parts.push({ key: 'embargo', label: `${integrity.embargo} embargo`, kind: 'signal' });
  }
  if (integrity?.sponsoredEvent) {
    parts.push({
      key: 'sponsoredEvent',
      label: `${integrity.sponsoredEvent} sponsored event / press trip`,
      kind: 'signal',
    });
  }
  if (tally.independent > 0) {
    parts.push({
      key: 'nosignal',
      label: `${tally.independent} with ${noSignalsLabel().toLowerCase()}`,
      kind: 'nosignal',
    });
  }
  return parts;
}

/**
 * The compact topic token for dense spots (trending list, cards). Default scope:
 * a Sponsored token only when a sponsored article is present, otherwise nothing.
 * Scope `all`: the leading signal (+N) or the neutral no-signal label.
 */
export function compactTopicToken(
  tally: TopicFlagTally,
  scope: BiasDisplayScope,
  integrity?: IntegrityTally,
): { kind: 'nosignal' | 'signal'; label: string } | null {
  if (scope !== 'all')
    return tally.sponsored > 0 ? { kind: 'signal', label: FLAG_LABEL.sponsored } : null;
  const present: string[] = FLAG_ORDER.filter((f) => tally[f] > 0).map((f) => FLAG_LABEL[f]);
  if (integrity?.embargo) present.push(label('label.integrity.embargo'));
  if (integrity?.sponsoredEvent) present.push(label('label.integrity.pressTrip'));
  if (present.length === 0) return { kind: 'nosignal', label: noSignalsLabel() };
  const first = present[0]!;
  return {
    kind: 'signal',
    label: present.length === 1 ? first : `${first} +${present.length - 1}`,
  };
}

export interface BiasReadout {
  /** Short label, e.g. "Mostly quality". */
  phrase: string;
  tone: BiasTone;
}

/** Quality axis (Low-effort / AI ↔ Quality) → words (only rendered while shown). */
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
