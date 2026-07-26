import { EVENT_KIND_PRIORITY, type EventKind } from '@gameskeep/shared/constants';

/**
 * Event-kind classifier for the clustering secondary gate (SPEC I4a §7). This is
 * MECHANICAL, FACTUAL keyword detection — the same spirit as I3's signal regexes
 * — NOT content-NLP or any judgmental read of the article. It answers only "what
 * KIND of event is this" (a delay vs a sales milestone vs a patch) so the gate
 * can resist same-game / different-event over-merges.
 *
 * The keyword lexicon is admin-tunable (loaded from `app_settings`); the priority
 * order that breaks ties is structural and lives in `@gameskeep/shared`. `other`
 * is returned when nothing matches — and the gate never fires on `other`, so a
 * missing classification can never CAUSE an over-split.
 */
export function classifyEventKind(text: string, lexicon: Record<string, string[]>): EventKind {
  const hay = (text ?? '').toLowerCase();
  if (!hay) return 'other';
  for (const kind of EVENT_KIND_PRIORITY) {
    const keywords = lexicon[kind];
    if (!Array.isArray(keywords)) continue;
    for (const kw of keywords) {
      if (kw && hay.includes(kw)) return kind;
    }
  }
  return 'other';
}

/**
 * Normalize a raw game reference to a stable comparison key (lowercased, trimmed).
 * Returns null for an empty/missing ref so the gate can fall through safely.
 */
export function normalizeGameRef(ref: string | null | undefined): string | null {
  if (typeof ref !== 'string') return null;
  const trimmed = ref.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : null;
}
