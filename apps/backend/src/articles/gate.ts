import type { EventKind } from '@gameskeep/shared/constants';
import type { ClusterGateSettings } from './settings';

/**
 * The clustering SECONDARY GATE — pure decision (SPEC I4a §7). Kept free of DB/AI
 * imports so the "resist this auto-merge?" rule is unit-testable in isolation.
 *
 * I3 proved a single cosine threshold structurally over-merges same-game /
 * same-register events (the Cyberpunk "sequel vs sales" pair scored ABOVE a
 * should-merge pair, so no global threshold can satisfy both). This gate is a
 * guard rail on TOP of the cosine merge decision: when the engine would auto-
 * attach an article to a candidate topic, the gate can flip that to "create a new
 * topic instead". It only ever RESISTS a merge — it never forces one — and an
 * editor merge/split still overrides everything.
 */
export interface GateSide {
  gameRef: string | null; // normalized primary game name
  eventKind: EventKind;
}

export interface GateContext {
  incoming: GateSide & { publishDate: Date };
  candidate: GateSide & { lastActivityAt: Date };
}

/**
 * Resist the auto-merge (keep the two as SEPARATE topics) iff ALL hold:
 *   1. same primary game (both sides known + equal),
 *   2. a DIFFERENT, KNOWN event kind (when `requireDifferentEventKind`), and
 *   3. the candidate topic is at least `minEventGapDays` older than the new
 *      article — so a single live news cycle (same day, possibly misclassified)
 *      is never split.
 * Any missing information (no game, `other` event kind) → do NOT resist
 * (conservative: never over-split on absent data).
 */
export function shouldResistMerge(ctx: GateContext, gate: ClusterGateSettings): boolean {
  if (!gate.enabled) return false;

  const { incoming, candidate } = ctx;

  // 1) Same primary game (both sides must be known).
  if (!incoming.gameRef || !candidate.gameRef) return false;
  if (incoming.gameRef !== candidate.gameRef) return false;

  // 2) Different, known event kind.
  if (gate.requireDifferentEventKind) {
    if (incoming.eventKind === 'other' || candidate.eventKind === 'other') return false;
    if (incoming.eventKind === candidate.eventKind) return false;
  }

  // 3) The candidate event is meaningfully older (a distinct later event, not the
  //    same breaking story).
  const gapDays =
    (incoming.publishDate.getTime() - candidate.lastActivityAt.getTime()) / 86_400_000;
  if (gapDays < gate.minEventGapDays) return false;

  return true;
}
