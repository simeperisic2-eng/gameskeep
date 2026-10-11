import { describe, it, expect } from 'vitest';
import { deltaText, stripLeadingTitle, windowLabel } from '../lib/format';

// Phase P S2 — homepage card helpers (pure).
describe('windowLabel', () => {
  it('hours under three days, whole days above', () => {
    expect(windowLabel(48)).toBe('48h');
    expect(windowLabel(24)).toBe('24h');
    expect(windowLabel(168)).toBe('7d');
    expect(windowLabel(100)).toBe('100h');
    expect(windowLabel(null)).toBeNull();
    expect(windowLabel(0)).toBeNull();
  });
});

describe('deltaText', () => {
  it('honest states: New, —, signed % with a real minus', () => {
    expect(deltaText({ kind: 'new' })).toBe('New');
    expect(deltaText({ kind: 'none' })).toBe('—');
    expect(deltaText({ kind: 'pct', value: 12.4 })).toBe('+12%');
    expect(deltaText({ kind: 'pct', value: -100 })).toBe('−100%');
    expect(deltaText({ kind: 'pct', value: 0 })).toBe('±0%');
    expect(deltaText({ kind: 'pct', value: Number.NaN })).toBe('—');
    expect(deltaText(null)).toBeNull();
  });
});

describe('stripLeadingTitle', () => {
  it('drops a first sentence that only repeats the headline', () => {
    expect(
      stripLeadingTitle(
        'Grand Theft Auto VI Delayed to 2027, Rockstar Confirms. Rockstar pushes back GTA VI.',
        'Grand Theft Auto VI Delayed to 2027, Rockstar Confirms',
      ),
    ).toBe('Rockstar pushes back GTA VI.');
  });
  it('keeps a summary that says something else, and never empties one', () => {
    expect(stripLeadingTitle('A new patch fixes saves. More soon.', 'Patch 1.2')).toBe(
      'A new patch fixes saves. More soon.',
    );
    expect(stripLeadingTitle('Patch 1.2.', 'Patch 1.2')).toBe('Patch 1.2.');
    expect(stripLeadingTitle(null, 'x')).toBeNull();
  });
});
