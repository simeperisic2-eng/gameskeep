import { describe, it, expect } from 'vitest';
import { anchorFeedDates } from '../src/data-source/articles/mock-provider';
import type { RawFeedItem } from '../src/data-source/articles/types';
import { demoRealignShiftMs } from '../src/articles/demo-dates';
import { derivesReleased, statusLockFor } from '../src/catalog/status';

// Hermetic (no DB, no network): the Phase P hygiene-3 rules. The DB + SSR
// behaviour is proven end-to-end by scripts/p-check.mjs (group H3).

function item(guid: string, publishedAt: string | null): RawFeedItem {
  return { guid, sourceSlug: 'ign', title: `Title ${guid}`, publishedAt } as RawFeedItem;
}

describe('anchorFeedDates (mock feed relative to boot)', () => {
  const feed = [
    item('a', '2025-01-10T08:00:00Z'),
    item('b', '2026-06-16T08:00:00Z'),
    item('c', '2026-06-15T20:00:00Z'),
    item('d', null),
    item('e', 'not a date'),
  ];
  const anchor = new Date('2026-10-11T09:50:00Z');

  it('moves the newest dated item onto the anchor and keeps relative spacing', () => {
    const out = anchorFeedDates(feed, anchor);
    const t = (g: string) => Date.parse(out.find((i) => i.guid === g)!.publishedAt!);
    expect(new Date(t('b')).toISOString()).toBe(anchor.toISOString());
    expect(t('b') - t('c')).toBe(12 * 3_600_000);
    expect(t('b') - t('a')).toBe(
      Date.parse('2026-06-16T08:00:00Z') - Date.parse('2025-01-10T08:00:00Z'),
    );
  });

  it('passes undated / unparseable items through untouched', () => {
    const out = anchorFeedDates(feed, anchor);
    expect(out.find((i) => i.guid === 'd')!.publishedAt).toBeNull();
    expect(out.find((i) => i.guid === 'e')!.publishedAt).toBe('not a date');
  });

  it('is a no-op without any dated item or with an invalid anchor', () => {
    const undated = [item('x', null)];
    expect(anchorFeedDates(undated, anchor)).toEqual(undated);
    expect(anchorFeedDates(feed, new Date('nope'))).toEqual(feed);
  });

  it('never mutates the bundled dataset', () => {
    const before = JSON.stringify(feed);
    anchorFeedDates(feed, anchor);
    expect(JSON.stringify(feed)).toBe(before);
  });
});

describe('demoRealignShiftMs (stored demo rows follow the anchor)', () => {
  const anchor = new Date('2026-10-11T09:50:00Z');
  it('shifts when the stored newest is far from the anchor (either direction)', () => {
    expect(demoRealignShiftMs(new Date('2026-06-16T08:00:00Z'), anchor)).toBe(
      anchor.getTime() - Date.parse('2026-06-16T08:00:00Z'),
    );
    expect(demoRealignShiftMs(new Date('2026-10-12T09:50:00Z'), anchor)).toBe(-86_400_000);
  });
  it('leaves a small drift alone (a quick restart rewrites nothing)', () => {
    expect(demoRealignShiftMs(new Date('2026-10-11T09:20:00Z'), anchor)).toBeNull();
  });
  it('is null without stored rows or anchor, or for an invalid date', () => {
    expect(demoRealignShiftMs(null, anchor)).toBeNull();
    expect(demoRealignShiftMs(new Date('2026-01-01T00:00:00Z'), null)).toBeNull();
    expect(demoRealignShiftMs(new Date('nope'), anchor)).toBeNull();
  });
});

describe('derivesReleased (game status from release date + manual override)', () => {
  const today = '2026-10-11';
  const g = (status: string, releaseDate: string | null, statusLocked = false) => ({
    status,
    releaseDate,
    statusLocked,
  });

  it('a pre-release game whose full date has passed (or is today) is released', () => {
    expect(derivesReleased(g('in_development', '2026-06-26'), today)).toBe(true);
    expect(derivesReleased(g('announced', '2026-10-11'), today)).toBe(true);
  });

  it('future, partial, malformed or impossible dates never flip', () => {
    expect(derivesReleased(g('announced', '2026-10-12'), today)).toBe(false);
    expect(derivesReleased(g('announced', '2026'), today)).toBe(false);
    expect(derivesReleased(g('announced', '2026-Q3'), today)).toBe(false);
    expect(derivesReleased(g('announced', '2026-02-30'), today)).toBe(false);
    expect(derivesReleased(g('announced', null), today)).toBe(false);
    expect(derivesReleased(g('announced', "2026-01-01'; drop table games;--"), today)).toBe(false);
  });

  it('a staff-locked status is the manual override — never derived', () => {
    expect(derivesReleased(g('in_development', '2026-06-26', true), today)).toBe(false);
  });

  it('early access / released / delisted are not pre-release states', () => {
    for (const s of ['early_access', 'released', 'delisted', 'cancelled']) {
      expect(derivesReleased(g(s, '2020-01-01'), today)).toBe(false);
    }
  });
});

describe('statusLockFor (a staff status change is the manual override)', () => {
  it('a changed status locks — even when the form sends its unticked checkbox', () => {
    expect(statusLockFor('in_development', { status: 'announced' }, ['status'])).toBe(true);
    expect(
      statusLockFor('in_development', { status: 'announced', statusLocked: false }, [
        'status',
        'statusLocked',
      ]),
    ).toBe(true);
  });
  it('an unchanged status (form re-save) leaves the flag to the explicit value, else alone', () => {
    expect(
      statusLockFor('released', { status: 'released', statusLocked: false }, [
        'status',
        'statusLocked',
      ]),
    ).toBe(false);
    expect(statusLockFor('released', { status: 'released' }, ['status'])).toBeNull();
    expect(statusLockFor('released', {}, ['summary'])).toBeNull();
  });
  it('unlocking alone hands the status back to the derivation', () => {
    expect(statusLockFor('announced', { statusLocked: false }, ['statusLocked'])).toBe(false);
    expect(statusLockFor('announced', { statusLocked: 'no' }, ['statusLocked'])).toBeNull();
  });
});
