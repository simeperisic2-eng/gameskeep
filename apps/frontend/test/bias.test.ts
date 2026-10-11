import { describe, it, expect } from 'vitest';
import { NO_SIGNALS_LABEL, compactTopicToken, flagParts } from '../lib/bias';

// Phase P S1: "No signals found" replaces "Independent" everywhere public, and
// compact surfaces show at most a Sponsored token under the default scope.
const tally = (o: Partial<Record<string, number>> = {}) => ({
  total: 5,
  independent: 0,
  sponsored: 0,
  affiliate: 0,
  reviewCopy: 0,
  opinion: 0,
  ...o,
});

describe('bias labels', () => {
  it('never labels anything "independent"', () => {
    const parts = flagParts(tally({ independent: 4, sponsored: 1 }));
    expect(parts.map((p) => p.label)).toEqual(['1 sponsored', '4 with no signals found']);
    for (const p of parts) expect(p.label.toLowerCase()).not.toContain('independent');
    expect(parts.find((p) => p.key === 'nosignal')?.kind).toBe('nosignal');
    expect(NO_SIGNALS_LABEL).toBe('No signals found');
  });

  it('default scope: a Sponsored token only when a sponsored article exists', () => {
    expect(compactTopicToken(tally({ independent: 5 }), 'reviews_and_sponsored')).toBeNull();
    expect(compactTopicToken(tally({ affiliate: 2 }), 'reviews_and_sponsored')).toBeNull();
    expect(compactTopicToken(tally({ sponsored: 1 }), 'reviews_and_sponsored')).toEqual({
      kind: 'signal',
      label: 'Sponsored',
    });
  });

  it('scope all: leading signal (+N) or the neutral no-signal token', () => {
    expect(compactTopicToken(tally({ independent: 5 }), 'all')).toEqual({
      kind: 'nosignal',
      label: 'No signals found',
    });
    expect(compactTopicToken(tally({ affiliate: 1, opinion: 2 }), 'all')).toEqual({
      kind: 'signal',
      label: 'Affiliate +1',
    });
  });
});

describe('integrity in topic tallies', () => {
  it('lists found embargo / press-trip rows as signals', () => {
    const parts = flagParts(tally({ independent: 3 }), { embargo: 1, sponsoredEvent: 2 });
    expect(parts.map((p) => p.label)).toEqual([
      '1 embargo',
      '2 sponsored event / press trip',
      '3 with no signals found',
    ]);
    expect(compactTopicToken(tally(), 'all', { embargo: 1, sponsoredEvent: 0 })?.label).toBe(
      'Embargo',
    );
  });
});
