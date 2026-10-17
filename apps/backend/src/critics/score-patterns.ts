/**
 * Score patterns in an outlet review's title / excerpt (Phase P S5 — "Score this
 * review"). A match is only a SUGGESTION the editor confirms; nothing
 * auto-publishes. Which scales count is an admin rule (letter grades off by
 * default). Two different scores in the same text = ambiguous → no suggestion.
 * PURE; unit-tested.
 */
export interface ScaleRules {
  scaleOutOf10: boolean;
  scaleOutOf5: boolean;
  scaleStars: boolean;
  scaleOutOf100: boolean;
  scaleLetter: boolean;
}
export interface ScoreSuggestion {
  nativeScore: number;
  scaleMax: number;
  /** 0..100 (the canonical critic score). */
  normalized: number;
  match: string;
}

const LETTERS: Record<string, number> = {
  'A+': 100,
  A: 95,
  'A-': 90,
  'B+': 87,
  B: 83,
  'B-': 80,
  'C+': 77,
  C: 73,
  'C-': 70,
  D: 60,
  F: 40,
};

const OUT_OF = (scale: number): RegExp =>
  new RegExp(
    String.raw`(?<![\d./])(\d{1,3}(?:\.\d{1,2})?)\s*(?:\/|out of)\s*${scale}(?![\d/.]\d|\d)`,
    'giu',
  );
const STARS_WORD = /(?<![\d./])(\d(?:\.5)?)\s*(?:-|\s)?stars?\b/giu;
const STARS_GLYPH = /[★☆✩✪]{3,5}(?:½)?/gu;
const LETTER =
  /\b(?:grade|verdict|score|rating)\s*[:\-–—]?\s*(A\+|A-|A|B\+|B-|B|C\+|C-|C|D|F)(?![\p{L}+-])/giu;

function pushIf(list: ScoreSuggestion[], native: number, scaleMax: number, match: string): void {
  if (!Number.isFinite(native) || native < 0 || native > scaleMax) return;
  list.push({
    nativeScore: native,
    scaleMax,
    normalized: Math.round((native / scaleMax) * 100),
    match: match.trim(),
  });
}

function findAll(text: string, rules: ScaleRules): ScoreSuggestion[] {
  const out: ScoreSuggestion[] = [];
  const t = String(text ?? '');
  if (rules.scaleOutOf100)
    for (const m of t.matchAll(OUT_OF(100))) pushIf(out, Number(m[1]), 100, m[0]);
  if (rules.scaleOutOf10)
    for (const m of t.matchAll(OUT_OF(10))) pushIf(out, Number(m[1]), 10, m[0]);
  if (rules.scaleOutOf5) for (const m of t.matchAll(OUT_OF(5))) pushIf(out, Number(m[1]), 5, m[0]);
  if (rules.scaleStars) {
    for (const m of t.matchAll(STARS_WORD)) pushIf(out, Number(m[1]), 5, m[0]);
    for (const m of t.matchAll(STARS_GLYPH)) {
      const g = m[0];
      const full = [...g].filter((c) => c === '★' || c === '✪').length;
      const half = g.includes('½') ? 0.5 : 0;
      const slots = [...g].filter((c) => c !== '½').length;
      if (slots === 5) pushIf(out, full + half, 5, g);
    }
  }
  if (rules.scaleLetter) {
    for (const m of t.matchAll(LETTER)) {
      const grade = m[1]!.toUpperCase();
      if (grade in LETTERS) pushIf(out, LETTERS[grade]!, 100, m[0]);
    }
  }
  return out;
}

/** The suggestion for an article: the title first, then the excerpt; ambiguity → null. */
export function detectScore(
  title: string | null | undefined,
  excerpt: string | null | undefined,
  rules: ScaleRules,
): ScoreSuggestion | null {
  for (const text of [title, excerpt]) {
    const found = findAll(text ?? '', rules);
    if (found.length === 0) continue;
    const distinct = new Set(found.map((f) => f.normalized));
    return distinct.size === 1 ? found[0]! : null;
  }
  return null;
}
