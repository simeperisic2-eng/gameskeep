import { createHash } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import {
  NEWS_FALLBACK_CATEGORY,
  SEARCH_GROUPS,
  type SearchGroup,
} from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { redis } from '../redis/client';
import { rulesSettings } from '../rules/settings';
import { curationFor } from '../curation/service';
import { keysInModes, newsCategories } from '../news/categories';
import { SEARCH_VERSION_KEY } from './index';

/**
 * Site search (Phase P S4) over `search_index`: Postgres full-text with a prefix
 * on the last word ("eld" finds Elden Ring), plus a trigram fallback for typos.
 * Input is reduced to letters / digits tokens before it reaches SQL (and is then
 * bound as a parameter), so no tsquery operator or LIKE wildcard can be injected.
 * Answers are cached briefly per query (Redis, versioned); the typeahead is
 * rate-limited per client + globally. Visibility (hidden items, story categories
 * in "low" / "hide") is applied at query time.
 */
export interface SearchHit {
  slug: string;
  title: string;
  subtitle: string | null;
  /** Stories: the category label when it is not plain news (shown as a chip). */
  category: string | null;
}
export interface SearchResult {
  q: string;
  /** Too short to search (typeahead below the minimum). */
  tooShort: boolean;
  groups: Record<SearchGroup, SearchHit[]>;
  /** Results page: matches per group. */
  totals?: Record<SearchGroup, number>;
  type?: SearchGroup | null;
  page?: number;
  pageSize?: number;
}

const ENTITY: Record<SearchGroup, 'game' | 'topic' | 'source'> = {
  games: 'game',
  stories: 'topic',
  sources: 'source',
};
const GROUP_OF: Record<string, SearchGroup> = {
  game: 'games',
  topic: 'stories',
  source: 'sources',
};
/** A request's ?type= as a group — own values only (never a prototype key like "__proto__"). */
export function searchGroupOf(raw: unknown): SearchGroup | null {
  return typeof raw === 'string' && (SEARCH_GROUPS as readonly string[]).includes(raw)
    ? (raw as SearchGroup)
    : null;
}
const groupOfEntity = (et: string): SearchGroup | null =>
  Object.prototype.hasOwnProperty.call(GROUP_OF, et) ? GROUP_OF[et]! : null;
const emptyGroups = (): Record<SearchGroup, SearchHit[]> => ({
  games: [],
  stories: [],
  sources: [],
});

/** Letters / digits tokens only (max 8, each ≤ 40 chars); `norm` is them joined. Pure. */
export function normalizeQuery(raw: unknown, maxChars: number): { norm: string; tokens: string[] } {
  const text = String(typeof raw === 'string' ? raw : '')
    .normalize('NFKC')
    .slice(0, Math.max(1, maxChars))
    .toLowerCase();
  const tokens = text
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8)
    .map((t) => t.slice(0, 40));
  return { norm: tokens.join(' '), tokens };
}

/** "a & b:*" — every word required, the last one as a prefix. Pure; null when empty. */
export function buildTsQuery(tokens: string[]): string | null {
  const clean = tokens.filter((t) => /^[\p{L}\p{N}]+$/u.test(t));
  if (clean.length === 0) return null;
  return clean.map((t, i) => (i === clean.length - 1 ? `${t}:*` : t)).join(' & ');
}

interface GroupOpts {
  limit: number;
  offset: number;
  excludedCategories: string[];
  fuzzy: boolean;
  fuzzyThreshold: number;
  weights: { exact: number; prefix: number; text: number };
}

async function queryGroup(
  group: SearchGroup,
  tsq: string,
  norm: string,
  o: GroupOpts,
): Promise<{ hits: (SearchHit & { score: number })[]; total: number }> {
  const et = ENTITY[group];
  const catFilter: SQL =
    et === 'topic' && o.excludedCategories.length
      ? sql`AND coalesce(si.category, ${NEWS_FALLBACK_CATEGORY}) NOT IN (${sql.join(
          o.excludedCategories.map((c) => sql`${c}`),
          sql`, `,
        )})`
      : sql``;
  const res = await db.execute(sql`
    WITH q AS (SELECT to_tsquery('simple', unaccent(${tsq})) AS tsq, lower(unaccent(${norm})) AS qn)
    SELECT si.slug, si.title, si.subtitle, si.category,
           (${o.weights.text} * ts_rank_cd(si.tsv, q.tsq)
            + CASE WHEN si.title_norm = q.qn THEN ${o.weights.exact} ELSE 0 END
            + CASE WHEN si.title_norm LIKE q.qn || '%' THEN ${o.weights.prefix} ELSE 0 END)::float8 AS score,
           count(*) OVER ()::int AS total
    FROM search_index si, q
    WHERE si.entity_type = ${et} AND NOT si.hidden AND si.tsv @@ q.tsq ${catFilter}
    ORDER BY score DESC, si.sort_date DESC NULLS LAST, si.title ASC
    LIMIT ${o.limit} OFFSET ${o.offset}
  `);
  const rows = rowsOf<{
    slug: string;
    title: string;
    subtitle: string | null;
    category: string | null;
    score: number;
    total: number;
  }>(res);
  let total = rows[0]?.total ?? 0;
  const hits = rows.map((r) => ({
    slug: r.slug,
    title: r.title,
    subtitle: r.subtitle,
    category: r.category,
    score: Number(r.score),
  }));
  // Typo tolerance: a FALLBACK — only when the exact words found nothing (padding real
  // hits with look-alikes made "eld" suggest Battlefield; S4 visual gate).
  if (o.fuzzy && o.offset === 0 && hits.length === 0 && norm.length >= 3) {
    const more = await db.execute(sql`
      WITH q AS (SELECT to_tsquery('simple', unaccent(${tsq})) AS tsq, lower(unaccent(${norm})) AS qn)
      SELECT si.slug, si.title, si.subtitle, si.category,
             (${o.weights.text} * word_similarity(q.qn, si.title_norm))::float8 AS score
      FROM search_index si, q
      WHERE si.entity_type = ${et} AND NOT si.hidden AND NOT (si.tsv @@ q.tsq)
        AND word_similarity(q.qn, si.title_norm) >= ${o.fuzzyThreshold} ${catFilter}
      ORDER BY score DESC, si.title ASC
      LIMIT ${o.limit}
    `);
    const extra = rowsOf<{
      slug: string;
      title: string;
      subtitle: string | null;
      category: string | null;
      score: number;
    }>(more);
    hits.push(...extra.map((r) => ({ ...r, score: Number(r.score) })));
    total += extra.length;
  }
  return { hits, total };
}

function rowsOf<T>(res: unknown): T[] {
  return ((res as { rows?: T[] }).rows ?? (res as T[])) as T[];
}

/** Editor pins (first) + excludes for this exact query (keys "game:slug" / "topic:slug" / "source:slug"). */
async function applySearchCuration(
  norm: string,
  groups: Record<SearchGroup, SearchHit[]>,
  limitPerGroup: number,
): Promise<void> {
  const cur = await curationFor('search', norm.slice(0, 160), 'results');
  if (cur.pins.length === 0 && cur.excludes.length === 0) return;
  const ex = new Set(cur.excludes);
  for (const g of Object.keys(groups) as SearchGroup[]) {
    groups[g] = groups[g].filter((h) => !ex.has(`${ENTITY[g]}:${h.slug}`));
  }
  const pinRefs = cur.pins
    .map((p) => {
      const i = p.indexOf(':');
      return i > 0 ? { et: p.slice(0, i), slug: p.slice(i + 1) } : null;
    })
    .filter(
      (p): p is { et: string; slug: string } =>
        Boolean(p && groupOfEntity(p.et) && p.slug) && !ex.has(`${p!.et}:${p!.slug}`),
    );
  if (pinRefs.length === 0) return;
  const res = await db.execute(sql`
    SELECT entity_type, slug, title, subtitle, category FROM search_index
    WHERE NOT hidden AND (entity_type, slug) IN (${sql.join(
      pinRefs.map((p) => sql`(${p.et}, ${p.slug})`),
      sql`, `,
    )})
  `);
  const found = new Map(
    rowsOf<{
      entity_type: string;
      slug: string;
      title: string;
      subtitle: string | null;
      category: string | null;
    }>(res).map((r) => [`${r.entity_type}:${r.slug}`, r]),
  );
  for (const g of Object.keys(groups) as SearchGroup[]) {
    const pinned: SearchHit[] = [];
    for (const p of pinRefs) {
      if (groupOfEntity(p.et) !== g) continue;
      const r = found.get(`${p.et}:${p.slug}`);
      if (r)
        pinned.push({ slug: r.slug, title: r.title, subtitle: r.subtitle, category: r.category });
    }
    if (pinned.length === 0) continue;
    const keys = new Set(pinned.map((h) => h.slug));
    groups[g] = [...pinned, ...groups[g].filter((h) => !keys.has(h.slug))].slice(
      0,
      Math.max(limitPerGroup, pinned.length),
    );
  }
}

async function cached<T>(
  kind: string,
  parts: unknown[],
  seconds: number,
  build: () => Promise<T>,
): Promise<T> {
  if (seconds <= 0) return build();
  let key: string | null;
  try {
    const ver = (await redis.get(SEARCH_VERSION_KEY)) ?? '0';
    key = `gk:search:${ver}:${kind}:${createHash('sha1').update(JSON.stringify(parts)).digest('hex')}`;
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    key = null; // cache is best-effort
  }
  const value = await build();
  if (key) {
    try {
      await redis.set(key, JSON.stringify(value), 'EX', seconds);
    } catch {
      /* best-effort */
    }
  }
  return value;
}

async function contextOf() {
  const [rules, cats] = await Promise.all([rulesSettings(), newsCategories()]);
  const r = rules.search;
  const excluded = [
    ...(rules.news.hideSearchable ? [] : keysInModes(cats, ['hide'])),
    ...(rules.news.lowSearchable ? [] : keysInModes(cats, ['low'])),
  ];
  const labels = new Map(cats.map((c) => [c.key, c.label]));
  const base = {
    excludedCategories: excluded,
    fuzzy: r.fuzzy,
    fuzzyThreshold: r.fuzzyThresholdPct / 100,
    weights: { exact: r.weightExact, prefix: r.weightPrefix, text: r.weightText },
  };
  return { r, base, labels };
}

const labelHits = (hits: SearchHit[], labels: Map<string, string>): SearchHit[] =>
  hits.map((h) => ({
    slug: h.slug,
    title: h.title,
    subtitle: h.subtitle,
    category:
      h.category && h.category !== NEWS_FALLBACK_CATEGORY
        ? (labels.get(h.category) ?? h.category)
        : null,
  }));

/** The typeahead: a few hits per group (min chars; cached). */
export async function suggest(raw: unknown): Promise<SearchResult> {
  const { r, base, labels } = await contextOf();
  const { norm, tokens } = normalizeQuery(raw, r.maxQueryChars);
  const tsq = buildTsQuery(tokens);
  if (!tsq || norm.length < r.minChars) return { q: norm, tooShort: true, groups: emptyGroups() };
  return cached('suggest', [norm, r, base.excludedCategories], r.cacheSeconds, async () => {
    const groups = emptyGroups();
    for (const g of Object.keys(groups) as SearchGroup[]) {
      const { hits } = await queryGroup(g, tsq, norm, {
        ...base,
        limit: r.suggestPerGroup,
        offset: 0,
      });
      groups[g] = labelHits(hits, labels);
    }
    await applySearchCuration(norm, groups, r.suggestPerGroup);
    return { q: norm, tooShort: false, groups };
  });
}

/** The /search results page: one group paged, or the top of every group with totals. */
export async function searchSite(
  raw: unknown,
  opts: { type?: unknown; page?: unknown } = {},
): Promise<SearchResult> {
  const { r, base, labels } = await contextOf();
  const { norm, tokens } = normalizeQuery(raw, r.maxQueryChars);
  const type = searchGroupOf(opts.type);
  const pageNum = Math.min(50, Math.max(1, Number.parseInt(String(opts.page ?? '1'), 10) || 1));
  const tsq = buildTsQuery(tokens);
  if (!tsq || norm.length < r.minChars) {
    return {
      q: norm,
      tooShort: true,
      groups: emptyGroups(),
      totals: { games: 0, stories: 0, sources: 0 },
      type,
      page: 1,
      pageSize: r.pageSize,
    };
  }
  return cached(
    'page',
    [norm, type, pageNum, r, base.excludedCategories],
    r.cacheSeconds,
    async () => {
      const groups = emptyGroups();
      const totals: Record<SearchGroup, number> = { games: 0, stories: 0, sources: 0 };
      const wanted = type ? [type] : (Object.keys(groups) as SearchGroup[]);
      for (const g of wanted) {
        const limit = type ? r.pageSize : Math.min(r.pageSize, 8);
        const offset = type ? (pageNum - 1) * r.pageSize : 0;
        const { hits, total } = await queryGroup(g, tsq, norm, { ...base, limit, offset });
        groups[g] = labelHits(hits, labels);
        totals[g] = total;
      }
      if (pageNum === 1)
        await applySearchCuration(norm, groups, type ? r.pageSize : Math.min(r.pageSize, 8));
      return {
        q: norm,
        tooShort: false,
        groups,
        totals,
        type,
        page: pageNum,
        pageSize: r.pageSize,
      };
    },
  );
}

/** Staff preview: the raw ranking with scores (no cache, no curation). */
export async function searchTest(
  raw: unknown,
): Promise<{ q: string; hits: Record<SearchGroup, (SearchHit & { score: number })[]> }> {
  const { r, base } = await contextOf();
  const { norm, tokens } = normalizeQuery(raw, r.maxQueryChars);
  const tsq = buildTsQuery(tokens);
  const hits: Record<SearchGroup, (SearchHit & { score: number })[]> = {
    games: [],
    stories: [],
    sources: [],
  };
  if (!tsq) return { q: norm, hits };
  for (const g of Object.keys(hits) as SearchGroup[]) {
    hits[g] = (await queryGroup(g, tsq, norm, { ...base, limit: 10, offset: 0 })).hits;
  }
  return { q: norm, hits };
}

/**
 * Typeahead rate limit: per client key (coarsened IP; behind the frontend proxy
 * every visitor shares the proxy's address until TRUST_PROXY is configured) and a
 * global ceiling, per fixed window. Redis down → allow (search stays available;
 * the global ceiling returns with Redis).
 */
export async function allowSuggest(clientKey: string | null): Promise<boolean> {
  const r = (await rulesSettings()).search;
  const win = Math.floor(Date.now() / 1000 / r.rateLimitWindowSeconds);
  const ck = `gk:rl:suggest:c:${clientKey ?? 'unknown'}:${win}`;
  const gk = `gk:rl:suggest:g:${win}`;
  try {
    const res = await redis
      .multi()
      .incr(ck)
      .expire(ck, r.rateLimitWindowSeconds + 1)
      .incr(gk)
      .expire(gk, r.rateLimitWindowSeconds + 1)
      .exec();
    const c = Number(res?.[0]?.[1] ?? 0);
    const g = Number(res?.[2]?.[1] ?? 0);
    return c <= r.rateLimitPerClient && g <= r.rateLimitGlobal;
  } catch {
    return true;
  }
}
