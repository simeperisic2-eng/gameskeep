import { eq, sql } from 'drizzle-orm';
import {
  NEWS_CATEGORY_MODES,
  NEWS_CATEGORY_SEED,
  NEWS_FALLBACK_CATEGORY,
  type NewsCategoryMode,
} from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { appSettings, articles, newsCategories as newsCategoryTable } from '../db/schema';
import { rulesSettings } from '../rules/settings';

/**
 * News categories (Phase P S4) — what KIND of piece an article is, and how much
 * of the site it reaches: `show` (everywhere), `low` (only "More from the feed";
 * never Trending / Latest / briefing counts), `hide` (out of every feed and
 * count; story pages stay reachable). The classifier is MECHANICAL — a feed-given
 * article type wins, else editor-tunable keyword phrases (word-bounded), else
 * "news". Editors can override an article's category and a story's category.
 */
export interface NewsCategory {
  key: string;
  label: string;
  mode: NewsCategoryMode;
  keywords: string[];
  priority: number;
}

const isMode = (m: unknown): m is NewsCategoryMode =>
  typeof m === 'string' && (NEWS_CATEGORY_MODES as readonly string[]).includes(m);

let cache: { at: number; value: NewsCategory[] } | null = null;
const TTL_MS = 10_000;

/** Active categories (cached briefly; the fallback "news" always present). */
export async function newsCategories(opts: { fresh?: boolean } = {}): Promise<NewsCategory[]> {
  if (!opts.fresh && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  let rows: NewsCategory[];
  try {
    const raw = await db
      .select({
        key: newsCategoryTable.key,
        label: newsCategoryTable.label,
        mode: newsCategoryTable.mode,
        keywords: newsCategoryTable.keywords,
        priority: newsCategoryTable.priority,
      })
      .from(newsCategoryTable)
      .where(eq(newsCategoryTable.active, true));
    rows = raw.map((r) => ({
      key: r.key,
      label: r.label,
      mode: isMode(r.mode) ? r.mode : 'show',
      keywords: (r.keywords ?? []).filter((k: string) => typeof k === 'string' && k.trim()),
      priority: Number.isFinite(r.priority) ? r.priority : 0,
    }));
  } catch {
    rows = [];
  }
  if (!rows.some((r) => r.key === NEWS_FALLBACK_CATEGORY)) {
    rows.push({
      key: NEWS_FALLBACK_CATEGORY,
      label: 'News',
      mode: 'show',
      keywords: [],
      priority: 0,
    });
  }
  cache = { at: Date.now(), value: rows };
  return rows;
}

export function invalidateNewsCategories(): void {
  cache = null;
}

/** key → mode; an unknown / inactive key reads as `show` (never silently hidden). */
export function modeMap(cats: NewsCategory[]): Map<string, NewsCategoryMode> {
  return new Map(cats.map((c) => [c.key, c.mode]));
}
export function modeOf(
  modes: Map<string, NewsCategoryMode>,
  key: string | null | undefined,
): NewsCategoryMode {
  return modes.get(key ?? NEWS_FALLBACK_CATEGORY) ?? 'show';
}
/** Category keys in the given modes (for SQL NOT IN filters). */
export function keysInModes(cats: NewsCategory[], wanted: NewsCategoryMode[]): string[] {
  return cats.filter((c) => wanted.includes(c.mode)).map((c) => c.key);
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * A keyword phrase matches on WORD boundaries where the phrase starts / ends with
 * a letter or digit ("guide" ≠ "guided"; "% off" needs no leading boundary).
 */
export function phraseMatch(haystack: string, phrase: string): boolean {
  const p = phrase.trim().toLowerCase();
  if (!p) return false;
  const start = /^[\p{L}\p{N}]/u.test(p) ? '(?<![\\p{L}\\p{N}])' : '';
  const end = /[\p{L}\p{N}]$/u.test(p) ? '(?![\\p{L}\\p{N}])' : '';
  return new RegExp(`${start}${escapeRe(p)}${end}`, 'u').test(haystack.toLowerCase());
}

/**
 * Classify one article (pure; unit-tested). A feed-given type other than "news"
 * wins when that category exists; else the highest-priority keyword match on the
 * title (plus the excerpt when enabled); else the fallback.
 */
export function classifyArticle(
  input: { title: string; excerpt?: string | null; articleType?: string | null },
  cats: NewsCategory[],
  opts: { excerpt: boolean } = { excerpt: false },
): string {
  const keys = new Set(cats.map((c) => c.key));
  const type = (input.articleType ?? '').toLowerCase();
  if (type && type !== NEWS_FALLBACK_CATEGORY && keys.has(type)) return type;
  const hay = `${input.title ?? ''}${opts.excerpt && input.excerpt ? ` ${input.excerpt}` : ''}`;
  const ordered = [...cats]
    .filter((c) => c.keywords.length > 0)
    .sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key));
  for (const c of ordered) {
    if (c.keywords.some((k) => phraseMatch(hay, k))) return c.key;
  }
  return NEWS_FALLBACK_CATEGORY;
}

/** The effective category of an article row in SQL (override → classifier → news). */
export const articleCategorySql = sql`coalesce(${articles.categoryOverride}, ${articles.category}, ${NEWS_FALLBACK_CATEGORY})`;

/**
 * Classify articles (all, or the given ids) and store the result. Batched; only
 * changed rows are written. Returns how many changed.
 */
export async function classifyArticles(ids?: string[]): Promise<number> {
  const cats = await newsCategories({ fresh: true });
  const { classifyExcerpt } = (await rulesSettings()).news;
  let changed = 0;
  const BATCH = 500;
  const all = ids ? ids : (await db.select({ id: articles.id }).from(articles)).map((r) => r.id);
  for (let i = 0; i < all.length; i += BATCH) {
    const chunk = all.slice(i, i + BATCH);
    if (chunk.length === 0) continue;
    const rows = await db
      .select({
        id: articles.id,
        title: articles.title,
        excerpt: articles.excerpt,
        type: articles.articleType,
        category: articles.category,
      })
      .from(articles)
      .where(
        sql`${articles.id} IN (${sql.join(
          chunk.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );
    const updates = rows
      .map((r) => ({
        id: r.id,
        next: classifyArticle({ title: r.title, excerpt: r.excerpt, articleType: r.type }, cats, {
          excerpt: classifyExcerpt,
        }),
        prev: r.category,
      }))
      .filter((u) => u.next !== u.prev);
    if (updates.length === 0) continue;
    await db.execute(sql`
      UPDATE articles AS a SET category = v.cat
      FROM (VALUES ${sql.join(
        updates.map((u) => sql`(${u.id}::uuid, ${u.next})`),
        sql`, `,
      )}) AS v(id, cat)
      WHERE a.id = v.id
    `);
    changed += updates.length;
  }
  return changed;
}

const MODE_RANK: Record<NewsCategoryMode, number> = { show: 0, low: 1, hide: 2 };

/**
 * A story's category (pure; unit-tested): the most common category among its
 * articles when it holds at least `sharePct` of them, else "news". On a tie the
 * LESS restrictive mode wins (show → low → hide, "news" first among shown), so a
 * tie never demotes a story — one deals piece joining one news piece stays news.
 */
export function topicCategoryOf(
  counts: { cat: string; n: number }[],
  modes: Map<string, NewsCategoryMode>,
  sharePct: number,
): string {
  const rows = counts.filter(
    (c) => typeof c.cat === 'string' && c.cat && Number.isFinite(c.n) && c.n > 0,
  );
  const total = rows.reduce((sum, c) => sum + c.n, 0);
  if (total <= 0) return NEWS_FALLBACK_CATEGORY;
  const best = [...rows].sort(
    (a, b) =>
      b.n - a.n ||
      MODE_RANK[modeOf(modes, a.cat)] - MODE_RANK[modeOf(modes, b.cat)] ||
      Number(b.cat === NEWS_FALLBACK_CATEGORY) - Number(a.cat === NEWS_FALLBACK_CATEGORY) ||
      a.cat.localeCompare(b.cat),
  )[0]!;
  return best.n * 100 >= total * sharePct ? best.cat : NEWS_FALLBACK_CATEGORY;
}

/**
 * Recompute every story's category from its articles (see `topicCategoryOf`).
 * A story whose category an editor set (locked) is left alone; only changed
 * rows are written (batched). Returns the stories changed.
 */
export async function recomputeTopicCategories(): Promise<number> {
  const [share, cats] = await Promise.all([
    rulesSettings().then((r) => r.news.topicCategorySharePct),
    newsCategories({ fresh: true }),
  ]);
  const modes = modeMap(cats);
  const res = await db.execute(sql`
    SELECT t.id AS topic_id, t.category AS current,
           coalesce(a.category_override, a.category, ${NEWS_FALLBACK_CATEGORY}) AS cat,
           count(*)::int AS n
    FROM topics t
    JOIN article_topics at ON at.topic_id = t.id
    JOIN articles a ON a.id = at.article_id
    WHERE NOT ('category' = ANY(t.locked_fields))
    GROUP BY t.id, t.category, cat
  `);
  const raw = ((res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as {
    topic_id: string;
    current: string | null;
    cat: string;
    n: number;
  }[];
  const byTopic = new Map<
    string,
    { current: string | null; counts: { cat: string; n: number }[] }
  >();
  for (const r of raw) {
    const t = byTopic.get(r.topic_id) ?? { current: r.current, counts: [] };
    t.counts.push({ cat: r.cat, n: Number(r.n) });
    byTopic.set(r.topic_id, t);
  }
  const updates: { id: string; cat: string }[] = [];
  for (const [id, t] of byTopic) {
    const next = topicCategoryOf(t.counts, modes, share);
    if (next !== t.current) updates.push({ id, cat: next });
  }
  const BATCH = 500;
  for (let i = 0; i < updates.length; i += BATCH) {
    const chunk = updates.slice(i, i + BATCH);
    await db.execute(sql`
      UPDATE topics AS t SET category = v.cat
      FROM (VALUES ${sql.join(
        chunk.map((u) => sql`(${u.id}::uuid, ${u.cat})`),
        sql`, `,
      )}) AS v(id, cat)
      WHERE t.id = v.id AND NOT ('category' = ANY(t.locked_fields))
    `);
  }
  return updates.length;
}

const SEEDED_KEY = 'news-categories-seeded';

/**
 * Seed the categories ONCE (fresh installs and the first S4 boot) — after that
 * editors own the list (a deleted seed category is not re-added). The fallback
 * "news" is always ensured.
 */
export async function ensureNewsCategories(): Promise<void> {
  const [marker] = await db
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, SEEDED_KEY))
    .limit(1);
  if (!marker) {
    await db
      .insert(newsCategoryTable)
      .values(
        NEWS_CATEGORY_SEED.map((c) => ({
          key: c.key,
          label: c.label,
          mode: c.mode,
          keywords: [...c.keywords],
          priority: c.priority,
        })),
      )
      .onConflictDoNothing();
    await db
      .insert(appSettings)
      .values({ key: SEEDED_KEY, value: { at: new Date().toISOString() } })
      .onConflictDoNothing();
  }
  await db
    .insert(newsCategoryTable)
    .values({ key: NEWS_FALLBACK_CATEGORY, label: 'News', mode: 'show', keywords: [], priority: 0 })
    .onConflictDoNothing();
  invalidateNewsCategories();
}

/** Articles that predate S4 (or a failed classification) — boot reclassifies them. */
export async function countUnclassifiedArticles(): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(articles)
    .where(sql`${articles.category} IS NULL`);
  return r?.n ?? 0;
}
