import { eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  articles,
  articleSubjects,
  sources,
  sourceTypes,
  topicEditorialCarryover,
  topics,
} from '../db/schema';
import {
  getArticleSourceProvider,
  type ArticleSourceProvider,
  type RawFeedItem,
} from '../data-source/articles';
import { SOURCE_DEFS } from '../data-source/articles/sources';
import { embedTexts } from '../ai/client';
import { resolveOrQueue, type ResolveOutcome } from '../catalog/resolve';
import { slugify } from '../lib/slug';
import type { AuditActor } from '../admin/audit';
import { sanitizeFeedItem, type CleanArticle } from './normalize';
import { detectSignals } from './signals';
import { clusterArticle, markStaleTopicsResolved, refreshTopicSummary } from './cluster';
import { getClusterSettings } from './settings';
import { classifyEventKind, normalizeGameRef } from './event-kind';
import { recomputeBias } from './bias-engine';
import { relinkIntegrityByIdentity, scanIntegrity } from './integrity';
import { classifyArticles, recomputeTopicCategories } from '../news/categories';
import { detectListCandidates, relinkListArticles } from '../lists/service';
import { requestSearchRefresh } from '../search/jobs';
import { displaySettings } from '../display/settings';

/**
 * The article pipeline (SPEC I3 §6): pull → normalize → embed → cluster →
 * attach games → summarize, run entirely as a background job (never on the user
 * request path). Idempotent: articles are keyed on their source guid, so a
 * re-run ingests only genuinely new items and never splinters existing topics.
 * `reset` re-clusters the whole feed from scratch (for threshold tuning).
 */

const SYSTEM_ACTOR: AuditActor = { label: 'article-pipeline' };
const EMBED_BATCH = 128;

export interface IngestResult {
  provider: ArticleSourceProvider['name'];
  pulled: number;
  newArticles: number;
  skipped: number;
  invalid: number;
  topicsCreated: number;
  topicsTouched: number;
  gamesAttached: number;
  gamesQueued: number;
  /** Times the secondary gate resisted a cosine over-merge (SPEC I4a §7). */
  gateResisted: number;
  /** Articles scored by the bias engine on this run (SPEC I4a). */
  biasArticlesScored: number;
  /** New review-integrity signals filed as `detected` on this run (Phase P S1). */
  integritySignalsFiled: number;
  totalArticles: number;
  totalTopics: number;
}

export interface IngestOptions {
  reset?: boolean;
  /** Skip if articles already exist (boot path); ignored when reset=true. */
  skipIfPopulated?: boolean;
  limit?: number;
  provider?: ArticleSourceProvider;
}

async function countArticles(): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(articles);
  return row?.c ?? 0;
}
async function countTopics(): Promise<number> {
  const [row] = await db.select({ c: sql<number>`count(*)::int` }).from(topics);
  return row?.c ?? 0;
}

/**
 * Ensure the 10 source rows exist (so articles can attach) and return a
 * slug→id map. Idempotent: never clobbers editor edits to an existing source.
 */
async function ensureSources(): Promise<Map<string, string>> {
  const typeRows = await db.select({ id: sourceTypes.id, key: sourceTypes.key }).from(sourceTypes);
  const typeByKey = new Map(typeRows.map((t) => [t.key, t.id]));

  for (const def of SOURCE_DEFS) {
    await db
      .insert(sources)
      .values({
        slug: def.slug,
        name: def.name,
        websiteUrl: def.websiteUrl,
        rssUrl: def.rssUrl,
        typeId: typeByKey.get(def.typeKey) ?? null,
        parentCompany: def.parentCompany ?? null,
        adapterKey: def.adapterKey,
      })
      .onConflictDoNothing();
  }

  const rows = await db.select({ id: sources.id, slug: sources.slug }).from(sources);
  return new Map(rows.map((r) => [r.slug, r.id]));
}

/**
 * Wipe feed-produced data so the next ingest re-clusters from scratch (tuning).
 * Editorial decisions are NOT feed data: before the rows go, every override /
 * note / internal assessment is snapshotted by IDENTITY (feed guid + source) into
 * the carry-over, and integrity signals keep their identity (their article link
 * goes to null) — the ingest that follows re-applies both (hygiene 3).
 */
async function resetFeed(): Promise<void> {
  await db.transaction(async (tx) => {
    // Phase P S3b: stories an editor locked (or kept out of search) are recreated
    // by the re-cluster — snapshot their editor fields + slug, keyed on their
    // member articles' feed guids; restoreTopicCarryover re-applies them.
    await tx.execute(sql`
      INSERT INTO topic_editorial_carryover (slug, member_guids, locked_fields, fields)
      SELECT t.slug,
        coalesce(array_agg(a.external_guid) FILTER (WHERE a.external_guid IS NOT NULL), '{}'),
        t.locked_fields,
        jsonb_build_object('title', t.title, 'tldr', t.tldr, 'aiSummary', t.ai_summary,
          'status', t.status, 'typeId', t.type_id, 'category', t.category,
          'seoIndex', t.seo_index, 'searchHidden', t.search_hidden)
      FROM topics t
      LEFT JOIN article_topics at ON at.topic_id = t.id
      LEFT JOIN articles a ON a.id = at.article_id
      WHERE t.embedding IS NOT NULL
        AND (cardinality(t.locked_fields) > 0 OR t.seo_index <> 'auto' OR t.search_hidden)
      GROUP BY t.id
    `);
    await tx.execute(sql`
      INSERT INTO article_editorial_carryover (
        external_guid, source_id, influence_override, quality_override,
        influence_override_reason, quality_override_reason, editor_note, internal_assessment,
        category_override
      )
      SELECT external_guid, source_id, influence_override, quality_override,
        influence_override_reason, quality_override_reason, editor_note, internal_assessment,
        category_override
      FROM articles
      WHERE origin = 'aggregated' AND external_guid IS NOT NULL AND (
        influence_override IS NOT NULL OR quality_override IS NOT NULL
        OR influence_override_reason IS NOT NULL OR quality_override_reason IS NOT NULL
        OR editor_note IS NOT NULL OR internal_assessment IS NOT NULL
        OR category_override IS NOT NULL
      )
      ON CONFLICT (external_guid) DO UPDATE SET
        source_id = EXCLUDED.source_id,
        influence_override = EXCLUDED.influence_override,
        quality_override = EXCLUDED.quality_override,
        influence_override_reason = EXCLUDED.influence_override_reason,
        quality_override_reason = EXCLUDED.quality_override_reason,
        editor_note = EXCLUDED.editor_note,
        internal_assessment = EXCLUDED.internal_assessment,
        category_override = EXCLUDED.category_override
    `);
    // Aggregated articles (cascades article_topics / article_subjects); our own
    // CMS articles and the inline seed topic (no embedding) are preserved.
    await tx.delete(articles).where(eq(articles.origin, 'aggregated'));
    await tx.delete(topics).where(isNotNull(topics.embedding));
  });
}

/**
 * Phase P S3b: after a re-cluster, each carried-over story finds the new story
 * holding most of its member articles (at least half of them) and gets back its
 * locked fields, its search setting and — if still free — its slug, so links,
 * pins and placements keep pointing at it. Applied rows are dropped; an
 * unmatched row is kept 30 days (a later ingest may bring its articles back).
 */
async function restoreTopicCarryover(): Promise<number> {
  const carried = await db.select().from(topicEditorialCarryover);
  let applied = 0;
  for (const c of carried) {
    if (c.memberGuids.length === 0) continue;
    // One bound parameter per guid (a JS array interpolated directly becomes a
    // row value, which Postgres can't cast to text[]).
    const guids = sql.join(
      c.memberGuids.map((g) => sql`${g}`),
      sql`, `,
    );
    const res = await db.execute(sql`
      SELECT at.topic_id AS id, count(*)::int AS n
      FROM article_topics at JOIN articles a ON a.id = at.article_id
      WHERE a.external_guid = ANY(ARRAY[${guids}]::text[])
      GROUP BY at.topic_id ORDER BY n DESC LIMIT 1
    `);
    const rows = ((res as unknown as { rows?: { id: string; n: number }[] }).rows ??
      (res as unknown as { id: string; n: number }[])) as { id: string; n: number }[];
    const best = rows[0];
    if (!best || best.n * 2 < c.memberGuids.length) continue;
    const f = (c.fields ?? {}) as Record<string, unknown>;
    const seo = f.seoIndex === 'index' || f.seoIndex === 'noindex' ? f.seoIndex : null;
    const set: Record<string, unknown> = {
      lockedFields: c.lockedFields,
      // Phase P S4 (an S3b row carried "noindex": true → the same choice).
      seoIndex: seo ?? (f.noindex === true ? 'noindex' : 'auto'),
      searchHidden: f.searchHidden === true,
    };
    for (const field of c.lockedFields) {
      if (field === 'title' && typeof f.title === 'string') set.title = f.title;
      if (field === 'tldr') set.tldr = typeof f.tldr === 'string' ? f.tldr : null;
      if (field === 'aiSummary')
        set.aiSummary = typeof f.aiSummary === 'string' ? f.aiSummary : null;
      if (field === 'status' && typeof f.status === 'string') set.status = f.status;
      if (field === 'typeId') set.typeId = typeof f.typeId === 'string' ? f.typeId : null;
      if (field === 'category') set.category = typeof f.category === 'string' ? f.category : null;
    }
    const [taken] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(eq(topics.slug, c.slug))
      .limit(1);
    if (!taken) set.slug = c.slug;
    await db.update(topics).set(set).where(eq(topics.id, best.id));
    await db.delete(topicEditorialCarryover).where(eq(topicEditorialCarryover.id, c.id));
    applied += 1;
  }
  await db.execute(
    sql`DELETE FROM topic_editorial_carryover WHERE created_at < now() - interval '30 days'`,
  );
  return applied;
}

/**
 * Re-apply carried-over editorial decisions to the SAME feed article (guid +
 * source) once it exists again, then drop the applied snapshots. Idempotent.
 */
async function restoreEditorialCarryover(): Promise<void> {
  await db.execute(sql`
    UPDATE articles AS a SET
      influence_override = c.influence_override,
      quality_override = c.quality_override,
      influence_override_reason = c.influence_override_reason,
      quality_override_reason = c.quality_override_reason,
      editor_note = c.editor_note,
      internal_assessment = c.internal_assessment,
      category_override = c.category_override
    FROM article_editorial_carryover AS c
    WHERE a.external_guid = c.external_guid
      AND (c.source_id IS NULL OR a.source_id IS NULL OR a.source_id = c.source_id)
  `);
  await db.execute(sql`
    DELETE FROM article_editorial_carryover AS c
    USING articles AS a
    WHERE a.external_guid = c.external_guid
      AND (c.source_id IS NULL OR a.source_id IS NULL OR a.source_id = c.source_id)
  `);
}

export async function runIngest(opts: IngestOptions = {}): Promise<IngestResult> {
  const provider = opts.provider ?? getArticleSourceProvider();

  if (opts.reset) {
    await resetFeed();
  } else if (opts.skipIfPopulated) {
    if ((await countArticles()) > 5) {
      return {
        provider: provider.name,
        pulled: 0,
        newArticles: 0,
        skipped: await countArticles(),
        invalid: 0,
        topicsCreated: 0,
        topicsTouched: 0,
        gamesAttached: 0,
        gamesQueued: 0,
        gateResisted: 0,
        biasArticlesScored: 0,
        integritySignalsFiled: 0,
        totalArticles: await countArticles(),
        totalTopics: await countTopics(),
      };
    }
  }

  const sourceIds = await ensureSources();
  const settings = await getClusterSettings();

  const raw = await provider.pullRecent({ limit: opts.limit });

  // Normalize + dedupe against what's already ingested (idempotency by guid).
  let invalid = 0;
  const clean: CleanArticle[] = [];
  const guids: string[] = [];
  for (const item of raw) {
    const c = sanitizeFeedItem(item as Partial<RawFeedItem>);
    if (!c) {
      invalid += 1;
      continue;
    }
    clean.push(c);
    guids.push(c.guid);
  }

  const existing = new Set<string>();
  for (let i = 0; i < guids.length; i += 500) {
    const chunk = guids.slice(i, i + 500);
    if (chunk.length === 0) continue;
    const rows = await db
      .select({ guid: articles.externalGuid })
      .from(articles)
      .where(inArray(articles.externalGuid, chunk));
    for (const r of rows) if (r.guid) existing.add(r.guid);
  }

  const fresh = clean.filter((c) => !existing.has(c.guid));
  const skipped = clean.length - fresh.length;

  // Process oldest-first so a developing story's first article seeds the topic
  // and later coverage joins it — and so the time-window guard is meaningful.
  fresh.sort((a, b) => (a.publishDate?.getTime() ?? 0) - (b.publishDate?.getTime() ?? 0));

  // Embed all fresh articles up-front (batched) — one round-trip per chunk.
  const embeddings = new Map<string, number[]>();
  for (let i = 0; i < fresh.length; i += EMBED_BATCH) {
    const batch = fresh.slice(i, i + EMBED_BATCH);
    const vectors = await embedTexts(batch.map((c) => c.embedText));
    batch.forEach((c, j) => {
      const vec = vectors[j];
      if (vec) embeddings.set(c.guid, vec);
    });
  }

  // Cluster sequentially (each article may seed a topic the next one joins).
  const touchedTopics = new Set<string>();
  const freshArticleIds: string[] = [];
  const createdTopics = new Set<string>();
  let newArticles = 0;
  let gamesAttached = 0;
  let gamesQueued = 0;
  let gateResisted = 0;
  const resolveCache = new Map<string, ResolveOutcome>();

  for (const c of fresh) {
    const embedding = embeddings.get(c.guid);
    if (!embedding) {
      invalid += 1;
      continue;
    }
    const signals = detectSignals(c);
    const sourceId = sourceIds.get(c.sourceSlug) ?? null;
    // Mechanical inputs for the secondary gate (factual, not judgmental).
    const gateInput = {
      gameRef: normalizeGameRef(c.gameRefs[0]),
      eventKind: classifyEventKind(c.embedText, settings.eventKindLexicon),
    };

    let result;
    try {
      result = await clusterArticle(c, embedding, signals, sourceId, settings, gateInput);
    } catch {
      // One bad article must never abort the whole ingest (anti-bug rule).
      invalid += 1;
      continue;
    }
    newArticles += 1;
    freshArticleIds.push(result.articleId);
    touchedTopics.add(result.topicId);
    if (result.action === 'create') createdTopics.add(result.topicId);
    if (result.gateResisted) gateResisted += 1;

    // Attach referenced games via I2's resolve path (auto-create or queue).
    for (const name of c.gameRefs) {
      const key = name.toLowerCase();
      let outcome = resolveCache.get(key);
      if (!outcome) {
        outcome = await resolveOrQueue(
          name,
          { article: c.title, source: c.sourceSlug },
          SYSTEM_ACTOR,
        );
        resolveCache.set(key, outcome);
      }
      if (outcome.subjectId) {
        await db
          .insert(articleSubjects)
          .values({ articleId: result.articleId, subjectId: outcome.subjectId })
          .onConflictDoNothing();
        gamesAttached += 1;
      } else if (outcome.status === 'queued') {
        gamesQueued += 1;
      }
    }
  }

  // Moderator decisions keyed by article IDENTITY find their (possibly newly
  // recreated) article again — before the bias recompute reads the overrides.
  await relinkIntegrityByIdentity();
  await restoreEditorialCarryover();
  await restoreTopicCarryover();

  // Phase P S4: news categories (the classifier; an editor's override wins) →
  // each story's category; list-like articles → the editors' list queue.
  try {
    await classifyArticles(freshArticleIds);
    await recomputeTopicCategories();
    await detectListCandidates(fresh.map((c) => c.guid));
    await relinkListArticles();
  } catch {
    // A classification hiccup must not fail the whole ingest.
  }

  // Refresh summaries for every touched topic (off the request path), then run
  // the status auto-maintenance pass.
  for (const topicId of touchedTopics) {
    try {
      await refreshTopicSummary(topicId);
    } catch {
      // A summarization hiccup must not fail the whole ingest.
    }
  }
  const newest = fresh.reduce<Date>(
    (max, c) => (c.publishDate && c.publishDate > max ? c.publishDate : max),
    new Date(0),
  );
  await markStaleTopicsResolved(newest.getTime() > 0 ? newest : new Date(), settings);

  // Bias engine: compute the two transparent axes for every article + the topic
  // distributions, stored — off the request path (SPEC I4a). A failure here must
  // not fail the whole ingest (clustering already succeeded).
  let biasArticlesScored = 0;
  try {
    const bias = await recomputeBias();
    biasArticlesScored = bias.articlesScored;
  } catch {
    /* bias recompute hiccup — scores can be rebuilt from admin */
  }

  // Review integrity (Phase P S1): scan EVERY pulled item (new or already
  // ingested, so older articles get backfilled) for disclosure evidence and file
  // new auto signals as `detected`. Never overwrites a moderator's decision; a
  // failure here must not fail the ingest.
  let integritySignalsFiled = 0;
  try {
    const { integrityLexicon } = await displaySettings();
    const scan = await scanIntegrity(
      clean.map((c) => ({
        guid: c.guid,
        title: c.title,
        excerpt: c.excerpt,
        disclosure: c.disclosure,
      })),
      integrityLexicon,
    );
    integritySignalsFiled = scan.signalsFiled;
  } catch {
    /* integrity scan hiccup — the next ingest re-scans idempotently */
  }

  // Phase P S4: the search index follows the new stories (debounced background job).
  await requestSearchRefresh('ingest');

  return {
    provider: provider.name,
    pulled: raw.length,
    newArticles,
    skipped,
    invalid,
    topicsCreated: createdTopics.size,
    topicsTouched: touchedTopics.size,
    gamesAttached,
    gamesQueued,
    gateResisted,
    biasArticlesScored,
    integritySignalsFiled,
    totalArticles: await countArticles(),
    totalTopics: await countTopics(),
  };
}

/** Slugified name (used by tests/diagnostics). */
export function topicSlugFor(title: string): string {
  return slugify(title);
}
