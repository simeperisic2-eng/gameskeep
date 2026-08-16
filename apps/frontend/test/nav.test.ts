import { describe, it, expect } from 'vitest';
import { safeNext } from '../lib/nav';

// Regression for I6 security review #3 (open redirect via ?next=).
describe('safeNext', () => {
  it('keeps a same-site relative path (with query)', () => {
    expect(safeNext('/feed')).toBe('/feed');
    expect(safeNext('/games/browse?genre=rpg')).toBe('/games/browse?genre=rpg');
    expect(safeNext('/u/someone')).toBe('/u/someone');
  });

  it('rejects an absolute off-site URL → /feed', () => {
    expect(safeNext('https://evil.com')).toBe('/feed');
    expect(safeNext('http://evil.com/PWNED')).toBe('/feed');
  });

  it('rejects protocol-relative and backslash tricks → /feed', () => {
    expect(safeNext('//evil.com')).toBe('/feed');
    expect(safeNext('/\\evil.com')).toBe('/feed');
  });

  it('rejects empty / missing → /feed', () => {
    expect(safeNext('')).toBe('/feed');
    expect(safeNext(null)).toBe('/feed');
    expect(safeNext(undefined)).toBe('/feed');
  });
});
