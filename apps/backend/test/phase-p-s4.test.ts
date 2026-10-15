import { describe, it, expect } from 'vitest';
import {
  LIST_DETECT_DEFAULTS,
  NEWS_CATEGORY_SEED,
  RULE_BOUNDS,
  RULES_DEFAULTS,
} from '@gameskeep/shared/constants';
import {
  editorialListEntriesInput,
  editorialListInput,
  listLexiconInput,
  newsCategoryCreate,
  topicCreate,
} from '@gameskeep/shared/validation';
import {
  classifyArticle,
  keysInModes,
  modeMap,
  phraseMatch,
  topicCategoryOf,
  type NewsCategory,
} from '../src/news/categories';
import { topicIndexable, type TopicIndexFacts } from '../src/seo/indexing';
import { buildTsQuery, normalizeQuery, searchGroupOf } from '../src/search/query';
import {
  computeConsensus,
  detectListCandidate,
  parseEntries,
  type ConsensusList,
} from '../src/lists/rules';
import { rulesPatchErrors } from '../src/rules/settings';
import { addDebounced } from '../src/jobs/debounce';
import { curateConsensus } from '../src/lists/service';

// Hermetic (no DB): the Phase P S4 pure rules — category classifier, story
// indexing, search query building, list detection / parsing / consensus.
// Live behaviour is proven by scripts/p-check.mjs S4.

const CATS: NewsCategory[] = NEWS_CATEGORY_SEED.map((c) => ({ ...c, keywords: [...c.keywords] }));

describe('news categories: phrase matching', () => {
  it('matches whole words only', () => {
    expect(phraseMatch('Elden Ring guide: every boss', 'guide')).toBe(true);
    expect(phraseMatch('A guided tour of the studio', 'guide')).toBe(false);
    expect(phraseMatch('Misguide', 'guide')).toBe(false);
  });
  it('handles phrases that start or end with punctuation', () => {
    expect(phraseMatch('Cyberpunk 2077 is 60% off', '% off')).toBe(true);
    expect(phraseMatch('Every FromSoftware game, ranked', ', ranked')).toBe(true);
    expect(phraseMatch('Every game ranked', ', ranked')).toBe(false);
  });
  it('treats regex characters in a phrase literally', () => {
    expect(phraseMatch('a.b test', 'a.b')).toBe(true);
    expect(phraseMatch('axb test', 'a.b')).toBe(false);
    expect(phraseMatch('anything', '(.*)')).toBe(false);
    expect(phraseMatch('anything', '   ')).toBe(false);
  });
  it('is case-insensitive', () => {
    expect(phraseMatch('BEST DEALS THIS WEEK', 'deals')).toBe(true);
  });
});

describe('news categories: classifier', () => {
  it('a feed type other than news wins when that category exists', () => {
    expect(classifyArticle({ title: 'Big deals on sale', articleType: 'review' }, CATS)).toBe(
      'review',
    );
    expect(classifyArticle({ title: 'Anything', articleType: 'guide' }, CATS)).toBe('guide');
  });
  it('an unknown feed type falls through to keywords', () => {
    expect(classifyArticle({ title: 'Price drop on GTA', articleType: 'podcast' }, CATS)).toBe(
      'deals',
    );
  });
  it('the highest-priority keyword wins (deals 40 > listicle 35 > guide 30)', () => {
    expect(classifyArticle({ title: 'Best deals: a guide', articleType: 'news' }, CATS)).toBe(
      'deals',
    );
    expect(classifyArticle({ title: 'Top 10 tips and tricks', articleType: 'news' }, CATS)).toBe(
      'listicle',
    );
    expect(classifyArticle({ title: 'Helldivers 2 guide: how to unlock everything' }, CATS)).toBe(
      'guide',
    );
  });
  it('year lists read as listicles (only confirmed lists are ours to show)', () => {
    expect(classifyArticle({ title: 'The best games of 2026 so far' }, CATS)).toBe('listicle');
    // News about an award is news.
    expect(classifyArticle({ title: 'Astro Bot wins Game of the Year' }, CATS)).toBe('news');
  });
  it('title only by default; the excerpt when enabled', () => {
    const a = { title: 'Elden Ring update', excerpt: 'And it is 50% off this week' };
    expect(classifyArticle(a, CATS)).toBe('news');
    expect(classifyArticle(a, CATS, { excerpt: true })).toBe('deals');
  });
  it('no match → the fallback; malformed input does not throw', () => {
    expect(classifyArticle({ title: 'Rockstar confirms GTA 6 delay' }, CATS)).toBe('news');
    expect(classifyArticle({ title: '', excerpt: null, articleType: null }, CATS)).toBe('news');
    expect(classifyArticle({ title: 'x' }, [])).toBe('news');
  });
  it('mode helpers', () => {
    const modes = modeMap(CATS);
    expect(modes.get('deals')).toBe('low');
    expect(modes.get('guide')).toBe('low');
    expect(modes.get('listicle')).toBe('hide');
    expect(keysInModes(CATS, ['hide']).sort()).toEqual(['listicle']);
    expect(keysInModes(CATS, ['low', 'hide']).sort()).toEqual(['deals', 'guide', 'listicle']);
  });
  it('validation: keys are lowercase slugs, modes enumerated', () => {
    expect(
      newsCategoryCreate.safeParse({ key: 'deals', label: 'Deals', mode: 'low' }).success,
    ).toBe(true);
    expect(
      newsCategoryCreate.safeParse({ key: 'Deals!', label: 'Deals', mode: 'low' }).success,
    ).toBe(false);
    expect(
      newsCategoryCreate.safeParse({ key: 'deals', label: 'Deals', mode: 'loud' }).success,
    ).toBe(false);
  });
});

describe('news categories: a story takes the category of most of its articles', () => {
  const modes = modeMap(CATS);
  it('the majority category at or above the share wins', () => {
    expect(
      topicCategoryOf(
        [
          { cat: 'deals', n: 2 },
          { cat: 'news', n: 1 },
        ],
        modes,
        50,
      ),
    ).toBe('deals');
    expect(topicCategoryOf([{ cat: 'review', n: 3 }], modes, 50)).toBe('review');
  });
  it('below the share → news', () => {
    expect(
      topicCategoryOf(
        [
          { cat: 'deals', n: 2 },
          { cat: 'news', n: 1 },
          { cat: 'review', n: 2 },
        ],
        modes,
        50,
      ),
    ).toBe('news');
    expect(
      topicCategoryOf(
        [
          { cat: 'deals', n: 2 },
          { cat: 'news', n: 1 },
        ],
        modes,
        70,
      ),
    ).toBe('news');
  });
  it('a tie never demotes a story (show → low → hide; news first)', () => {
    // One deals piece joining one news piece: the story stays news.
    expect(
      topicCategoryOf(
        [
          { cat: 'deals', n: 1 },
          { cat: 'news', n: 1 },
        ],
        modes,
        50,
      ),
    ).toBe('news');
    expect(
      topicCategoryOf(
        [
          { cat: 'review', n: 1 },
          { cat: 'deals', n: 1 },
        ],
        modes,
        50,
      ),
    ).toBe('review');
    expect(
      topicCategoryOf(
        [
          { cat: 'listicle', n: 1 },
          { cat: 'guide', n: 1 },
        ],
        modes,
        50,
      ),
    ).toBe('guide');
    expect(
      topicCategoryOf(
        [
          { cat: 'opinion', n: 1 },
          { cat: 'news', n: 1 },
        ],
        modes,
        50,
      ),
    ).toBe('news');
  });
  it('empty or malformed counts → news', () => {
    expect(topicCategoryOf([], modes, 50)).toBe('news');
    expect(topicCategoryOf([{ cat: 'deals', n: 0 }], modes, 50)).toBe('news');
    expect(
      topicCategoryOf(
        [
          { cat: '', n: 3 },
          { cat: 'deals', n: Number.NaN },
        ],
        modes,
        50,
      ),
    ).toBe('news');
  });
  it('an unknown (deleted / inactive) category counts as shown', () => {
    expect(
      topicCategoryOf(
        [
          { cat: 'gone', n: 2 },
          { cat: 'news', n: 1 },
        ],
        modes,
        50,
      ),
    ).toBe('gone');
    expect(
      topicCategoryOf(
        [
          { cat: 'gone', n: 1 },
          { cat: 'deals', n: 1 },
        ],
        modes,
        50,
      ),
    ).toBe('gone');
  });
});

describe('story indexing (automatic / index / noindex)', () => {
  const rules = RULES_DEFAULTS.seo;
  const modes = modeMap(CATS);
  const f = (o: Partial<TopicIndexFacts>): TopicIndexFacts => ({
    seoIndex: 'auto',
    sources: 1,
    hasSummary: false,
    hasGame: false,
    category: 'news',
    ...o,
  });
  it('a single-source story is noindex; two sources index', () => {
    expect(topicIndexable(f({ sources: 1 }), rules, modes)).toBe(false);
    expect(topicIndexable(f({ sources: 2 }), rules, modes)).toBe(true);
  });
  it('one source with a summary AND a game indexes (setting)', () => {
    expect(topicIndexable(f({ hasSummary: true, hasGame: true }), rules, modes)).toBe(true);
    expect(topicIndexable(f({ hasSummary: true }), rules, modes)).toBe(false);
    expect(
      topicIndexable(
        f({ hasSummary: true, hasGame: true }),
        { ...rules, indexIfSummaryAndGame: false },
        modes,
      ),
    ).toBe(false);
  });
  it('a hidden-category story is never auto-indexed (setting)', () => {
    expect(topicIndexable(f({ sources: 5, category: 'listicle' }), rules, modes)).toBe(false);
    expect(
      topicIndexable(
        f({ sources: 5, category: 'listicle' }),
        { ...rules, noindexHiddenCategories: false },
        modes,
      ),
    ).toBe(true);
    // low mode stays indexable
    expect(topicIndexable(f({ sources: 2, category: 'deals' }), rules, modes)).toBe(true);
  });
  it('the editor always wins', () => {
    expect(
      topicIndexable(f({ seoIndex: 'index', sources: 1, category: 'listicle' }), rules, modes),
    ).toBe(true);
    expect(topicIndexable(f({ seoIndex: 'noindex', sources: 9 }), rules, modes)).toBe(false);
  });
  it('an unknown category counts as shown', () => {
    expect(topicIndexable(f({ sources: 2, category: 'gone' }), rules, modes)).toBe(true);
  });
  it('topic validation takes the three modes only', () => {
    expect(topicCreate.partial().safeParse({ seoIndex: 'noindex' }).success).toBe(true);
    expect(topicCreate.partial().safeParse({ seoIndex: 'maybe' }).success).toBe(false);
  });
});

describe('search query building (injection-safe)', () => {
  it('keeps letters and digits only, lowercased, max 8 words', () => {
    expect(normalizeQuery('  Elden  RING ', 100)).toEqual({
      norm: 'elden ring',
      tokens: ['elden', 'ring'],
    });
    expect(normalizeQuery("baldur's gate 3", 100).tokens).toEqual(['baldur', 's', 'gate', '3']);
    expect(normalizeQuery('a b c d e f g h i j', 100).tokens).toHaveLength(8);
  });
  it('accents and other scripts survive (unaccent happens in SQL)', () => {
    expect(normalizeQuery('Pokémon', 100).tokens).toEqual(['pokémon']);
    expect(normalizeQuery('原神', 100).tokens).toEqual(['原神']);
  });
  it('non-strings, empty and operator-only inputs give no query', () => {
    for (const raw of [
      undefined,
      null,
      42,
      {},
      ['x'],
      '',
      '   ',
      "'; DROP TABLE games; --",
      '&|!():*<->',
    ]) {
      const { tokens } = normalizeQuery(raw, 100);
      const tsq = buildTsQuery(tokens);
      if (tsq !== null) expect(tsq).toMatch(/^[\p{L}\p{N}]+(:\*)?( & [\p{L}\p{N}]+(:\*)?)*$/u);
    }
    expect(buildTsQuery(normalizeQuery('&|!():*', 100).tokens)).toBeNull();
    expect(buildTsQuery(normalizeQuery(42, 100).tokens)).toBeNull();
  });
  it('SQL / tsquery metacharacters never reach the tsquery', () => {
    const tsq = buildTsQuery(normalizeQuery("zelda' | !:* & (x)", 100).tokens);
    expect(tsq).toBe('zelda & x:*');
  });
  it('the last word is a prefix; the length cap applies first', () => {
    expect(buildTsQuery(['eld'])).toBe('eld:*');
    expect(buildTsQuery(['elden', 'ri'])).toBe('elden & ri:*');
    expect(normalizeQuery('x'.repeat(500), 100).norm.length).toBeLessThanOrEqual(40);
    expect(normalizeQuery('abc def', 3).tokens).toEqual(['abc']);
  });
  it('a token that is not letters/digits is dropped by buildTsQuery', () => {
    expect(buildTsQuery(['ok', 'a:b', "x'"])).toBe('ok:*');
  });
});

describe('editorial lists: candidate detection', () => {
  const lex = LIST_DETECT_DEFAULTS;
  it('finds best-of-year and GOTY titles with their year', () => {
    expect(detectListCandidate('The best games of 2024', lex)).toEqual({
      year: 2024,
      categoryKey: 'best-of-year',
    });
    expect(detectListCandidate('Our Game of the Year 2025, and why it won', lex)).toEqual({
      year: 2025,
      categoryKey: 'goty',
    });
    expect(detectListCandidate('GOTY 2023: the shortlist', lex)).toEqual({
      year: 2023,
      categoryKey: 'goty',
    });
  });
  it('no year → year null (an editor fills it before confirming)', () => {
    expect(detectListCandidate('The best games of the decade', lex)).toEqual({
      year: null,
      categoryKey: 'best-of-year',
    });
  });
  it('ordinary news is not a candidate', () => {
    expect(detectListCandidate('Rockstar confirms GTA 6 delay', lex)).toBeNull();
    expect(detectListCandidate('', lex)).toBeNull();
    expect(detectListCandidate('Gotye interview', lex)).toBeNull();
  });
  it('lexicon validation lowercases and bounds phrases', () => {
    const p = listLexiconInput.parse({ patterns: ['  Best Games OF '], gotyPatterns: ['GOTY'] });
    expect(p).toEqual({ patterns: ['best games of'], gotyPatterns: ['goty'] });
    expect(listLexiconInput.safeParse({ patterns: ['x'], gotyPatterns: [] }).success).toBe(false);
  });
});

describe('editorial lists: entry parsing', () => {
  it('reads the common ranked formats and keeps their numbers', () => {
    expect(
      parseEntries(
        '1. Baldur’s Gate 3\n2) Alan Wake 2\n#3 Pizza Tower\n4 - Lethal Company\n5: Tekken 8',
      ),
    ).toEqual([
      { rank: 1, name: 'Baldur’s Gate 3' },
      { rank: 2, name: 'Alan Wake 2' },
      { rank: 3, name: 'Pizza Tower' },
      { rank: 4, name: 'Lethal Company' },
      { rank: 5, name: 'Tekken 8' },
    ]);
  });
  it('unnumbered lines take the next rank; blank lines and CRLF are fine', () => {
    expect(parseEntries('Balatro\r\n\r\nHades II\n7. Manor Lords\nTekken 8')).toEqual([
      { rank: 1, name: 'Balatro' },
      { rank: 2, name: 'Hades II' },
      { rank: 7, name: 'Manor Lords' },
      { rank: 8, name: 'Tekken 8' },
    ]);
  });
  it('a name that starts with a number keeps it when unranked-looking input is ranked', () => {
    expect(parseEntries('1. 1000xResist')).toEqual([{ rank: 1, name: '1000xResist' }]);
  });
  it('bounds: rank 0 dropped, ≤ 200 entries, names clipped to 300', () => {
    expect(parseEntries('0. Nothing')).toEqual([]);
    const many = Array.from({ length: 300 }, (_, i) => `Game ${i}`).join('\n');
    expect(parseEntries(many)).toHaveLength(200);
    expect(parseEntries(`1. ${'x'.repeat(1000)}`)[0]!.name).toHaveLength(300);
    expect(parseEntries(undefined as unknown as string)).toEqual([]);
  });
  it('input is size-capped at the boundary', () => {
    expect(editorialListEntriesInput.safeParse({ text: 'x'.repeat(20_001) }).success).toBe(false);
  });
  it('a list needs an http(s) link', () => {
    const base = { outletName: 'IGN', title: 'Best of 2024' };
    expect(editorialListInput.safeParse({ ...base, url: 'https://ign.com/x' }).success).toBe(true);
    expect(editorialListInput.safeParse({ ...base, url: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    expect(editorialListInput.safeParse({ ...base, url: 'ftp://x.y/z' }).success).toBe(false);
    expect(editorialListInput.safeParse(base).success).toBe(false);
  });
});

describe('editorial lists: consensus', () => {
  const L = (id: string, outlet: string, games: (string | null)[]): ConsensusList => ({
    id,
    outlet,
    url: `https://${outlet.toLowerCase()}.example/list`,
    entries: games.map((g, i) => ({ rank: i + 1, gameId: g })),
  });
  const opts = { minAppearances: 2, deviationTopN: 10 };

  it('ranks by appearances, then average rank, then best rank, then name', () => {
    const rows = computeConsensus(
      [
        L('a', 'IGN', ['x', 'y', 'z']),
        L('b', 'GameSpot', ['y', 'x', 'w']),
        L('c', 'Polygon', ['z', 'w', 'x']),
      ],
      opts,
    );
    // x: 3 lists avg 2; y: 2 avg 1.5; z: 2 avg 2; w: 2 avg 2.5
    expect(rows.map((r) => [r.gameId, r.appearances, r.avgRank, r.position])).toEqual([
      ['x', 3, 2, 1],
      ['y', 2, 1.5, 2],
      ['z', 2, 2, 3],
      ['w', 2, 2.5, 4],
    ]);
  });
  it('ties after avg and best fall to the name', () => {
    const names: Record<string, string> = { p: 'Beta', q: 'Alpha' };
    const rows = computeConsensus(
      [L('a', 'A', ['p', 'q']), L('b', 'B', ['q', 'p'])],
      opts,
      (id) => names[id]!,
    );
    expect(rows.map((r) => r.gameId)).toEqual(['q', 'p']);
  });
  it('a game on one list is never in the consensus — the floor is 2 even if set lower', () => {
    const rows = computeConsensus([L('a', 'IGN', ['solo', 'x']), L('b', 'GS', ['x'])], {
      ...opts,
      minAppearances: 1,
    });
    const solo = rows.find((r) => r.gameId === 'solo')!;
    expect(solo.inConsensus).toBe(false);
    expect(solo.position).toBeNull();
    expect(rows.find((r) => r.gameId === 'x')!.position).toBe(1);
  });
  it('a game listed twice on one list counts once, at its best rank; null games are ignored', () => {
    const rows = computeConsensus([L('a', 'IGN', ['x', null, 'x']), L('b', 'GS', ['x'])], opts);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.appearances).toBe(2);
    expect(rows[0]!.positions.map((p) => p.rank)).toEqual([1, 1]);
  });
  it('comparison lines are data only', () => {
    const rows = computeConsensus(
      [L('a', 'IGN', ['solo', 'x']), L('b', 'GameSpot', ['x', 'y']), L('c', 'Polygon', ['y', 'x'])],
      opts,
    );
    const solo = rows.find((r) => r.gameId === 'solo')!;
    expect(solo.lines.map((l) => l.text)).toContain(
      '#1 at IGN; absent from every other outlet’s top 10',
    );
    const x = rows.find((r) => r.gameId === 'x')!;
    expect(x.lines.find((l) => l.key === 'coverage')!.text).toBe('On 3 of 3 lists');
    expect(x.lines.find((l) => l.key === 'spread')!.text).toBe('#1 at GameSpot to #2 at Polygon');
    // x is #1 at one outlet but also in others' top 10 → no soloTop line
    expect(x.lines.some((l) => l.key === 'soloTop')).toBe(false);
    // same rank everywhere → no spread line
    const flat = computeConsensus([L('a', 'A', ['g']), L('b', 'B', ['g'])], opts)[0]!;
    expect(flat.lines.some((l) => l.key === 'spread')).toBe(false);
  });
  it('soloTop respects deviationTopN', () => {
    const lists = [
      L('a', 'IGN', ['g']),
      L(
        'b',
        'GS',
        Array.from({ length: 12 }, (_, i) => (i === 11 ? 'g' : `f${i}`)),
      ),
    ];
    expect(
      computeConsensus(lists, { ...opts, deviationTopN: 10 })[0]!.lines.some(
        (l) => l.key === 'soloTop',
      ),
    ).toBe(true);
    const g = computeConsensus(lists, { ...opts, deviationTopN: 12 }).find(
      (r) => r.gameId === 'g',
    )!;
    expect(g.lines.some((l) => l.key === 'soloTop')).toBe(false);
  });
  it('empty input → no rows', () => {
    expect(computeConsensus([], opts)).toEqual([]);
    expect(computeConsensus([L('a', 'A', [])], opts)).toEqual([]);
  });
});

describe('S4 settings: defaults and bounds', () => {
  it('defaults match the owner answers', () => {
    expect(RULES_DEFAULTS.seo.topicMinSources).toBe(2);
    expect(RULES_DEFAULTS.editorialLists.indexMinLists).toBe(3);
    expect(RULES_DEFAULTS.editorialLists.minAppearances).toBe(2);
    expect(RULES_DEFAULTS.news.lowSearchable).toBe(true);
    expect(RULES_DEFAULTS.news.hideSearchable).toBe(false);
    const seed = Object.fromEntries(NEWS_CATEGORY_SEED.map((c) => [c.key, c.mode]));
    expect(seed).toMatchObject({ deals: 'low', guide: 'low', listicle: 'hide', news: 'show' });
  });
  it('the consensus floor of 2 is enforced at the settings boundary', () => {
    expect(RULE_BOUNDS['editorialLists.minAppearances']![0]).toBe(2);
    expect(rulesPatchErrors({ editorialLists: { minAppearances: 1 } }).length).toBeGreaterThan(0);
    expect(rulesPatchErrors({ editorialLists: { minAppearances: 3 } })).toEqual([]);
    expect(rulesPatchErrors({ search: { rateLimitPerClient: 0 } }).length).toBeGreaterThan(0);
    expect(rulesPatchErrors({ seo: { topicMinSources: 'two' } }).length).toBeGreaterThan(0);
  });
});

describe('debounced jobs never lose a change made mid-run', () => {
  type FakeJob = { id: string; state: string; removed?: boolean };
  function fakeQueue(initial: FakeJob[] = []) {
    const jobs = new Map(initial.map((j) => [j.id, j]));
    const added: string[] = [];
    let seq = 0;
    const q = {
      getJob: async (id: string) => {
        const j = jobs.get(id);
        return j
          ? {
              getState: async () => j.state,
              remove: async () => {
                jobs.delete(id);
              },
            }
          : undefined;
      },
      add: async (_n: string, _d: unknown, o: { jobId?: string }) => {
        const id = o.jobId ?? `u${++seq}`;
        jobs.set(id, { id, state: 'delayed' });
        added.push(id);
        return { id };
      },
    };
    return { q: q as unknown as Parameters<typeof addDebounced>[0], jobs, added };
  }
  it('nothing queued → the base id', async () => {
    const f = fakeQueue();
    expect(await addDebounced(f.q, 'x', {}, 'auto', 10)).toBe('auto');
    expect(f.added).toEqual(['auto']);
  });
  it('a pending run absorbs the request', async () => {
    const f = fakeQueue([{ id: 'auto', state: 'delayed' }]);
    expect(await addDebounced(f.q, 'x', {}, 'auto', 10)).toBe('auto');
    expect(f.added).toEqual([]);
  });
  it('an ACTIVE run gets a follow-up under the other id', async () => {
    const f = fakeQueue([{ id: 'auto', state: 'active' }]);
    expect(await addDebounced(f.q, 'x', {}, 'auto', 10)).toBe('auto-next');
    expect(f.added).toEqual(['auto-next']);
    // a second request joins that follow-up
    expect(await addDebounced(f.q, 'x', {}, 'auto', 10)).toBe('auto-next');
    expect(f.added).toEqual(['auto-next']);
  });
  it('the follow-up running → the base id again', async () => {
    const f = fakeQueue([{ id: 'auto-next', state: 'active' }]);
    expect(await addDebounced(f.q, 'x', {}, 'auto', 10)).toBe('auto');
  });
  it('a leftover finished id is replaced, not trusted', async () => {
    const f = fakeQueue([{ id: 'auto', state: 'completed' }]);
    expect(await addDebounced(f.q, 'x', {}, 'auto', 10)).toBe('auto');
    expect(f.added).toEqual(['auto']);
  });
  it('both ids busy → a unique follow-up', async () => {
    const f = fakeQueue([
      { id: 'auto', state: 'active' },
      { id: 'auto-next', state: 'active' },
    ]);
    expect(await addDebounced(f.q, 'x', {}, 'auto', 10)).toBe('u1');
  });
});

describe('editorial lists: the public order (pins / excludes / cap)', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((slug) => ({ slug }));
  const order = (cur: { pins: string[]; excludes: string[] }, max = 25) =>
    curateConsensus(rows, cur, max).map((r) => r.slug);
  it('no curation → the computed order', () => {
    expect(order({ pins: [], excludes: [] })).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
  it('pins lead in pin order; excludes drop; the cap applies last', () => {
    expect(order({ pins: ['d', 'b'], excludes: ['a'] })).toEqual(['d', 'b', 'c', 'e']);
    expect(order({ pins: ['e'], excludes: [] }, 2)).toEqual(['e', 'a']);
  });
  it('a pin outside the consensus never enters it; duplicates are harmless', () => {
    expect(order({ pins: ['zzz', 'c', 'c'], excludes: [] })).toEqual(['c', 'a', 'b', 'd', 'e']);
  });
  it('an excluded pin stays out; a zero cap shows nothing', () => {
    expect(order({ pins: ['b'], excludes: ['b'] })).toEqual(['a', 'c', 'd', 'e']);
    expect(order({ pins: [], excludes: [] }, 0)).toEqual([]);
  });
});

describe('search ?type= takes own group names only', () => {
  it('the three groups pass', () => {
    expect(searchGroupOf('games')).toBe('games');
    expect(searchGroupOf('stories')).toBe('stories');
    expect(searchGroupOf('sources')).toBe('sources');
  });
  it('prototype keys and junk are refused (was: ?type=__proto__ → 500)', () => {
    for (const t of [
      '__proto__',
      'constructor',
      'toString',
      'hasOwnProperty',
      'Games',
      '',
      null,
      1,
      ['games'],
    ]) {
      expect(searchGroupOf(t)).toBeNull();
    }
  });
});

describe('rules patch: inherited names are not rules (self-review)', () => {
  it('constructor / toString / __proto__-like keys → "unknown rule" at every level', () => {
    for (const patch of [
      { constructor: 1 },
      { homepage: { constructor: 1 } },
      { search: { toString: 2 } },
      { editorialLists: { hasOwnProperty: true } },
    ]) {
      expect(rulesPatchErrors(patch).some((e) => /unknown rule/.test(e))).toBe(true);
    }
  });
});
