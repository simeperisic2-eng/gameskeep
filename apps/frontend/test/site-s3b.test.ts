import { describe, it, expect } from 'vitest';
import { coerceSite, fallbackSite, toClientSite } from '../lib/site-core';
import {
  bandLabel,
  brand,
  excerptRule,
  gameStatusLabel,
  label,
  setSiteLabels,
} from '../lib/labels';
import { noSignalsLabel, FLAG_LABEL } from '../lib/bias';
import { deltaText, publicTopicStatus } from '../lib/format';

// Phase P S3b — the frontend side of the copy registry: a malformed or missing
// /public/site payload never blanks the brand or a label.

describe('site payload', () => {
  it('the fallback is the registry defaults', () => {
    const f = fallbackSite();
    expect(f.brand).toBe('GamesKeep');
    expect(f.text['empty.home']).toMatch(/being prepared/);
    expect(f.layout.latestInitial).toBe(9);
    expect(f.display.excerpt.latest).toBe(110);
    expect(f.docs['about.body']?.length).toBeGreaterThan(3);
  });
  it('a malformed payload is refused (the page renders the defaults instead)', () => {
    expect(coerceSite(null)).toBeNull();
    expect(coerceSite({ brand: '' })).toBeNull();
    expect(coerceSite({ brand: 'X', text: [], docs: {}, rich: {} })).toBeNull();
  });
  it('a sound payload wins; gaps fill from the defaults', () => {
    const s = coerceSite({
      brand: 'GamesKodex',
      text: { 'empty.home': 'Soon.' },
      docs: {},
      rich: {},
      layout: { latestInitial: 'x', heroSecondaryCount: 2 },
      display: { excerpt: { latest: 90 } },
    });
    expect(s?.brand).toBe('GamesKodex');
    expect(s?.text['empty.home']).toBe('Soon.');
    expect(s?.text['label.ourPick']).toBe('Our pick'); // gap → default
    expect(s?.layout.latestInitial).toBe(9); // malformed → default
    expect(s?.layout.heroSecondaryCount).toBe(2);
    expect(s?.display.excerpt.latest).toBe(90);
    expect(s?.display.excerpt.feed).toBe(180);
  });
  it('the client payload carries no documents', () => {
    const c = toClientSite(fallbackSite());
    expect('docs' in c).toBe(false);
    expect(Object.keys(c.text).every((k) => !k.endsWith('.body'))).toBe(true);
    expect(c.text['brand.name']).toBe('GamesKeep');
    expect(c.rich['consent.newsletter']?.length).toBeGreaterThan(0);
  });
});

describe('labels store', () => {
  it('reads defaults until set, then the configured values', () => {
    setSiteLabels({});
    expect(label('label.ourPick')).toBe('Our pick');
    expect(noSignalsLabel()).toBe('No signals found');
    setSiteLabels(
      {
        'brand.name': 'GamesKodex',
        'label.flag.sponsored': 'Paid',
        'label.topic.ongoing': 'Live',
        'label.delta.new': 'Fresh',
        'label.game.earlyAccess': 'EA',
        'label.band.agreeShort': 'Same',
        'label.noSignals': '',
      },
      { latest: 77 },
    );
    expect(brand()).toBe('GamesKodex');
    expect(FLAG_LABEL.sponsored).toBe('Paid');
    expect(publicTopicStatus('ongoing')).toBe('Live');
    expect(publicTopicStatus('resolved')).toBeNull();
    expect(deltaText({ kind: 'new' })).toBe('Fresh');
    expect(gameStatusLabel('early_access')).toBe('EA');
    expect(gameStatusLabel('weird')).toBe('weird');
    expect(bandLabel('agree', true)).toBe('Same');
    expect(bandLabel('agree')).toBe('In agreement');
    expect(bandLabel('nope')).toBeNull();
    expect(noSignalsLabel()).toBe('No signals found'); // a blank value never blanks a label
    expect(excerptRule('latest')).toBe(77);
    expect(excerptRule('feed')).toBe(180);
    setSiteLabels({}, {});
  });
});
