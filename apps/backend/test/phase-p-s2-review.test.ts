import { describe, it, expect } from 'vitest';
import { HOMEPAGE_SECTIONS } from '@gameskeep/shared/constants';
import { suggestSettingsPatch } from '@gameskeep/shared/validation';
import {
  defaultWindowFor,
  demoWindowDecision,
  HomepageConfigError,
  validateSectionPatch,
} from '../src/homepage/sections';
import { coerceSuggestSettings, SUGGEST_DEFAULTS } from '../src/catalog/suggest-settings';

// Hermetic (no DB, no network): the S2 review fixes' pure rules. Live behaviour
// is proven by scripts/p-check.mjs S2.4 / S2.24–S2.26.

describe('Trending Δ window: production 48h, demo 168h (fix 2)', () => {
  const t = HOMEPAGE_SECTIONS.trending.defaults;
  it('production keeps 48h; a fresh demo starts at 168h', () => {
    expect(defaultWindowFor(t, false)).toBe(48);
    expect(defaultWindowFor(t, true)).toBe(168);
  });
  it('sections without a demo default are the same in both modes', () => {
    const p = HOMEPAGE_SECTIONS.by_players.defaults;
    expect(defaultWindowFor(p, true)).toBe(defaultWindowFor(p, false));
  });
  it('an existing demo row moves only while it holds the production default and no staff edit exists', () => {
    const base = { productionDefault: 48, demoDefault: 168 };
    expect(demoWindowDecision({ ...base, current: 48, staffEdited: false })).toBe(168);
    expect(demoWindowDecision({ ...base, current: 48, staffEdited: true })).toBeNull();
    expect(demoWindowDecision({ ...base, current: 72, staffEdited: false })).toBeNull();
    expect(demoWindowDecision({ ...base, current: 168, staffEdited: false })).toBeNull();
    expect(demoWindowDecision({ ...base, current: null, staffEdited: false })).toBeNull();
    expect(
      demoWindowDecision({
        current: 48,
        productionDefault: 48,
        demoDefault: undefined,
        staffEdited: false,
      }),
    ).toBeNull();
  });
});

describe('suggest limits are settings (fix 3)', () => {
  it('defaults are the old constants', () => {
    expect(SUGGEST_DEFAULTS).toEqual({ perIpMax: 5, globalMax: 60, windowMinutes: 10 });
    expect(coerceSuggestSettings(undefined)).toEqual(SUGGEST_DEFAULTS);
  });
  it('a malformed stored value falls back per key, never throws', () => {
    expect(coerceSuggestSettings({ perIpMax: 0, globalMax: 'x', windowMinutes: 30 })).toEqual({
      perIpMax: 5,
      globalMax: 60,
      windowMinutes: 30,
    });
    expect(coerceSuggestSettings({ perIpMax: 2.5, windowMinutes: 99999 })).toEqual(
      SUGGEST_DEFAULTS,
    );
    expect(coerceSuggestSettings('garbage')).toEqual(SUGGEST_DEFAULTS);
  });
  it('the admin patch is strict and bounded', () => {
    expect(suggestSettingsPatch.safeParse({ perIpMax: 10 }).success).toBe(true);
    expect(suggestSettingsPatch.safeParse({ perIpMax: 0 }).success).toBe(false);
    expect(suggestSettingsPatch.safeParse({ windowMinutes: 1441 }).success).toBe(false);
    expect(suggestSettingsPatch.safeParse({ globalMax: 1.5 }).success).toBe(false);
    expect(suggestSettingsPatch.safeParse({ other: 1 }).success).toBe(false);
  });
});

describe('minimum items never exceed the item count (self-review)', () => {
  const trending = {
    key: 'trending' as const,
    kind: 'data' as const,
    items: 'topic' as const,
    delta: true,
    itemCount: 8,
    minItems: 3,
  };
  const message = (fn: () => unknown): string => {
    try {
      fn();
    } catch (e) {
      expect(e).toBeInstanceOf(HomepageConfigError);
      return (e as Error).message;
    }
    return 'accepted';
  };
  it('a minimum above the count is rejected, on either field', () => {
    expect(message(() => validateSectionPatch(trending, { minItems: 9 }))).toMatch(/never show/);
    expect(message(() => validateSectionPatch(trending, { itemCount: 2 }))).toMatch(/never show/);
    expect(message(() => validateSectionPatch(trending, { itemCount: 2, minItems: 3 }))).toMatch(
      /never show/,
    );
  });
  it('equal, lower, or no minimum is fine', () => {
    expect(validateSectionPatch(trending, { minItems: 8 })).toEqual({ minItems: 8 });
    expect(validateSectionPatch(trending, { itemCount: 2, minItems: null })).toEqual({
      itemCount: 2,
      minItems: null,
    });
    expect(validateSectionPatch(trending, { itemCount: 3 })).toEqual({ itemCount: 3 });
  });
});
