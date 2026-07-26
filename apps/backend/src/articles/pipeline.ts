import { eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { articles, articleSubjects, sources, sourceTypes, topics } from '../db/schema';
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

/** Wipe feed-produced data so the next ingest re-clusters from scratch (tuning). */
async function resetFeed(): Promise<void> {
  // Aggregated articles (cascades article_topics / article_subjects); our own
  // CMS articles and the inline seed topic (no embedding) are preserved.
  await db.delete(articles).where(eq(articles.origin, 'aggregated'));
  await db.delete(topics).where(isNotNull(topics.embedding));
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
    totalArticles: await countArticles(),
    totalTopics: await countTopics(),
  };
}

/** Slugified name (used by tests/diagnostics). */
export function topicSlugFor(title: string): string {
  return slugify(title);
}
