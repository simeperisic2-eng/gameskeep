import { describe, it, expect } from 'vitest';
import { RULES_DEFAULTS } from '@gameskeep/shared/constants';
import {
  buildSiteCopy,
  COPY_DEFAULTS,
  copyDef,
  copyValueProblems,
  copyVars,
  fillDoc,
  fillTokens,
  inlineText,
  mailtoHref,
  parseDoc,
  parseInline,
  safeHref,
  unknownTokens,
  type Block,
} from '@gameskeep/shared/copy';
import { ratingOverrideInput, gameContentFlagsCreate } from '@gameskeep/shared/validation';
import { coerceRules, rulesPatchErrors } from '../src/rules/settings';
import { curateList } from '../src/curation/service';
import { coerceStored, effectiveValues } from '../src/copy/settings';
import { importFixReason, sameValue } from '../src/admin/routes';
import { RESOURCE_BY_NAME } from '../src/admin/registry';
import { clipSnippet, detectIntegrity } from '../src/articles/integrity';
import { verificationEmail, newsletterEmail } from '../src/email/templates';

// Hermetic (no DB): the Phase P S3b rules, curation, copy registry, document
// parser and import-error gate. Live behaviour is proven by scripts/p-check.mjs S3b.

describe('rules: defaults are the previous behaviour, reads clamp', () => {
  it('an empty store reads exactly the defaults', () => {
    expect(coerceRules(undefined)).toEqual(RULES_DEFAULTS);
    expect(coerceRules('junk')).toEqual(RULES_DEFAULTS);
  });
  it('a malformed or out-of-range leaf falls back to its default; good leaves stay', () => {
    const r = coerceRules({
      homepage: { latestInitial: 0, heroRotateMinutes: 15, latestExcludesTrending: 'yes' },
      display: { excerpt: { latest: 99999, feed: 150 } },
      upcoming: { paidPositions: [4, 1, 1, 99, 2.5] },
    });
    expect(r.homepage.latestInitial).toBe(9); // below the [1, 48] bound
    expect(r.homepage.heroRotateMinutes).toBe(15);
    expect(r.homepage.latestExcludesTrending).toBe(true);
    expect(r.display.excerpt.latest).toBe(110);
    expect(r.display.excerpt.feed).toBe(150);
    expect(r.upcoming.paidPositions).toEqual([1, 4]); // deduped, sorted, bad ones dropped
  });
  it('writes are validated leaf by leaf', () => {
    expect(rulesPatchErrors({ homepage: { latestInitial: 12 } })).toEqual([]);
    expect(rulesPatchErrors({ homepage: { nope: 1 } })[0]).toMatch(/unknown rule/);
    expect(rulesPatchErrors({ homepage: { latestInitial: 0 } })[0]).toMatch(/1 to 48/);
    expect(rulesPatchErrors({ homepage: { latestExcludesTrending: 1 } })[0]).toMatch(/true\/false/);
    expect(rulesPatchErrors({ upcoming: { paidPositions: [0] } })[0]).toMatch(/1 to 50/);
    expect(rulesPatchErrors('x')[0]).toMatch(/expected an object/);
  });
  it('the snippet rule is capped at the evidence column (240)', () => {
    expect(rulesPatchErrors({ display: { integritySnippetMax: 241 } })[0]).toMatch(/40 to 240/);
    const long = `${'word '.repeat(80)}embargo lifted.`;
    const [hit] = detectIntegrity(
      { title: 'x', excerpt: long, disclosure: null },
      { reviewCopy: [], embargo: ['embargo'], sponsoredEvent: [], negations: [] },
      120,
    );
    expect(hit?.snippet.length).toBeLessThanOrEqual(120);
    expect(clipSnippet(long, 100).length).toBeLessThanOrEqual(100);
  });
});

describe('curation: pins first, excludes never, the rest automatic', () => {
  const auto = ['a', 'b', 'c', 'd', 'e'].map((k) => ({ k }));
  const key = (x: { k: string }): string => x.k;
  it('pins lead in their order, excludes drop out, size cuts', () => {
    const out = curateList(auto, key, { pins: ['d', 'b'], excludes: ['a'] }, 4).map(key);
    expect(out).toEqual(['d', 'b', 'c', 'e']);
  });
  it('a pin resolves from the pinned map when it is not in the automatic list', () => {
    const pinned = new Map([['z', { k: 'z' }]]);
    expect(curateList(auto, key, { pins: ['z'], excludes: [] }, 2, pinned).map(key)).toEqual([
      'z',
      'a',
    ]);
  });
  it('an excluded pin, a duplicate or an unknown pin never shows', () => {
    const out = curateList(auto, key, { pins: ['b', 'b', 'q', 'c'], excludes: ['c'] }, 9);
    expect(out.map(key)).toEqual(['b', 'a', 'd', 'e']);
  });
  it('size 0 shows nothing', () => {
    expect(curateList(auto, key, { pins: ['a'], excludes: [] }, 0)).toEqual([]);
  });
});

describe('third-party data: import-error reason', () => {
  const games = RESOURCE_BY_NAME.get('games')!;
  const prices = RESOURCE_BY_NAME.get('game-prices')!;
  const imported = { externalRefs: { igdb: 1 } };
  it('applies only to imported game rows and only to imported fields', () => {
    expect(importFixReason(games, { externalRefs: {} }, ['name'], undefined)).toBeNull();
    expect(importFixReason(games, imported, ['noindex'], undefined)).toBeNull();
    expect(() => importFixReason(games, imported, ['name'], undefined)).toThrow(/third-party/);
    expect(importFixReason(games, imported, ['name'], 'import-error-wrong-value')).toBe(
      'import-error-wrong-value',
    );
  });
  it('a delete of third-party data needs a reason; an invented reason is refused', () => {
    expect(() => importFixReason(prices, {}, 'delete', undefined)).toThrow(/third-party/);
    expect(() => importFixReason(prices, {}, 'delete', 'because')).toThrow(/third-party/);
    expect(importFixReason(prices, {}, 'delete', 'import-error-wrong-game-match')).toBe(
      'import-error-wrong-game-match',
    );
  });
  it('change detection ignores the form re-sending unchanged values', () => {
    expect(sameValue('7.50', 7.5)).toBe(true); // pg numeric vs form number
    expect(sameValue(new Date('2026-01-02T03:04:05Z'), '2026-01-02T03:04:05.000Z')).toBe(true);
    expect(sameValue(['a'], ['a'])).toBe(true);
    expect(sameValue(undefined, null)).toBe(true);
    expect(sameValue('7.5', 8)).toBe(false);
    expect(sameValue('Halo', 'Halo 2')).toBe(false);
  });
});

describe('closed paths', () => {
  it('predatory monetization is gone from the write schema (Pay-to-win is the issue tag)', () => {
    const shape = (gameContentFlagsCreate as unknown as { shape: Record<string, unknown> }).shape;
    expect('predatoryMonetization' in shape).toBe(false);
  });
  it('a disconnect band override needs a reason', () => {
    expect(ratingOverrideInput.safeParse({ disconnectBand: 'large' }).success).toBe(false);
    expect(
      ratingOverrideInput.safeParse({ disconnectBand: 'large', reason: 'import duplicate' })
        .success,
    ).toBe(true);
    expect(ratingOverrideInput.safeParse({ disconnectBand: null }).success).toBe(true);
    expect(ratingOverrideInput.safeParse({ disconnectBand: 'huge', reason: 'x' }).success).toBe(
      false,
    );
  });
});

describe('copy registry: defaults, placeholders, locks', () => {
  it('an empty store renders today’s text with the brand filled in', () => {
    const site = buildSiteCopy(COPY_DEFAULTS);
    expect(site.brand).toBe('GamesKeep');
    expect(site.text['about.lede']).toMatch(/^GamesKeep is a tool to judge games coverage/);
    expect(site.text['label.noSignals']).toBe('No signals found');
  });
  it('a rename is ONE setting: every default that names the brand follows it', () => {
    const site = buildSiteCopy(effectiveValues({ 'brand.name': 'GamesKodex' }));
    const all = JSON.stringify(site);
    expect(all).not.toMatch(/GamesKeep/);
    expect(site.text['about.lede']).toMatch(/^GamesKodex is a tool/);
    expect(site.text['footer.legal']).toMatch(/GamesKodex/);
    expect(inlineText(site.rich['consent.newsletter'] ?? [])).toMatch(/GamesKodex briefing/);
  });
  it('locked texts are never stored and always read their default', () => {
    expect(copyDef('consent.newsletter')?.locked).toBe(true);
    expect(
      coerceStored({ values: { 'consent.newsletter': 'pre-ticked!', 'paid.label': 'Ad' } }),
    ).toEqual({});
    const site = buildSiteCopy({ ...COPY_DEFAULTS, 'paid.label': 'Ad' });
    expect(site.text['paid.label']).toBe('Promoted');
  });
  it('stored overrides are filtered (unknown / oversize / empty-required dropped)', () => {
    const out = coerceStored({
      values: {
        'brand.name': '',
        'empty.home': 'Soon.',
        'no.such.key': 'x',
        'label.ourPick': 'x'.repeat(41),
      },
    });
    expect(out).toEqual({ 'empty.home': 'Soon.' });
  });
  it('identity values are validated by kind', () => {
    const vars = copyVars(COPY_DEFAULTS);
    expect(copyValueProblems(copyDef('brand.name')!, 'GamesKodex', vars)).toEqual([]);
    expect(copyValueProblems(copyDef('brand.name')!, '<b>X</b>', vars).length).toBeGreaterThan(0);
    expect(copyValueProblems(copyDef('email.contact')!, 'not-an-email', vars).length).toBe(1);
    expect(copyValueProblems(copyDef('brand.domain')!, 'gameskodex.com', vars)).toEqual([]);
    expect(copyValueProblems(copyDef('brand.domain')!, 'https://x', vars).length).toBe(1);
    expect(copyValueProblems(copyDef('empty.home')!, 'two\nlines', vars)[0]).toMatch(/single line/);
    expect(copyValueProblems(copyDef('empty.home')!, 'hi {brnad}', vars)[0]).toMatch(/\{brnad\}/);
    expect(copyValueProblems(copyDef('empty.home')!, 'bell\u0007', vars)[0]).toMatch(/control/);
  });
  it('placeholders: known ones fill, unknown ones are reported', () => {
    expect(fillTokens('{brand} · {domain} · {nope}', { brand: 'B', domain: 'b.com' })).toBe(
      'B · b.com · {nope}',
    );
    expect(unknownTokens('{brand} {email.contact} {x.y}')).toEqual(['{x.y}']);
  });
  it('mailto links encode subject / body (parentheses included)', () => {
    expect(mailtoHref('a@b.co', 'Hi (you)', 'line 1\nline 2')).toBe(
      'mailto:a@b.co?subject=Hi%20%28you%29&body=line%201%0Aline%202',
    );
  });
});

describe('markdown-lite: a safe AST, never HTML', () => {
  it('parses headings, paragraphs, lists, call-to-action, slots', () => {
    const b = parseDoc(
      '## Title\n\nOne\ntwo.\n\n- **a** item\n- b\n\n-> [Go](/x)\n\n{{promote-form}}',
    );
    expect(b.map((x) => x.t)).toEqual(['h2', 'p', 'ul', 'cta', 'slot']);
    expect(b[1]).toEqual({ t: 'p', c: [{ t: 'text', v: 'One two.' }] });
  });
  it('inline: bold, italic, links, escapes', () => {
    expect(parseInline('a **b** *c* [d](/e) \\*f\\*')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'link', href: '/e', c: [{ t: 'text', v: 'd' }] },
      { t: 'text', v: ' *f*' },
    ]);
  });
  it('containers: notes, warn label, consecutive cards share one grid, when', () => {
    const b = parseDoc(
      '::: card K1\n### A\nx\n:::\n\n::: card K2\n### B\ny\n:::\n\n::: warn Why\nz\n:::\n\n::: when quality\nq\n:::',
    );
    expect(b.map((x) => x.t)).toEqual(['cards', 'note', 'when']);
    expect((b[0] as Extract<Block, { t: 'cards' }>).cards.map((c) => c.kicker)).toEqual([
      'K1',
      'K2',
    ]);
    expect(b[1]).toMatchObject({ t: 'note', tone: 'warn', label: 'Why' });
  });
  it('unsafe links never survive: javascript:, protocol-relative, data:', () => {
    for (const bad of [
      'javascript:alert(1)',
      '//evil.example',
      '/\\evil.example', // browsers read "/\" as "//" (another site)
      '/ok\\path',
      'data:text/html,x',
      'JaVaScRiPt:x',
    ]) {
      expect(safeHref(bad)).toBeNull();
    }
    expect(safeHref('/about')).toBe('/about');
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('mailto:a@b.co?subject=x')).toBe('mailto:a@b.co?subject=x');
    const bad: string[] = [];
    const out = fillDoc(parseDoc('[click](javascript:alert(1))'), {}, bad);
    expect(JSON.stringify(out)).not.toMatch(/javascript/);
    expect(bad.length).toBe(1);
  });
  it('a placeholder value can never inject syntax (filled AFTER parsing)', () => {
    const out = fillDoc(parseDoc('Hello {brand}'), { brand: '**[x](javascript:y)**' });
    expect(out).toEqual([{ t: 'p', c: [{ t: 'text', v: 'Hello **[x](javascript:y)**' }] }]);
  });
  it('a document is checked on save: unknown slot / condition / unsafe link', () => {
    const vars = copyVars(COPY_DEFAULTS);
    const def = copyDef('about.body')!;
    expect(copyValueProblems(def, COPY_DEFAULTS['about.body']!, vars)).toEqual([]);
    expect(copyValueProblems(def, '{{nope}}', vars)[0]).toMatch(/unknown slot/);
    expect(copyValueProblems(def, '::: when nope\nx\n:::', vars)[0]).toMatch(/unknown condition/);
    expect(copyValueProblems(def, '[x](javascript:y)', vars)[0]).toMatch(/unsafe link/);
  });
  it('every shipped document default is valid', () => {
    const vars = copyVars(COPY_DEFAULTS);
    for (const k of ['about.body', 'methodology.body', 'promote.body', 'contact.body']) {
      expect(copyValueProblems(copyDef(k)!, COPY_DEFAULTS[k]!, vars)).toEqual([]);
    }
  });
});

describe('emails carry the configured brand + domain', () => {
  it('defaults keep the old wording; a brand passes through', () => {
    expect(verificationEmail('a@b.co', 't', 'https://x').subject).toBe(
      'Confirm your GamesKeep email',
    );
    const m = newsletterEmail('a@b.co', 'S', 'Body', 'tok', 'https://x', {
      name: 'GamesKodex',
      domain: 'gameskodex.com',
    });
    expect(m.bodyText).toMatch(/subscribed to GamesKodex updates \(gameskodex\.com\)/);
  });
});
