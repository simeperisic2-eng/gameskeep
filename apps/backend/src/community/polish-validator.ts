/**
 * The no-new-claims validator (Phase P S5 — a fixed rule: the AI never adds a
 * claim). Every AI polish of an editor's text — and any rewrite pasted from
 * elsewhere — is checked against the editor's ORIGINAL before it can be used:
 * a number, a name, a link, a domain, an email or a handle that is not in the
 * original is rejected. Comparison is case-insensitive (owner, S5), so a word
 * the editor wrote in lower case is not rejected for being capitalised. A new
 * capitalised word that starts a sentence is allowed only when it is a plain
 * function word (The, Many, However, …) — anything else counts as a new name.
 * PURE; unit-tested.
 */

export type PolishIssueKind = 'number' | 'name' | 'link' | 'email' | 'handle';
export interface PolishIssue {
  kind: PolishIssueKind;
  token: string;
}
export interface DiffOp {
  op: 'same' | 'add' | 'del';
  text: string;
}
export interface PolishVerdict {
  ok: boolean;
  issues: PolishIssue[];
  diff: DiffOp[];
}

const NUMBER_WORDS = new Set(
  (
    'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen ' +
    'fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ' +
    'ninety hundred hundreds thousand thousands million millions billion billions trillion dozen ' +
    'dozens half twice double triple quarter first second third fourth fifth sixth seventh ' +
    'eighth ninth tenth percent'
  ).split(' '),
);

/** Plain words a polished sentence may newly start with (never a name or a number). */
const SENTENCE_STARTERS = new Set(
  (
    'a an the this that these those it its they their there here he she we you i ' +
    'many most some several few all each every both overall however still meanwhile but and ' +
    'also while yet so in on at for with as since after before though although because when ' +
    'if once now then today recently lately largely somewhat players fans reviewers users ' +
    'people others critics'
  ).split(' '),
);

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"')\]]+/giu;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu;
const HANDLE_RE = /(?<![\p{L}\p{N}._%+-])@[\p{L}\p{N}_]{2,}/giu;
const DOMAIN_RE = /\b[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.(?:[\p{L}]{2,24})\b/giu;
const DIGITS_RE = /\p{N}[\p{N}.,:/%x×-]*/gu;
const WORD_RE = /[\p{L}][\p{L}\p{N}'’-]*/gu;

const norm = (s: string): string => s.normalize('NFKC').toLowerCase();
const trimToken = (t: string): string => t.replace(/[.,:;!?)\]]+$/u, '');

const bareNumber = (t: string): string => norm(t).replace(/[.,:/-]+$/u, '');

/** A word and its plain forms (possessive dropped, hyphen parts) — "Larian" matches "Larian's". */
function wordForms(w: string): string[] {
  const n = norm(w).replace(/’/gu, "'");
  const base = n.replace(/'s$/u, '').replace(/'$/u, '');
  return [...new Set([n, base, ...base.split('-').filter(Boolean)])];
}

function tokens(re: RegExp, text: string): string[] {
  return [...text.matchAll(re)].map((m) => trimToken(m[0])).filter(Boolean);
}

/** Words of a text that start a sentence (index into the word list). */
function sentenceStartWords(text: string): Set<number> {
  const starts = new Set<number>();
  let i = 0;
  let atStart = true;
  for (const m of text.matchAll(/[\p{L}][\p{L}\p{N}'’-]*|[.!?]+/gu)) {
    if (/^[.!?]+$/u.test(m[0])) {
      atStart = true;
      continue;
    }
    if (atStart) starts.add(i);
    atStart = false;
    i += 1;
  }
  return starts;
}

/** Word-level diff (LCS) for the editor's review. */
export function wordDiff(a: string, b: string): DiffOp[] {
  const x = a.split(/\s+/u).filter(Boolean);
  const y = b.split(/\s+/u).filter(Boolean);
  if (x.length * y.length > 400_000) {
    return [
      { op: 'del', text: x.join(' ') },
      { op: 'add', text: y.join(' ') },
    ];
  }
  const dp: number[][] = Array.from({ length: x.length + 1 }, () =>
    new Array<number>(y.length + 1).fill(0),
  );
  for (let i = x.length - 1; i >= 0; i -= 1) {
    for (let j = y.length - 1; j >= 0; j -= 1) {
      dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: DiffOp[] = [];
  const push = (op: DiffOp['op'], text: string): void => {
    const last = out[out.length - 1];
    if (last && last.op === op) last.text += ` ${text}`;
    else out.push({ op, text });
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    if (x[i] === y[j]) {
      push('same', x[i]!);
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      push('del', x[i]!);
      i += 1;
    } else {
      push('add', y[j]!);
      j += 1;
    }
  }
  while (i < x.length) push('del', x[i++]!);
  while (j < y.length) push('add', y[j++]!);
  return out;
}

export function validatePolish(original: string, candidate: string): PolishVerdict {
  const src = String(original ?? '');
  const out = String(candidate ?? '');
  const srcNorm = norm(src);
  const srcWords = new Set<string>();
  for (const w of tokens(WORD_RE, src)) for (const f of wordForms(w)) srcWords.add(f);
  const srcNumbers = new Set(tokens(DIGITS_RE, src).map(bareNumber).filter(Boolean));
  const issues: PolishIssue[] = [];
  const seen = new Set<string>();
  const flag = (kind: PolishIssueKind, token: string): void => {
    const key = `${kind}:${norm(token)}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ kind, token });
  };
  const inSource = (t: string): boolean => srcNorm.includes(norm(t));

  // Links, emails, handles, domains — anything addressable must already be there.
  let rest = out;
  for (const t of tokens(URL_RE, out)) if (!inSource(t)) flag('link', t);
  rest = rest.replace(URL_RE, ' ');
  for (const t of tokens(EMAIL_RE, rest)) if (!inSource(t)) flag('email', t);
  rest = rest.replace(EMAIL_RE, ' ');
  for (const t of tokens(HANDLE_RE, rest)) if (!inSource(t)) flag('handle', t);
  rest = rest.replace(HANDLE_RE, ' ');
  for (const t of tokens(DOMAIN_RE, rest)) {
    if (/\p{N}/u.test(t) && !/\p{L}{2,}/u.test(t.split('.').pop() ?? '')) continue; // "2.5" is a number
    if (!inSource(t)) flag('link', t);
  }
  rest = rest.replace(DOMAIN_RE, (m) => (/^\p{N}/u.test(m) ? m : ' '));

  // Numbers: digits and number words.
  for (const t of tokens(DIGITS_RE, rest)) {
    const bare = bareNumber(t);
    if (bare && !srcNumbers.has(bare)) flag('number', bare);
  }
  const words = tokens(WORD_RE, rest);
  for (const w of words) {
    if (NUMBER_WORDS.has(norm(w)) && !srcWords.has(norm(w))) flag('number', w);
  }

  // Names: a capitalised word the editor never wrote (any case).
  const starts = sentenceStartWords(rest);
  words.forEach((w, idx) => {
    if (!/^\p{Lu}/u.test(w)) return;
    const n = norm(w);
    if (wordForms(w).some((f) => srcWords.has(f)) || NUMBER_WORDS.has(n)) return;
    if (starts.has(idx) && SENTENCE_STARTERS.has(n)) return;
    flag('name', w);
  });

  return { ok: issues.length === 0, issues, diff: wordDiff(src, out) };
}

/** Sentences in a text (a run ending in . ! or ? — or the trailing remainder). */
export function countSentences(text: string): number {
  const parts = String(text ?? '')
    .split(/(?<=[.!?])\s+/u)
    .map((p) => p.trim())
    .filter((p) => /\p{L}/u.test(p));
  return parts.length;
}
