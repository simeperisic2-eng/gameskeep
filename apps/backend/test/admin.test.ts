import { describe, it, expect } from 'vitest';
import {
  articleCreate,
  gameCreate,
  topicTypeCreate,
  userCreate,
} from '@gameskeep/shared/validation';
import { diffRows } from '../src/admin/audit';
import { slugify, RESOURCE_BY_NAME, listResourceMeta } from '../src/admin/registry';

// All hermetic — no DB. Validates the pure pieces of the admin layer; the live
// CRUD/relations/constraints run against the booted stack via scripts/i1-check.

describe('audit diff', () => {
  it('reports only changed, non-noise fields as old→new', () => {
    const before = {
      id: '1',
      summary: 'old',
      status: 'announced',
      updatedAt: new Date('2026-01-01'),
    };
    const after = {
      id: '1',
      summary: 'new',
      status: 'announced',
      updatedAt: new Date('2026-02-02'),
    };
    const diff = diffRows(before, after);
    expect(diff).toEqual({ summary: { from: 'old', to: 'new' } });
    expect(diff).not.toHaveProperty('updatedAt');
    expect(diff).not.toHaveProperty('status');
  });

  it('normalizes Dates and null/undefined when comparing', () => {
    const d = new Date('2026-03-03T00:00:00Z');
    expect(diffRows({ at: d }, { at: new Date(d.getTime()) })).toEqual({});
    expect(diffRows({ x: null }, { x: undefined })).toEqual({});
  });
});

describe('slugify', () => {
  it('produces clean lowercase slugs', () => {
    expect(slugify('Cyberpunk 2077')).toBe('cyberpunk-2077');
    expect(slugify("Baldur's Gate 3!!")).toBe('baldur-s-gate-3');
    expect(slugify('   ')).toBe('item');
  });
});

describe('validation', () => {
  it('rejects an aggregated article that carries full body text (copyright)', () => {
    const bad = articleCreate.safeParse({
      title: 'X',
      origin: 'aggregated',
      body: 'stolen full text',
    });
    expect(bad.success).toBe(false);
  });

  it('allows our own article to carry a body', () => {
    const ok = articleCreate.safeParse({ title: 'X', origin: 'ours', body: 'our words' });
    expect(ok.success).toBe(true);
  });

  it('rejects out-of-range and malformed input', () => {
    expect(gameCreate.safeParse({ name: 'G', steamCompletionRate: 150 }).success).toBe(false);
    expect(userCreate.safeParse({ username: 'a b', email: 'nope', roleId: 'x' }).success).toBe(
      false,
    );
  });

  it('accepts a minimal valid game and applies the status default', () => {
    const parsed = gameCreate.parse({ name: 'Some Game' });
    expect(parsed.status).toBe('announced');
  });

  it('accepts an extensible topic-type as data', () => {
    expect(topicTypeCreate.safeParse({ key: 'new-kind', label: 'New Kind' }).success).toBe(true);
  });
});

describe('resource registry', () => {
  it('registers the core models with non-empty field specs', () => {
    for (const name of ['games', 'sources', 'topics', 'articles', 'users', 'award-editions']) {
      const r = RESOURCE_BY_NAME.get(name);
      expect(r, `resource ${name}`).toBeDefined();
      expect(r!.fields.length).toBeGreaterThan(0);
    }
  });

  it('exposes JSON-serializable metadata for the UI', () => {
    const meta = listResourceMeta();
    expect(() => JSON.stringify(meta)).not.toThrow();
    expect(meta.find((m) => m.name === 'games')?.labelColumn).toBe('name');
  });
});
