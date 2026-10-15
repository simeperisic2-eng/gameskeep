import type { ListLineKey } from '@gameskeep/shared/constants';

/**
 * Editorial-list rules (Phase P S4) — PURE (no IO), unit-tested.
 *
 * - detectListCandidate: does a feed title look like an outlet's official list?
 * - parseEntries: ranked lines pasted by an editor → entries.
 * - computeConsensus: per (year, category) — games ranked by appearances, then
 *   average rank, then best rank, then name; plus comparison lines (data only).
 */

const YEAR_RE = /\b(19[7-9]\d|20\d{2})\b/;

/** A title phrase match (lowercase, word-bounded at letter/digit edges). */
function hasPhrase(title: string, phrase: string): boolean {
  const p = phrase.trim().toLowerCase();
  if (!p) return false;
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const start = /^[\p{L}\p{N}]/u.test(p) ? '(?<![\\p{L}\\p{N}])' : '';
  const end = /[\p{L}\p{N}]$/u.test(p) ? '(?![\\p{L}\\p{N}])' : '';
  return new RegExp(`${start}${esc}${end}`, 'u').test(title.toLowerCase());
}

export function detectListCandidate(
  title: string,
  lexicon: { patterns: string[]; gotyPatterns: string[] },
): { year: number | null; categoryKey: 'goty' | 'best-of-year' } | null {
  const t = (title ?? '').trim();
  if (!t || !lexicon.patterns.some((p) => hasPhrase(t, p))) return null;
  const m = YEAR_RE.exec(t);
  return {
    year: m ? Number(m[1]) : null,
    categoryKey: lexicon.gotyPatterns.some((p) => hasPhrase(t, p)) ? 'goty' : 'best-of-year',
  };
}

/**
 * Ranked lines → entries. "1. Name", "1) Name", "#1 Name", "1 - Name", "1: Name"
 * keep their number; an unnumbered line takes the next rank. Blank lines and
 * over-long names are dropped; at most 200 entries; ranks 1–500.
 */
export function parseEntries(text: string): { rank: number; name: string }[] {
  const out: { rank: number; name: string }[] = [];
  let next = 1;
  for (const rawLine of String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^#?\s*(\d{1,3})\s*(?:[.):\-–—]\s*|\s+)(.+)$/.exec(line);
    let rank: number;
    let name: string;
    if (m) {
      rank = Number(m[1]);
      name = m[2]!.trim();
    } else {
      rank = next;
      name = line;
    }
    name = name.replace(/\s+/g, ' ').slice(0, 300).trim();
    if (!name || rank < 1 || rank > 500) continue;
    out.push({ rank, name });
    next = rank + 1;
    if (out.length >= 200) break;
  }
  return out;
}

export interface ConsensusList {
  id: string;
  outlet: string;
  url: string | null;
  entries: { rank: number; gameId: string | null }[];
}
export interface ConsensusRow {
  gameId: string;
  appearances: number;
  avgRank: number;
  bestRank: number;
  worstRank: number;
  positions: { listId: string; outlet: string; rank: number; url: string | null }[];
  inConsensus: boolean;
  position: number | null;
  lines: { key: ListLineKey; text: string }[];
}

/**
 * One (year, category): every game with ≥ 1 appearance gets a row (its lines feed
 * the game page); rows with ≥ `minAppearances` form the consensus. A game listed
 * twice on one list counts once, at its best rank.
 */
export function computeConsensus(
  lists: ConsensusList[],
  opts: { minAppearances: number; deviationTopN: number },
  nameOf: (gameId: string) => string = (id) => id,
): ConsensusRow[] {
  const minApp = Math.max(2, Math.floor(opts.minAppearances));
  const byGame = new Map<string, ConsensusRow['positions']>();
  for (const l of lists) {
    const best = new Map<string, number>();
    for (const e of l.entries) {
      if (!e.gameId || !Number.isInteger(e.rank) || e.rank < 1) continue;
      const prev = best.get(e.gameId);
      if (prev === undefined || e.rank < prev) best.set(e.gameId, e.rank);
    }
    for (const [gameId, rank] of best) {
      const arr = byGame.get(gameId) ?? [];
      arr.push({ listId: l.id, outlet: l.outlet, rank, url: l.url });
      byGame.set(gameId, arr);
    }
  }
  const n = lists.length;
  const rows: ConsensusRow[] = [...byGame.entries()].map(([gameId, positions]) => {
    const ranks = positions.map((p) => p.rank);
    const sorted = [...positions].sort(
      (a, b) => a.rank - b.rank || a.outlet.localeCompare(b.outlet),
    );
    const appearances = positions.length;
    const avgRank = Math.round((ranks.reduce((s, r) => s + r, 0) / appearances) * 100) / 100;
    const bestRank = Math.min(...ranks);
    const worstRank = Math.max(...ranks);
    const lines: ConsensusRow['lines'] = [];
    // "#1 at X; absent from every other outlet's top N" — data only.
    const ones = positions.filter((p) => p.rank === 1);
    if (n >= 2 && ones.length === 1) {
      const solo = ones[0]!;
      const elsewhere = lists.filter((l) => l.id !== solo.listId);
      const inOtherTop = positions.some(
        (p) => p.listId !== solo.listId && p.rank <= opts.deviationTopN,
      );
      if (elsewhere.length > 0 && !inOtherTop) {
        lines.push({
          key: 'soloTop',
          text: `#1 at ${solo.outlet}; absent from every other outlet’s top ${opts.deviationTopN}`,
        });
      }
    }
    lines.push({ key: 'coverage', text: `On ${appearances} of ${n} lists` });
    if (appearances >= 2 && bestRank !== worstRank) {
      const hi = sorted[0]!;
      const lo = [...sorted].reverse().find((p) => p.rank === worstRank)!;
      lines.push({
        key: 'spread',
        text: `#${hi.rank} at ${hi.outlet} to #${lo.rank} at ${lo.outlet}`,
      });
    }
    return {
      gameId,
      appearances,
      avgRank,
      bestRank,
      worstRank,
      positions: sorted,
      inConsensus: appearances >= minApp,
      position: null,
      lines,
    };
  });
  rows.sort(
    (a, b) =>
      b.appearances - a.appearances ||
      a.avgRank - b.avgRank ||
      a.bestRank - b.bestRank ||
      nameOf(a.gameId).localeCompare(nameOf(b.gameId)),
  );
  let pos = 0;
  for (const r of rows) if (r.inConsensus) r.position = ++pos;
  return rows;
}
