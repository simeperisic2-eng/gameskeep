import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { redis } from '../redis/client';

/**
 * The site-search index (Phase P S4) — rebuilt SET-BASED (three INSERT … SELECT
 * upserts + stale-row deletes), so it scales with the catalog without row loops.
 * Runs in the background (boot, after ingest / catalog import, after admin edits
 * of games, stories and sources); the query path only reads `search_index`.
 *
 * Documents: games — title (A), alternate names (B), developer + publisher (C);
 * stories — title (A), TL;DR (C); sources — name (A), parent company (C).
 * Only PUBLIC stories are indexed (the homepage visibility rule).
 */
export const SEARCH_VERSION_KEY = 'gk:search:ver';

const doc = (text: ReturnType<typeof sql>, weight: 'A' | 'B' | 'C') =>
  sql`setweight(to_tsvector('simple', unaccent(coalesce(${text}, ''))), ${sql.raw(`'${weight}'`)})`;

export async function rebuildSearchIndex(): Promise<{
  games: number;
  stories: number;
  sources: number;
}> {
  const games = await db.execute(sql`
    INSERT INTO search_index (entity_type, entity_id, slug, title, title_norm, subtitle, tsv, category, hidden, sort_date, updated_at)
    SELECT 'game', g.id, s.slug, s.name, lower(unaccent(s.name)),
           nullif(concat_ws(' · ', coalesce(g.developer, g.publisher), substring(g.release_date from 1 for 4)), ''),
           ${doc(sql`s.name`, 'A')}
             || ${doc(sql`array_to_string(g.alternate_names, ' ')`, 'B')}
             || ${doc(sql`concat_ws(' ', g.developer, g.publisher)`, 'C')},
           NULL, g.search_hidden, NULL, now()
    FROM games g
    JOIN subjects s ON s.id = g.subject_id AND s.type = 'game'
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      slug = EXCLUDED.slug, title = EXCLUDED.title, title_norm = EXCLUDED.title_norm,
      subtitle = EXCLUDED.subtitle, tsv = EXCLUDED.tsv, hidden = EXCLUDED.hidden,
      updated_at = now()
  `);
  const stories = await db.execute(sql`
    INSERT INTO search_index (entity_type, entity_id, slug, title, title_norm, subtitle, tsv, category, hidden, sort_date, updated_at)
    SELECT 'topic', t.id, t.slug, t.title, lower(unaccent(t.title)),
           -- Phase P S5: a result subtitle carries no AI label, so only editorial text (edited /
           -- approved / locked) may appear there; automatic AI text is still searchable.
           CASE WHEN t.tldr_approved_at IS NOT NULL OR 'tldr' = ANY(t.locked_fields)
                THEN left(t.tldr, 200) END,
           ${doc(sql`t.title`, 'A')} || ${doc(sql`t.tldr`, 'C')},
           coalesce(t.category, 'news'), t.search_hidden, t.last_activity_at, now()
    FROM topics t
    WHERE t.bias_distribution IS NOT NULL
      AND coalesce((t.bias_distribution->>'articleCount')::int, 0) > 0
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      slug = EXCLUDED.slug, title = EXCLUDED.title, title_norm = EXCLUDED.title_norm,
      subtitle = EXCLUDED.subtitle, tsv = EXCLUDED.tsv, category = EXCLUDED.category,
      hidden = EXCLUDED.hidden, sort_date = EXCLUDED.sort_date, updated_at = now()
  `);
  const sources = await db.execute(sql`
    INSERT INTO search_index (entity_type, entity_id, slug, title, title_norm, subtitle, tsv, category, hidden, sort_date, updated_at)
    SELECT 'source', so.id, so.slug, so.name, lower(unaccent(so.name)),
           nullif(so.parent_company, ''),
           ${doc(sql`so.name`, 'A')} || ${doc(sql`so.parent_company`, 'C')},
           NULL, so.search_hidden, NULL, now()
    FROM sources so
    WHERE so.status = 'active'
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      slug = EXCLUDED.slug, title = EXCLUDED.title, title_norm = EXCLUDED.title_norm,
      subtitle = EXCLUDED.subtitle, tsv = EXCLUDED.tsv, hidden = EXCLUDED.hidden,
      updated_at = now()
  `);
  // Stale rows: deleted games, stories that are no longer public, inactive sources.
  await db.execute(sql`
    DELETE FROM search_index si
    WHERE (si.entity_type = 'game' AND NOT EXISTS (SELECT 1 FROM games g WHERE g.id = si.entity_id))
       OR (si.entity_type = 'topic' AND NOT EXISTS (
             SELECT 1 FROM topics t WHERE t.id = si.entity_id
               AND t.bias_distribution IS NOT NULL
               AND coalesce((t.bias_distribution->>'articleCount')::int, 0) > 0))
       OR (si.entity_type = 'source' AND NOT EXISTS (
             SELECT 1 FROM sources so WHERE so.id = si.entity_id AND so.status = 'active'))
  `);
  await bumpSearchVersion();
  const n = (r: unknown): number => (r as { rowCount?: number }).rowCount ?? 0;
  return { games: n(games), stories: n(stories), sources: n(sources) };
}

/** Invalidate every cached search answer (a new version key namespace). */
export async function bumpSearchVersion(): Promise<void> {
  try {
    await redis.incr(SEARCH_VERSION_KEY);
  } catch {
    /* cache is best-effort; answers expire by TTL anyway */
  }
}
