import { describe, it, expect } from 'vitest';
import { isActivePath, navItems, safeNext } from '../lib/nav';

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

// The desktop bar and the phone menu share one list (S4 follow-up: phone menu).
describe('navItems', () => {
  it('adds Lists after Awards when the rule says so', () => {
    const on = navItems(true).map((i) => i.label);
    expect(on.indexOf('Lists')).toBe(on.indexOf('Awards') + 1);
    expect(navItems(false).map((i) => i.label)).not.toContain('Lists');
  });
  it('returns a fresh array (callers can’t mutate the shared list)', () => {
    const a = navItems(false);
    a.pop();
    expect(navItems(false)).toHaveLength(a.length + 1);
  });
});

describe('isActivePath', () => {
  it('home only on "/"', () => {
    expect(isActivePath('/', '/')).toBe(true);
    expect(isActivePath('/games', '/')).toBe(false);
  });
  it('a section and its sub-pages, never a prefix look-alike', () => {
    expect(isActivePath('/games', '/games')).toBe(true);
    expect(isActivePath('/games/elden-ring', '/games')).toBe(true);
    expect(isActivePath('/gamesx', '/games')).toBe(false);
    expect(isActivePath(null, '/games')).toBe(false);
  });
});
