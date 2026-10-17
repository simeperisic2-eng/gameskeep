import { describe, it, expect } from 'vitest';
import { countSentences, validatePolish, wordDiff } from '../src/community/polish-validator';
import { detectScore } from '../src/critics/score-patterns';
import {
  firstSentences,
  leaksReviewerData,
  prepareBatch,
  scrubReviewText,
} from '../src/steam/review-summary';
import { mockReviewBatch } from '../src/data-source/steam/reviews';
import { publishProblems } from '../src/community/notes';
import { crossRuleErrors } from '../src/rules/settings';
import { RULES_DEFAULTS, steamAiSummaryLabel } from '@gameskeep/shared/constants';

// Hermetic (no DB): the Phase P S5 pure rules. Live behaviour: scripts/p-check.mjs S5.

const kinds = (o: string, c: string) =>
  validatePolish(o, c).issues.map((i) => `${i.kind}:${i.token}`);

describe('no-new-claims validator (the AI never adds a claim)', () => {
  const original =
    'players on reddit say the patch fixed most crashes, though performance on steam deck is still uneven. larian says more fixes are coming.';

  it('a tidy rewrite of the same words passes', () => {
    const v = validatePolish(
      original,
      'Players on Reddit say the patch fixed most crashes, though performance on Steam Deck is still uneven. Larian says more fixes are coming.',
    );
    expect(v.issues).toEqual([]);
    expect(v.ok).toBe(true);
  });
  it('compares case-insensitively — a lower-case word written by the editor may be capitalised', () => {
    expect(validatePolish('valve patched it.', 'Valve patched it.').ok).toBe(true);
    expect(validatePolish("larian's patch helped.", 'The Larian patch helped.').ok).toBe(true);
  });
  it('a new number (digits or words) is rejected', () => {
    expect(kinds(original, `${original} About 80% of reviews agree.`)).toContain('number:80%');
    expect(kinds('sales were strong.', 'Sales were strong, three times the target.')).toContain(
      'number:three',
    );
    expect(kinds('patch 5 fixed it.', 'Patch 50 fixed it.')).toContain('number:50');
    // the editor's own numbers stay fine
    expect(
      validatePolish('patch 5 fixed 80% of crashes.', 'Patch 5 fixed 80% of crashes.').ok,
    ).toBe(true);
  });
  it('a new name is rejected — mid-sentence or as a sentence opener', () => {
    expect(kinds(original, original.replace('larian says', 'Swen Vincke says'))).toEqual(
      expect.arrayContaining(['name:Swen', 'name:Vincke']),
    );
    expect(kinds('the patch helped.', 'Valve says the patch helped.')).toContain('name:Valve');
  });
  it('plain sentence openers are not names', () => {
    expect(
      validatePolish('players like it. a lot of fans agree.', 'Players like it. Many fans agree.')
        .ok,
    ).toBe(true);
    expect(validatePolish('the servers hold up.', 'However, the servers hold up.').ok).toBe(true);
  });
  it('new links, domains, emails and handles are rejected', () => {
    const k = kinds(
      'fans are happy.',
      'Fans are happy (see https://example.com/thread, reddit.com, mod@example.org and @gamerX).',
    );
    expect(k).toEqual(
      expect.arrayContaining([
        'link:https://example.com/thread',
        'link:reddit.com',
        'email:mod@example.org',
        'handle:@gamerX',
      ]),
    );
    // a link the editor wrote stays fine
    expect(
      validatePolish('see reddit.com/r/bg3 for more.', 'See reddit.com/r/bg3 for more.').ok,
    ).toBe(true);
  });
  it('decimals are numbers, not domains', () => {
    expect(kinds('rated well.', 'Rated 9.5 on average.')).toEqual(['number:9.5']);
  });
  it('malformed input does not throw', () => {
    expect(validatePolish('', '').ok).toBe(true);
    expect(validatePolish(undefined as unknown as string, 'New Name').ok).toBe(false);
  });
  it('the diff marks what changed', () => {
    expect(wordDiff('players like it', 'Players like it a lot')).toEqual([
      { op: 'del', text: 'players' },
      { op: 'add', text: 'Players' },
      { op: 'same', text: 'like it' },
      { op: 'add', text: 'a lot' },
    ]);
    expect(validatePolish('a b', 'a c').diff.map((d) => d.op)).toEqual(['same', 'del', 'add']);
  });
});

describe('sentence count', () => {
  it('counts sentences ending in . ! ? and a trailing remainder', () => {
    expect(countSentences('One. Two! Three?')).toBe(3);
    expect(countSentences('One. Two')).toBe(2);
    expect(countSentences('  ')).toBe(0);
    expect(countSentences('Only one sentence here.')).toBe(1);
  });
});

describe('score patterns → a suggestion the editor confirms', () => {
  const on = {
    scaleOutOf10: true,
    scaleOutOf5: true,
    scaleStars: true,
    scaleOutOf100: true,
    scaleLetter: false,
  };
  it('reads the common scales and normalises to 0..100', () => {
    expect(detectScore('Hades II review – 9/10', null, on)).toMatchObject({
      nativeScore: 9,
      scaleMax: 10,
      normalized: 90,
    });
    expect(detectScore('Review: 8.5 out of 10', null, on)).toMatchObject({ normalized: 85 });
    expect(detectScore('Verdict: 4/5', null, on)).toMatchObject({ scaleMax: 5, normalized: 80 });
    expect(detectScore('A 4.5-star adventure', null, on)).toMatchObject({
      nativeScore: 4.5,
      normalized: 90,
    });
    expect(detectScore('Our score ★★★★☆', null, on)).toMatchObject({ nativeScore: 4, scaleMax: 5 });
    expect(detectScore('Scored 87/100', null, on)).toMatchObject({ normalized: 87 });
  });
  it('the title wins; the excerpt is the fallback', () => {
    expect(detectScore('Great game, 9/10', 'we gave it 7/10 last year', on)?.normalized).toBe(90);
    expect(detectScore('A great game', 'Final verdict: 7/10.', on)?.normalized).toBe(70);
  });
  it('no score, dates, out-of-range and ambiguous texts give no suggestion', () => {
    expect(detectScore('Elden Ring review: a towering expansion', null, on)).toBeNull();
    expect(detectScore('Patch notes for 3/10/2026', null, on)).toBeNull();
    expect(detectScore('Rated 12/10', null, on)).toBeNull();
    expect(detectScore('It went from 6/10 to 9/10 after the patch', null, on)).toBeNull();
    expect(detectScore(null, undefined, on)).toBeNull();
  });
  it('scales follow the admin rule (letter grades off by default)', () => {
    expect(detectScore('Grade: B+', null, on)).toBeNull();
    expect(detectScore('Grade: B+', null, { ...on, scaleLetter: true })).toMatchObject({
      normalized: 87,
    });
    expect(detectScore('9/10', null, { ...on, scaleOutOf10: false })).toBeNull();
  });
});

describe('Steam reviews: reviewer data never reaches the AI or the summary', () => {
  it('scrubs names, handles, profile links, Steam ids, emails and URLs', () => {
    const out = scrubReviewText(
      'Agree with NightOwl_42 here (see steamcommunity.com/id/nightowl42, @Mara and 76561198000000001). Mail me at a@b.io or https://x.example/p',
      ['NightOwl_42', '76561198000000001'],
    );
    expect(out).not.toMatch(/NightOwl_42|steamcommunity|@Mara|7656119|a@b\.io|https?:/u);
    expect(out).toMatch(/another reviewer/u);
  });
  it('the fail-safe catches any name or id left', () => {
    expect(leaksReviewerData('Great game says Kestrel Vale', ['Kestrel Vale'])).toBe(true);
    expect(leaksReviewerData('id 76561198000000001', [])).toBe(true);
    expect(leaksReviewerData('Great combat and co-op.', ['Kestrel Vale'])).toBe(false);
  });
  it('the mock batches are deterministic, quote reviewers, and prepareBatch removes every one', () => {
    for (const appId of [1086940, 1245620, 1091500, 553850, 1145350, 292030]) {
      const batch = mockReviewBatch(appId, { days: 30, max: 200 });
      const strip = (b: typeof batch) => ({
        ...b,
        reviews: b.reviews.map(({ createdAt: _c, ...r }) => r),
      });
      expect(strip(mockReviewBatch(appId, { days: 30, max: 200 }))).toEqual(strip(batch));
      const names = batch.reviews.map((r) => r.authorName!).filter(Boolean);
      const quoting = batch.reviews.filter((r) => names.some((n) => r.text.includes(n)));
      const prep = prepareBatch(batch);
      if (batch.reviews.length >= 5) expect(quoting.length).toBeGreaterThan(0);
      for (const t of prep.texts) expect(leaksReviewerData(t, prep.names)).toBe(false);
      expect(prep.count).toBeGreaterThanOrEqual(batch.reviews.length);
      if (prep.positivePct != null) {
        expect(prep.positivePct).toBeGreaterThanOrEqual(0);
        expect(prep.positivePct).toBeLessThanOrEqual(100);
      }
    }
  });
  it('some demo games sit below the default threshold of 50', () => {
    const counts = Array.from(
      { length: 40 },
      (_, i) => mockReviewBatch(1000 + i * 7919, { days: 30, max: 200 }).totalInWindow,
    );
    expect(counts.some((c) => c < 50)).toBe(true);
    expect(counts.some((c) => c >= 50)).toBe(true);
  });
  it('an empty batch is safe', () => {
    expect(prepareBatch({ reviews: [], totalInWindow: 0, positiveInWindow: 0 })).toEqual({
      count: 0,
      positivePct: null,
      texts: [],
      names: [],
    });
  });
  it('the locked label states the count and the window', () => {
    expect(steamAiSummaryLabel(1234, 30)).toBe('AI summary of 1,234 Steam reviews, last 30 days');
    expect(steamAiSummaryLabel(1, 1)).toBe('AI summary of 1 Steam review, last 1 day');
    expect(firstSentences('One. Two. Three. Four.', 2)).toBe('One. Two.');
  });
});

describe('community note: what publishing requires', () => {
  const rules = { minSentences: 2, maxSentences: 3, maxChars: 600 };
  const src = [{ url: 'https://www.reddit.com/r/BaldursGate3/' }];
  it('a source link is required (fixed rule)', () => {
    expect(publishProblems({ text: 'Players like it. Many agree.', sources: [] }, rules)).toContain(
      'Add at least one source link.',
    );
    expect(
      publishProblems(
        { text: 'Players like it. Many agree.', sources: [{ url: 'javascript:alert(1)' }] },
        rules,
      ),
    ).toContain('Add at least one source link.');
    expect(publishProblems({ text: 'Players like it. Many agree.', sources: src }, rules)).toEqual(
      [],
    );
  });
  it('sentence count and length follow the rules; no future as-of date; not empty', () => {
    expect(publishProblems({ text: 'Only one.', sources: src }, rules)[0]).toMatch(
      /2–3 sentences/u,
    );
    expect(publishProblems({ text: 'A. B. C. D.', sources: src }, rules)[0]).toMatch(/now 4/u);
    expect(publishProblems({ text: `${'x'.repeat(601)}. Two.`, sources: src }, rules)).toContain(
      'Keep it under 600 characters.',
    );
    expect(
      publishProblems({ text: 'One. Two.', sources: src, asOf: '2999-01-01' }, rules),
    ).toContain('The as-of date cannot be in the future.');
    expect(publishProblems({ text: '  ', sources: src }, rules)).toContain('The note is empty.');
  });
  it('settings: the minimum sentences cannot exceed the maximum', () => {
    expect(
      crossRuleErrors({
        ...RULES_DEFAULTS,
        communityNote: { minSentences: 4, maxSentences: 3, maxChars: 600 },
      }),
    ).toHaveLength(1);
    expect(crossRuleErrors(RULES_DEFAULTS)).toEqual([]);
  });
  it('defaults match the owner decisions', () => {
    expect(RULES_DEFAULTS.editorial).toEqual({ teamScore: false, teamVerdict: false });
    expect(RULES_DEFAULTS.steamReviews.reviewsMin).toBe(50);
    expect(RULES_DEFAULTS.criticFeed.scaleLetter).toBe(false);
  });
});
