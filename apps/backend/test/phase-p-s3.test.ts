import { describe, it, expect } from 'vitest';
import { TAG_SEED } from '@gameskeep/shared/constants';
import { tagSettingsPatch, tagSuggestionDecision } from '@gameskeep/shared/validation';
import {
  detectTagSpike,
  issueStatus,
  matchTag,
  normalizeTagName,
  provenanceLine,
  tagScore,
  thresholdReached,
} from '../src/tags/rules';
import { coerceTagSettings, TAG_SETTINGS_DEFAULTS } from '../src/tags/settings';
import { cardTags, type GameTagGroups } from '../src/tags/service';

// Hermetic (no DB): the Phase P S3 tag rules. Live behaviour (gate, votes,
// filters, tag pages, quick view) is proven by scripts/p-check.mjs S3.

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 9, 12);
const at = (daysAgo: number): Date => new Date(NOW - daysAgo * DAY);

describe('names map onto the taxonomy', () => {
  const tax = TAG_SEED.map((t, i) => ({
    id: String(i),
    slug: t.slug,
    name: t.name,
    aliases: [...t.aliases],
    active: true,
  }));
  it('normalizes spelling, case and separators', () => {
    expect(normalizeTagName('  Open_World ')).toBe('open-world');
    expect(normalizeTagName('LGBTQ+')).toBe('lgbtq');
    expect(normalizeTagName('Rogue-Like!')).toBe('rogue-like');
    expect(normalizeTagName('***')).toBe('');
  });
  it('matches by slug, name or alias; unknown names do not match', () => {
    expect(matchTag('singleplayer', tax)?.slug).toBe('single-player');
    expect(matchTag('Story Rich', tax)?.slug).toBe('story-rich');
    expect(matchTag('co-op', tax)?.slug).toBe('co-op');
    expect(matchTag('metroidvania', tax)).toBeNull();
  });
  it('a retired tag never matches', () => {
    const retired = tax.map((t) => (t.slug === 'horror' ? { ...t, active: false } : t));
    expect(matchTag('horror', retired)).toBeNull();
  });
});

describe('the publication gate', () => {
  it('votes below the credibility floor add nothing (a brigade of fresh accounts)', () => {
    const ring = Array.from({ length: 20 }, () => ({ credibility: 0.45, createdAt: at(0) }));
    expect(tagScore(ring, 0.5)).toBe(0);
    expect(thresholdReached(tagScore(ring, 0.5), 3)).toBe(false);
  });
  it('credible votes sum their credibility', () => {
    const v = [0.79, 0.79, 0.79, 0.79].map((c) => ({ credibility: c, createdAt: at(1) }));
    expect(tagScore(v, 0.5)).toBeCloseTo(3.16, 3);
    expect(thresholdReached(3.16, 3)).toBe(true);
    expect(thresholdReached(2.999, 3)).toBe(false);
  });
});

describe('the anomaly flag', () => {
  const s = {
    burstWindowHours: 24,
    burstMinVotes: 5,
    burstMultiplier: 3,
    minCredibility: 0.5,
    lowCredibilityShare: 0.6,
  };
  it('a low-credibility spike is flagged', () => {
    const v = Array.from({ length: 8 }, () => ({ credibility: 0.45, createdAt: at(0.1) }));
    expect(detectTagSpike(v, s, NOW).flagged).toBe(true);
  });
  it('a credible wave is a spike but not flagged', () => {
    const v = Array.from({ length: 8 }, () => ({ credibility: 0.9, createdAt: at(0.1) }));
    const r = detectTagSpike(v, s, NOW);
    expect(r.windowCount).toBe(8);
    expect(r.flagged).toBe(false);
  });
  it('steady history is not a spike', () => {
    const v = Array.from({ length: 60 }, (_, i) => ({ credibility: 0.45, createdAt: at(i / 2) }));
    expect(detectTagSpike(v, s, NOW).flagged).toBe(false);
  });
});

describe('issue lifecycle + provenance (owner S3 (c)(d))', () => {
  const base = { resolvedAt: null, lastConfirmedAt: null };
  it('a vote-driven issue turns "past" after the expiry without fresh signal', () => {
    expect(
      issueStatus(
        { ...base, source: 'players', firstSeenAt: at(100), lastVoteAt: at(90) },
        60,
        NOW,
      ),
    ).toBe('past');
    expect(
      issueStatus(
        { ...base, source: 'players', firstSeenAt: at(100), lastVoteAt: at(10) },
        60,
        NOW,
      ),
    ).toBe('active');
  });
  it('an editor re-confirmation counts as fresh signal', () => {
    expect(
      issueStatus(
        {
          source: 'players',
          firstSeenAt: at(100),
          lastVoteAt: at(90),
          lastConfirmedAt: at(5),
          resolvedAt: null,
        },
        60,
        NOW,
      ),
    ).toBe('active');
  });
  it('editor-added and migrated issues never expire', () => {
    expect(
      issueStatus({ ...base, source: 'editors', firstSeenAt: at(900), lastVoteAt: null }, 60, NOW),
    ).toBe('active');
  });
  it('resolved wins', () => {
    expect(
      issueStatus(
        {
          source: 'editors',
          firstSeenAt: at(900),
          lastVoteAt: null,
          lastConfirmedAt: null,
          resolvedAt: at(1),
        },
        60,
        NOW,
      ),
    ).toBe('resolved');
  });
  it('provenance is truthful and content tags carry none', () => {
    expect(provenanceLine('issue', 'players')).toBe('Reported by players · confirmed by editors');
    expect(provenanceLine('issue', 'editors')).toBe('Added by editors');
    expect(provenanceLine('issue', 'import')).toBeNull();
    expect(provenanceLine('content', 'players')).toBeNull();
    expect(provenanceLine('content', 'editors')).toBeNull();
  });
});

describe('card tags follow the section config', () => {
  const groups: GameTagGroups = {
    content: [
      { slug: 'co-op', name: 'Co-op', family: 'content', unusual: false },
      { slug: 'horror', name: 'Horror', family: 'content', unusual: false },
    ],
    issues: [
      {
        slug: 'bugs',
        name: 'Bugs',
        family: 'issue',
        unusual: false,
        status: 'active',
        provenance: null,
        firstSeen: '',
        lastConfirmed: null,
        resolvedAt: null,
        patchRef: null,
        pastUntil: null,
      },
      {
        slug: 'cheaters',
        name: 'Cheaters',
        family: 'issue',
        unusual: false,
        status: 'past',
        provenance: null,
        firstSeen: '',
        lastConfirmed: null,
        resolvedAt: null,
        patchRef: null,
        pastUntil: null,
      },
    ],
  };
  it('families in order, then the count; only CURRENT issues', () => {
    expect(cardTags(groups, ['issue', 'content'], 10).map((t) => t.slug)).toEqual([
      'bugs',
      'co-op',
      'horror',
    ]);
    expect(cardTags(groups, ['content'], 1).map((t) => t.slug)).toEqual(['co-op']);
    expect(cardTags(groups, ['content', 'issue'], 0)).toEqual([]);
    expect(cardTags(undefined, ['content'], 3)).toEqual([]);
  });
});

describe('settings + inputs are bounded', () => {
  it('defaults: anomaly label OFF publicly, index from 5 games, expiry 60 days', () => {
    expect(TAG_SETTINGS_DEFAULTS.showAnomalyLabel).toBe(false);
    expect(TAG_SETTINGS_DEFAULTS.indexMinGames).toBe(5);
    expect(TAG_SETTINGS_DEFAULTS.issueExpiryDays).toBe(60);
    expect(coerceTagSettings({ publishThreshold: -1, indexMinGames: 2.5 })).toEqual(
      TAG_SETTINGS_DEFAULTS,
    );
  });
  it('the admin patch is strict', () => {
    expect(tagSettingsPatch.safeParse({ indexMinGames: 3 }).success).toBe(true);
    expect(tagSettingsPatch.safeParse({ indexMinGames: 0 }).success).toBe(false);
    expect(tagSettingsPatch.safeParse({ other: 1 }).success).toBe(false);
  });
  it('a suggestion decision is one of accept / merge / reject', () => {
    expect(tagSuggestionDecision.safeParse({ action: 'accept', family: 'issue' }).success).toBe(
      true,
    );
    expect(tagSuggestionDecision.safeParse({ action: 'merge', tagSlug: 'co-op' }).success).toBe(
      true,
    );
    expect(tagSuggestionDecision.safeParse({ action: 'merge', tagSlug: 'Bad Slug' }).success).toBe(
      false,
    );
    expect(tagSuggestionDecision.safeParse({ action: 'publish' }).success).toBe(false);
  });
});
