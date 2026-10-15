import { describe, it, expect } from 'vitest';
import { coerceSite, fallbackSite, toClientSite } from '../lib/site-core';
import { categoryChip } from '../lib/format';

// Phase P S4 — the search / lists knobs that reach the header from /public/site.

describe('S4 layout knobs', () => {
  it('defaults: typeahead from 2 characters, Lists in the nav', () => {
    const f = fallbackSite();
    expect(f.layout.searchMinChars).toBe(2);
    expect(f.layout.listsInNav).toBe(true);
  });
  it('sound values win; malformed ones fall back', () => {
    const base = { brand: 'GamesKeep', text: {}, docs: {}, rich: {} };
    const ok = coerceSite({ ...base, layout: { searchMinChars: 3, listsInNav: false } });
    expect(ok?.layout.searchMinChars).toBe(3);
    expect(ok?.layout.listsInNav).toBe(false);
    const bad = coerceSite({ ...base, layout: { searchMinChars: 'x', listsInNav: 'no' } });
    expect(bad?.layout.searchMinChars).toBe(2);
    expect(bad?.layout.listsInNav).toBe(true);
  });
  it('the search texts reach the client bundle (the typeahead uses them)', () => {
    const client = toClientSite(fallbackSite());
    expect(Object.keys(client.text).some((k) => k.startsWith('search.'))).toBe(true);
    expect(client.text['empty.search']).toBeTruthy();
  });
});

describe('category chip next to the type chip', () => {
  it('shows a category that differs from the type', () => {
    expect(categoryChip('Deals', 'news')).toBe('Deals');
  });
  it('never repeats the type ("Guide" twice)', () => {
    expect(categoryChip('Guide', 'guide')).toBeNull();
    expect(categoryChip(' guide ', 'Guide')).toBeNull();
  });
  it('none → null', () => {
    expect(categoryChip(null, 'news')).toBeNull();
    expect(categoryChip('  ', 'news')).toBeNull();
    expect(categoryChip('Deals', undefined)).toBe('Deals');
  });
});
