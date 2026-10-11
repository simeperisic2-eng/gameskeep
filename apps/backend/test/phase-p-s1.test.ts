import { describe, it, expect } from 'vitest';
import {
  INTEGRITY_LEXICON_DEFAULTS,
  INTEGRITY_SNIPPET_MAX,
  type BiasBreakdown,
} from '@gameskeep/shared/constants';
import { clipSnippet, detectIntegrity, isPublicIntegrityStatus } from '../src/articles/integrity';
import { publicFlags, rowBiasMode, shapeRowSignals, topicShowsPanel } from '../src/display/scope';
import type { IntegrityLexicon } from '../src/display/settings';

// Hermetic (no DB, no network): the Phase P S1 rules that decide what is SHOWN.
// The DB + SSR behaviour is proven end-to-end by scripts/p-check.mjs.

const LEX: IntegrityLexicon = {
  reviewCopy: [...INTEGRITY_LEXICON_DEFAULTS.reviewCopy],
  embargo: [...INTEGRITY_LEXICON_DEFAULTS.embargo],
  sponsoredEvent: [...INTEGRITY_LEXICON_DEFAULTS.sponsoredEvent],
  negations: [...INTEGRITY_LEXICON_DEFAULTS.negations],
};

function kinds(text: { title: string; excerpt?: string; disclosure?: string }): string[] {
  return detectIntegrity(text, LEX).map((d) => d.kind);
}

function breakdown(signals: string[]): BiasBreakdown {
  return {
    baseline: 0,
    rawSum: signals.length * 10,
    score: signals.length * 10,
    contributions: signals.map((signal) => ({ signal, label: signal, points: 10 })),
  };
}

describe('integrity detection', () => {
  it('finds each kind from a disclosure line, with the sentence as evidence', () => {
    const found = detectIntegrity(
      {
        title: 'Some review',
        disclosure: 'Reviewed on PS5 with code provided by the publisher, under embargo until 8am.',
      },
      LEX,
    );
    expect(found.map((f) => f.kind)).toEqual(['review_copy', 'embargo']);
    expect(found[0]!.snippet).toContain('code provided by the publisher');
    expect(
      kinds({ title: 'x', disclosure: 'We attended a preview event hosted by Bandai Namco.' }),
    ).toEqual(['sponsored_event']);
  });

  it('a negated phrase is NOT a signal (same clause)', () => {
    expect(
      kinds({ title: 'x', disclosure: 'We bought our own copy; no review code was provided.' }),
    ).toEqual([]);
    expect(
      kinds({ title: 'x', disclosure: 'Polygon was not under embargo for this review.' }),
    ).toEqual([]);
    expect(
      kinds({ title: 'x', disclosure: 'Review code was not provided by the publisher.' }),
    ).toEqual([]);
  });

  it('a negation in ANOTHER clause does not cancel a real signal', () => {
    expect(
      kinds({
        title: 'x',
        disclosure: 'Review code was provided by the publisher, but there was no embargo.',
      }),
    ).toEqual(['review_copy']);
  });

  it('caps snippets at the owner limit, at a word boundary', () => {
    const long = `Review code was provided by the publisher ${'and more words '.repeat(40)}.`;
    const [hit] = detectIntegrity({ title: 'x', disclosure: long }, LEX);
    expect(hit!.snippet.length).toBeLessThanOrEqual(INTEGRITY_SNIPPET_MAX);
    expect(hit!.snippet.endsWith('…')).toBe(true);
    expect(clipSnippet('short')).toBe('short');
  });

  it('nothing to read → nothing found; an emptied keyword list disables that kind', () => {
    expect(kinds({ title: 'Elden Ring DLC review: a masterclass in difficulty' })).toEqual([]);
    const noEmbargo = { ...LEX, embargo: [] };
    expect(
      detectIntegrity({ title: 'x', disclosure: 'Published when the embargo lifted.' }, noEmbargo),
    ).toEqual([]);
  });

  it('auto-detected rows are public only while autoPublish is on; dismissed never', () => {
    expect(isPublicIntegrityStatus('detected', false)).toBe(false);
    expect(isPublicIntegrityStatus('detected', true)).toBe(true);
    expect(isPublicIntegrityStatus('confirmed', false)).toBe(true);
    expect(isPublicIntegrityStatus('dismissed', true)).toBe(false);
  });
});

describe('public flags (the type-based review-copy inference never reaches the public)', () => {
  const bd = breakdown(['sponsored', 'reviewCopy', 'opinionFraming']);

  it('a review shows review copy ONLY with integrity evidence', () => {
    expect(publicFlags(bd, 'review', false)).toEqual(['sponsored', 'opinion']);
    expect(publicFlags(bd, 'review', true)).toEqual(['sponsored', 'reviewCopy', 'opinion']);
    expect(publicFlags(breakdown([]), 'review', true)).toEqual(['reviewCopy']);
  });

  it('a non-review keeps its (evidence-based) review-copy flag', () => {
    expect(publicFlags(bd, 'preview', false)).toEqual(['sponsored', 'reviewCopy', 'opinion']);
    expect(publicFlags(null, 'news', false)).toEqual([]);
  });
});

describe('display scope', () => {
  it('default scope: detail lists → panel for reviews + sponsored, nothing for other news', () => {
    expect(rowBiasMode('reviews_and_sponsored', 'detail', false, ['affiliate'])).toBe('none');
    expect(rowBiasMode('reviews_and_sponsored', 'detail', true, [])).toBe('panel');
    expect(rowBiasMode('reviews_and_sponsored', 'detail', false, ['sponsored'])).toBe('panel');
  });

  it('default scope: compact spots → at most a Sponsored chip', () => {
    expect(rowBiasMode('reviews_and_sponsored', 'compact', false, ['sponsored', 'affiliate'])).toBe(
      'chip',
    );
    expect(rowBiasMode('reviews_and_sponsored', 'compact', true, ['opinion'])).toBe('none');
  });

  it('scope all → panel everywhere', () => {
    expect(rowBiasMode('all', 'compact', false, [])).toBe('panel');
    expect(rowBiasMode('all', 'detail', false, ['affiliate'])).toBe('panel');
  });

  it('shapes rows server-side: hidden flags are not sent', () => {
    expect(shapeRowSignals('none', false, ['affiliate'], ['Affiliate links'])).toEqual({
      flags: [],
      reasons: [],
    });
    expect(shapeRowSignals('chip', false, ['sponsored', 'affiliate'], ['x'])).toEqual({
      flags: ['sponsored'],
      reasons: [],
    });
    // On a review panel review copy is in the integrity block, not a chip.
    expect(shapeRowSignals('panel', true, ['reviewCopy', 'opinion'], ['y']).flags).toEqual([
      'opinion',
    ]);
  });

  it('topic panel: reviews or a sponsored article (default), always for scope all', () => {
    const tally = {
      total: 3,
      independent: 3,
      sponsored: 0,
      affiliate: 0,
      reviewCopy: 0,
      opinion: 0,
    };
    expect(topicShowsPanel('reviews_and_sponsored', tally, 0)).toBe(false);
    expect(topicShowsPanel('reviews_and_sponsored', tally, 2)).toBe(true);
    expect(topicShowsPanel('reviews_and_sponsored', { ...tally, sponsored: 1 }, 0)).toBe(true);
    expect(topicShowsPanel('all', tally, 0)).toBe(true);
  });
});

describe('integrity input (self-review regression)', () => {
  it('evidence dates must be real, non-future calendar dates', async () => {
    const { integritySignalInput } = await import('@gameskeep/shared/validation');
    const ok = (evidenceDate: string) =>
      integritySignalInput.safeParse({
        kind: 'embargo',
        note: 'From the outlet page',
        evidenceDate,
      }).success;
    expect(ok('2026-05-19')).toBe(true);
    expect(ok('2026-13-45')).toBe(false); // was Invalid Date → 500
    expect(ok('2026-02-30')).toBe(false); // was silently rolled to March 2
    expect(ok('2999-01-01')).toBe(false); // evidence is never from the future
  });
});

describe('topic/source tallies (self-review regression: panel vs row contradiction)', () => {
  it('an article with only an integrity row is NOT counted as "no signals found"', async () => {
    const { tallyArticle, emptyIntegrityTally } = await import('../src/display/scope');
    const tally = {
      total: 0,
      independent: 0,
      sponsored: 0,
      affiliate: 0,
      reviewCopy: 0,
      opinion: 0,
    };
    const integrity = emptyIntegrityTally();
    tallyArticle(tally, integrity, [], new Set(['embargo'] as const));
    tallyArticle(tally, integrity, [], undefined);
    tallyArticle(tally, integrity, ['opinion'], new Set(['sponsored_event'] as const));
    expect(tally).toMatchObject({ total: 3, independent: 1, opinion: 1 });
    expect(integrity).toEqual({ embargo: 1, sponsoredEvent: 1 });
  });
});
