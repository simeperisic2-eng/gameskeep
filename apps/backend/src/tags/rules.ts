import type { GameTagSource, TagFamily } from '@gameskeep/shared/constants';

/**
 * Pure tag rules (Phase P S3) — no DB, unit-tested. The service feeds them rows;
 * the public layer and the moderation queue both read their answers.
 */

/** "Open World", "open_world", " open-world " → "open-world". */
export function normalizeTagName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\+/g, ' plus ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-plus$/, '')
    .slice(0, 120);
}

export interface MatchableTag {
  id: string;
  slug: string;
  name: string;
  aliases: string[];
  active: boolean;
}

/** The taxonomy tag a free-form name maps onto (slug, name or alias), if any. */
export function matchTag<T extends MatchableTag>(raw: string, tags: T[]): T | null {
  const key = normalizeTagName(raw);
  if (!key) return null;
  for (const t of tags) {
    if (!t.active) continue;
    if (t.slug === key || normalizeTagName(t.name) === key) return t;
    if (t.aliases.some((a) => normalizeTagName(a) === key)) return t;
  }
  return null;
}

export interface ScoredVote {
  credibility: number; // 0..1
  createdAt: Date;
}

/**
 * The credibility-weighted score: Σ credibility of the votes at or above the
 * floor (a brigade of fresh accounts adds NOTHING — the same floor rule as the
 * S2 Trending engagement). Rounded to 3 decimals.
 */
export function tagScore(votes: ScoredVote[], minCredibility: number): number {
  let s = 0;
  for (const v of votes) if (v.credibility >= minCredibility) s += v.credibility;
  return Math.round(s * 1000) / 1000;
}

export interface SpikeSettings {
  burstWindowHours: number;
  burstMinVotes: number;
  burstMultiplier: number;
  minCredibility: number;
  lowCredibilityShare: number;
}

export interface SpikeResult {
  flagged: boolean;
  windowCount: number;
  historicalRate: number;
  lowShare: number;
}

/**
 * A vote SPIKE made mostly of low-credibility accounts (the anomaly flag). Two
 * conditions, both needed: an abnormal volume in the window (≥ min votes and ≥
 * multiplier × the historical per-window rate), and at least `lowCredibilityShare`
 * of those votes below the credibility floor. A legitimate wave of credible
 * players is a spike but not flagged.
 */
export function detectTagSpike(votes: ScoredVote[], s: SpikeSettings, now: number): SpikeResult {
  const windowMs = s.burstWindowHours * 3_600_000;
  const start = now - windowMs;
  const inWindow = votes.filter((v) => v.createdAt.getTime() >= start);
  const prior = votes.filter((v) => v.createdAt.getTime() < start);
  let historicalRate = 0;
  if (prior.length > 0) {
    const earliest = Math.min(...prior.map((v) => v.createdAt.getTime()));
    historicalRate = prior.length / (Math.max(start - earliest, windowMs) / windowMs);
  }
  const windowCount = inWindow.length;
  const low = inWindow.filter((v) => v.credibility < s.minCredibility).length;
  const lowShare = windowCount ? low / windowCount : 0;
  const isBurst =
    windowCount >= s.burstMinVotes && windowCount >= s.burstMultiplier * historicalRate;
  return {
    flagged: isBurst && lowShare >= s.lowCredibilityShare,
    windowCount,
    historicalRate: Math.round(historicalRate * 1000) / 1000,
    lowShare: Math.round(lowShare * 1000) / 1000,
  };
}

export type IssueStatus = 'active' | 'past' | 'resolved';

/**
 * An issue tag's public state. Resolved (with its patch) wins. Only VOTE-DRIVEN
 * issue tags expire (owner, S3 (d)): after `expiryDays` without fresh signal —
 * the latest of a fresh vote or an editor's confirmation — they read "Past issue".
 * Editor-added and migrated ones stay until an editor resolves or removes them.
 */
export function issueStatus(
  t: {
    source: GameTagSource;
    resolvedAt: Date | null;
    firstSeenAt: Date;
    lastVoteAt: Date | null;
    lastConfirmedAt: Date | null;
  },
  expiryDays: number,
  now: number,
): IssueStatus {
  if (t.resolvedAt) return 'resolved';
  if (t.source !== 'players') return 'active';
  const fresh = Math.max(
    t.firstSeenAt.getTime(),
    t.lastVoteAt?.getTime() ?? 0,
    t.lastConfirmedAt?.getTime() ?? 0,
  );
  return now - fresh > expiryDays * 86_400_000 ? 'past' : 'active';
}

/** The truthful provenance line — issue tags only; content tags show none (owner, S3 (c)). */
export function provenanceLine(family: TagFamily, source: GameTagSource): string | null {
  if (family !== 'issue') return null;
  if (source === 'players') return 'Reported by players · confirmed by editors';
  if (source === 'editors') return 'Added by editors';
  return null; // imports only ever map onto content tags — never claim a source we lack
}

/** Whether a player-reported tag may be confirmed (the threshold half of the gate). */
export function thresholdReached(weightedScore: number, threshold: number): boolean {
  return weightedScore + 1e-9 >= threshold;
}
