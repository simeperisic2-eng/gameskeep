import { describe, it, expect } from 'vitest';
import { distinctSubtitle, publicTopicStatus } from '../lib/format';
import { NO_SIGNALS_LABEL, NO_SIGNALS_NOTE, rowShowsNoSignals } from '../lib/bias';

// Phase P hygiene 3 — public polish rules (pure).

describe('distinctSubtitle', () => {
  it('drops a subtitle that only repeats the title (case, quotes, punctuation)', () => {
    const title = 'No Man’s Sky’s Huge New Update Adds Living Ships and Worlds';
    expect(distinctSubtitle(title, title)).toBeNull();
    expect(
      distinctSubtitle(title, "No Man's Sky's huge new update adds living ships and worlds."),
    ).toBeNull();
    expect(
      distinctSubtitle(
        'Death Stranding 2: On the Beach Review',
        '  death stranding 2 — on the beach review ',
      ),
    ).toBeNull();
  });
  it('keeps a subtitle that says something else, trimmed', () => {
    expect(distinctSubtitle('Patch 1.2 is out', '  Fixes the save bug on PS5. ')).toBe(
      'Fixes the save bug on PS5.',
    );
  });
  it('null-safe: empty / punctuation-only subtitles render nothing', () => {
    expect(distinctSubtitle('T', null)).toBeNull();
    expect(distinctSubtitle('T', '   ')).toBeNull();
    expect(distinctSubtitle('T', '—')).toBeNull();
    expect(distinctSubtitle(null, 'Something')).toBe('Something');
  });
});

describe('publicTopicStatus', () => {
  it('"resolved" is internal state — no public chip', () => {
    expect(publicTopicStatus('resolved')).toBeNull();
    expect(publicTopicStatus(null)).toBeNull();
    expect(publicTopicStatus('weird')).toBeNull();
  });
  it('developing / ongoing keep their reader-facing labels', () => {
    expect(publicTopicStatus('developing')).toBe('Developing');
    expect(publicTopicStatus('ongoing')).toBe('Ongoing');
  });
});

describe('rowShowsNoSignals (short label per row, note once per block)', () => {
  it('mirrors the row markup', () => {
    expect(rowShowsNoSignals({ biasMode: 'panel', flags: [], isReview: false })).toBe(true);
    expect(rowShowsNoSignals({ biasMode: 'panel', flags: ['affiliate'], isReview: false })).toBe(
      false,
    );
    expect(
      rowShowsNoSignals({ biasMode: 'panel', flags: ['affiliate'], isReview: true, integrity: [] }),
    ).toBe(true);
    expect(
      rowShowsNoSignals({ biasMode: 'panel', flags: [], isReview: true, integrity: [{}] }),
    ).toBe(false);
    expect(rowShowsNoSignals({ biasMode: 'chip', flags: [] })).toBe(false);
    expect(rowShowsNoSignals({ biasMode: 'none', flags: [] })).toBe(false);
  });
  it('the block note names the label and keeps the explainer', () => {
    expect(NO_SIGNALS_NOTE).toContain(NO_SIGNALS_LABEL);
    expect(NO_SIGNALS_NOTE).toContain('cannot prove');
  });
});
