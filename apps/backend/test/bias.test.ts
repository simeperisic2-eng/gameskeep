import { describe, it, expect } from 'vitest';
import { BIAS_WEIGHT_DEFAULTS, EVENT_KIND_LEXICON_DEFAULTS } from '@gameskeep/shared/constants';
import {
  aggregateDistribution,
  computeInfluence,
  computeQuality,
  toPublicBias,
  type BiasSignalInputs,
} from '../src/articles/bias';
import { classifyEventKind, normalizeGameRef } from '../src/articles/event-kind';
import { shouldResistMerge } from '../src/articles/gate';
import { CLUSTER_GATE_DEFAULTS } from '@gameskeep/shared/constants';

// All hermetic — no DB, no network. The recompute/aggregation DB path runs
// against the booted stack via scripts/i4a-check.mjs. These tests target the
// SPEC's verification axes: DIRECTION, EXPLAINABILITY, the internal-field WALL,
// and the gate logic — never an absolute "correct" number.

const W = BIAS_WEIGHT_DEFAULTS;

function inputs(partial: Partial<BiasSignalInputs> = {}): BiasSignalInputs {
  return {
    isSponsored: false,
    hasAffiliateLinks: false,
    basedOnReviewCopy: false,
    isPaywalled: false,
    articleType: 'news',
    sourceConflict: false,
    reputationCommercial: null,
    reputationGeneral: null,
    ...partial,
  };
}

describe('influence axis — direction + explainability', () => {
  it('sponsored+affiliate scores far MORE influenced than a clean article', () => {
    const clean = computeInfluence(inputs(), W.influence);
    const affiliate = computeInfluence(inputs({ hasAffiliateLinks: true }), W.influence);
    const sponsored = computeInfluence(
      inputs({ isSponsored: true, hasAffiliateLinks: true }),
      W.influence,
    );
    // Ordering is the closest thing to a correctness test (SPEC verify #2).
    expect(sponsored.score).toBeGreaterThan(affiliate.score);
    expect(affiliate.score).toBeGreaterThan(clean.score);
    // Sponsored dominates (near the influenced pole).
    expect(sponsored.score).toBeGreaterThanOrEqual(95);
    // A clean independent article sits near the independent pole.
    expect(clean.score).toBeLessThan(20);
  });

  it('every point is explained by a named contribution that sums to the score', () => {
    const b = computeInfluence(inputs({ isSponsored: true, hasAffiliateLinks: true }), W.influence);
    const summed = b.contributions.reduce((a, c) => a + c.points, 0);
    expect(summed).toBe(b.rawSum);
    expect(b.score).toBe(Math.min(100, b.rawSum)); // clamp is the only normalization
    expect(b.contributions.map((c) => c.signal)).toContain('sponsored');
    expect(b.contributions.map((c) => c.signal)).toContain('affiliate');
  });

  it('a missing source baseline does not crash → neutral-ish, no contribution', () => {
    const b = computeInfluence(inputs(), W.influence);
    expect(b.contributions.find((c) => c.signal === 'sourceBaseline')).toBeUndefined();
    expect(b.score).toBe(0);
  });

  it('weights are tunable: raising the sponsored weight raises the score', () => {
    const low = computeInfluence(inputs({ isSponsored: true }), { ...W.influence, sponsored: 40 });
    const high = computeInfluence(inputs({ isSponsored: true }), { ...W.influence, sponsored: 95 });
    expect(high.score).toBeGreaterThan(low.score);
  });
});

describe('quality axis — humbler, direction holds', () => {
  it('a press-release-style preview scores LOWER than a substantive review', () => {
    const review = computeQuality(inputs({ articleType: 'review' }), W.quality);
    const prRewrite = computeQuality(
      inputs({ articleType: 'preview', isSponsored: true, hasAffiliateLinks: true }),
      W.quality,
    );
    expect(review.score).toBeGreaterThan(prRewrite.score); // SPEC verify #2
  });

  it('unknown source reputation yields a neutral baseline, not a crash', () => {
    const b = computeQuality(inputs(), W.quality);
    expect(b.baseline).toBe(W.quality.neutralDefault);
    expect(b.score).toBe(W.quality.neutralDefault);
  });
});

describe('internal-field wall — toPublicBias (SPEC I4a §4)', () => {
  it('cannot emit internalAssessment even when the row carries it', () => {
    // Deliberately pass a row that ALSO has the internal field populated.
    const row = {
      influenceScore: 30,
      qualityScore: 60,
      influenceOverride: null,
      qualityOverride: null,
      influenceBreakdown: null,
      qualityBreakdown: null,
      editorNote: 'human-written note',
      internalAssessment: 'SECRET internal ideological read — must never leak',
    };
    const pub = toPublicBias(row);
    expect(Object.keys(pub)).not.toContain('internalAssessment');
    expect(JSON.stringify(pub)).not.toContain('SECRET');
    // Effective score = override ?? auto; editor note is public-eligible.
    expect(pub.influenceScore).toBe(30);
    expect(pub.editorNote).toBe('human-written note');
  });

  it('effective score uses the editor override when present, flags editor-set', () => {
    const pub = toPublicBias({
      influenceScore: 30,
      qualityScore: 60,
      influenceOverride: 90,
      qualityOverride: null,
      influenceBreakdown: null,
      qualityBreakdown: null,
      editorNote: null,
    });
    expect(pub.influenceScore).toBe(90);
    expect(pub.influenceEditorSet).toBe(true);
    expect(pub.qualityEditorSet).toBe(false);
  });
});

describe('topic distribution aggregation', () => {
  it('counts independent/influenced + top/slop at the midpoints', () => {
    const dist = aggregateDistribution(
      [
        { influence: 10, quality: 70 },
        { influence: 20, quality: 65 },
        { influence: 90, quality: 30 },
        { influence: null, quality: null },
      ],
      W.buckets,
    );
    expect(dist.articleCount).toBe(4);
    expect(dist.influence.independent).toBe(2);
    expect(dist.influence.influenced).toBe(1);
    expect(dist.quality.top).toBe(2);
    expect(dist.quality.slop).toBe(1);
    expect(dist.influence.avg).toBe(40); // (10+20+90)/3 rounded
  });

  it('empty topic → zero counts, null averages (no crash)', () => {
    const dist = aggregateDistribution([], W.buckets);
    expect(dist.articleCount).toBe(0);
    expect(dist.influence.avg).toBeNull();
    expect(dist.quality.avg).toBeNull();
  });
});

describe('event-kind classifier (mechanical, tunable lexicon)', () => {
  const lex = EVENT_KIND_LEXICON_DEFAULTS;
  it('classifies the gate test pair as DIFFERENT kinds', () => {
    const orion = classifyEventKind(
      'CD Projekt celebrates a landmark Cyberpunk moment as Project Orion enters full production. The studio expands its team.',
      lex,
    );
    const sales = classifyEventKind(
      'CD Projekt celebrates a landmark Cyberpunk moment as the game passes 30 million copies sold worldwide.',
      lex,
    );
    expect(orion).toBe('business');
    expect(sales).toBe('sales');
    expect(orion).not.toBe(sales);
  });

  it('classifies the GTA 6 delay coverage all as the SAME kind (delay)', () => {
    expect(classifyEventKind('GTA 6 delayed to 2027, Rockstar confirms', lex)).toBe('delay');
    expect(classifyEventKind('GTA 6 release date slips into 2027', lex)).toBe('delay');
  });

  it('returns "other" when nothing matches (gate then stays inert)', () => {
    expect(classifyEventKind('A quiet retrospective on a beloved indie', lex)).toBe('other');
  });
});

describe('secondary gate — resists over-merge, never over-splits', () => {
  const gate = { ...CLUSTER_GATE_DEFAULTS };
  const day = (d: string) => new Date(`${d}T08:00:00Z`);

  it('RESISTS same-game + different-kind + old-enough candidate (the over-merge fix)', () => {
    const resist = shouldResistMerge(
      {
        incoming: { gameRef: 'cyberpunk 2077', eventKind: 'sales', publishDate: day('2026-06-16') },
        candidate: {
          gameRef: 'cyberpunk 2077',
          eventKind: 'business',
          lastActivityAt: day('2026-06-13'),
        },
      },
      gate,
    );
    expect(resist).toBe(true);
  });

  it('does NOT resist same-game SAME-kind within the news cycle (GTA 6 delay stays one topic)', () => {
    const resist = shouldResistMerge(
      {
        incoming: {
          gameRef: 'grand theft auto vi',
          eventKind: 'delay',
          publishDate: day('2026-06-02'),
        },
        candidate: {
          gameRef: 'grand theft auto vi',
          eventKind: 'delay',
          lastActivityAt: day('2026-06-02'),
        },
      },
      gate,
    );
    expect(resist).toBe(false);
  });

  it('does NOT resist within the time-gap (same day, even if kinds differ)', () => {
    const resist = shouldResistMerge(
      {
        incoming: { gameRef: 'gta vi', eventKind: 'business', publishDate: day('2026-06-02') },
        candidate: { gameRef: 'gta vi', eventKind: 'delay', lastActivityAt: day('2026-06-02') },
      },
      gate,
    );
    expect(resist).toBe(false);
  });

  it('does NOT resist different games, or when disabled, or on unknown kinds', () => {
    const base = {
      incoming: { gameRef: 'game a', eventKind: 'sales' as const, publishDate: day('2026-06-16') },
      candidate: {
        gameRef: 'game b',
        eventKind: 'business' as const,
        lastActivityAt: day('2026-06-10'),
      },
    };
    expect(shouldResistMerge(base, gate)).toBe(false); // different games
    expect(
      shouldResistMerge(
        { ...base, candidate: { ...base.candidate, gameRef: 'game a' } },
        { ...gate, enabled: false },
      ),
    ).toBe(false); // disabled
    expect(
      shouldResistMerge(
        {
          incoming: { ...base.incoming, gameRef: 'game a', eventKind: 'other' },
          candidate: { ...base.candidate, gameRef: 'game a' },
        },
        gate,
      ),
    ).toBe(false); // unknown kind
  });
});

describe('normalizeGameRef', () => {
  it('lowercases + trims, null for empty', () => {
    expect(normalizeGameRef('  Cyberpunk 2077 ')).toBe('cyberpunk 2077');
    expect(normalizeGameRef('')).toBeNull();
    expect(normalizeGameRef(undefined)).toBeNull();
  });
});
