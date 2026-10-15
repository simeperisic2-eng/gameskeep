import { sql } from 'drizzle-orm';
import {
  NEWS_FALLBACK_CATEGORY,
  type NewsCategoryMode,
  type SeoIndexMode,
} from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { rulesSettings } from '../rules/settings';
import { modeMap, modeOf, newsCategories } from '../news/categories';

/**
 * Story indexing (Phase P S4). Every story stays visible on the site; it is
 * INDEXABLE (robots index + in the sitemap) when an editor said so, or — in
 * automatic mode — when it has ≥ `seo.topicMinSources` sources, or an AI summary
 * AND a linked game. A story in a "hide" category is never indexed automatically
 * (setting). An editor's noindex always wins.
 */
export interface TopicIndexFacts {
  seoIndex: SeoIndexMode;
  sources: number;
  hasSummary: boolean;
  hasGame: boolean;
  category: string | null;
}

/** Pure; unit-tested. */
export function topicIndexable(
  f: TopicIndexFacts,
  rules: {
    topicMinSources: number;
    indexIfSummaryAndGame: boolean;
    noindexHiddenCategories: boolean;
  },
  modes: Map<string, NewsCategoryMode>,
): boolean {
  if (f.seoIndex === 'index') return true;
  if (f.seoIndex === 'noindex') return false;
  if (
    rules.noindexHiddenCategories &&
    modeOf(modes, f.category ?? NEWS_FALLBACK_CATEGORY) === 'hide'
  )
    return false;
  if (f.sources >= rules.topicMinSources) return true;
  return rules.indexIfSummaryAndGame && f.hasSummary && f.hasGame;
}

const isMode = (m: unknown): m is SeoIndexMode => m === 'auto' || m === 'index' || m === 'noindex';

/** The facts for every public story (or one), set-based. Our own articles count as one source. */
export async function topicIndexFacts(
  topicId?: string,
): Promise<Map<string, TopicIndexFacts & { slug: string; lastModified: Date | null }>> {
  const res = await db.execute(sql`
    SELECT t.id, t.slug, t.seo_index, t.category, coalesce(t.last_activity_at, t.updated_at) AS last_modified,
           (t.ai_summary IS NOT NULL AND length(trim(t.ai_summary)) > 0) AS has_summary,
           (SELECT count(DISTINCT coalesce(a.source_id::text, 'ours'))::int
              FROM article_topics at JOIN articles a ON a.id = at.article_id
              WHERE at.topic_id = t.id) AS sources,
           EXISTS (SELECT 1 FROM article_topics at
                     JOIN article_subjects asj ON asj.article_id = at.article_id
                     JOIN games g ON g.subject_id = asj.subject_id
                     WHERE at.topic_id = t.id) AS has_game
    FROM topics t
    WHERE t.bias_distribution IS NOT NULL
      AND coalesce((t.bias_distribution->>'articleCount')::int, 0) > 0
      ${topicId ? sql`AND t.id = ${topicId}::uuid` : sql``}
  `);
  const rows = ((res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[])) as {
    id: string;
    slug: string;
    seo_index: string;
    category: string | null;
    last_modified: Date | string | null;
    has_summary: boolean;
    sources: number;
    has_game: boolean;
  }[];
  return new Map(
    rows.map((r) => [
      r.id,
      {
        slug: r.slug,
        seoIndex: isMode(r.seo_index) ? r.seo_index : 'auto',
        category: r.category,
        sources: Number(r.sources) || 0,
        hasSummary: Boolean(r.has_summary),
        hasGame: Boolean(r.has_game),
        lastModified: r.last_modified ? new Date(r.last_modified) : null,
      },
    ]),
  );
}

/** Is this story indexable now? (Missing / not public → false.) */
export async function isTopicIndexable(topicId: string): Promise<boolean> {
  const [facts, rules, cats] = await Promise.all([
    topicIndexFacts(topicId),
    rulesSettings(),
    newsCategories(),
  ]);
  const f = facts.get(topicId);
  return f ? topicIndexable(f, rules.seo, modeMap(cats)) : false;
}

/** Every indexable story for the sitemap. */
export async function indexableTopics(): Promise<{ slug: string; lastModified: Date | null }[]> {
  const [facts, rules, cats] = await Promise.all([
    topicIndexFacts(),
    rulesSettings(),
    newsCategories(),
  ]);
  const modes = modeMap(cats);
  return [...facts.values()]
    .filter((f) => topicIndexable(f, rules.seo, modes))
    .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0))
    .map((f) => ({ slug: f.slug, lastModified: f.lastModified }));
}
