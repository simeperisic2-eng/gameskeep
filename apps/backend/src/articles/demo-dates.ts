import { and, eq, inArray, sql } from 'drizzle-orm';
import { isDemo } from '../config/env';
import { db } from '../db/client';
import {
  articleIntegritySignals,
  articles,
  articleTopics,
  topicTimelineEvents,
  topics,
} from '../db/schema';
import { DEMO_FEED_ANCHOR } from '../data-source/articles/mock-provider';
import { MOCK_FEED_ITEMS } from '../data-source/articles/mock-data';

/**
 * Demo feed dates relative to boot (Phase P hygiene 3). The mock provider anchors
 * a FRESH ingest so the newest article lands just before boot; this moves what
 * a reused volume already stored from the mock feed by the same rule, keeping the
 * relative spacing: the articles, the topics they form (last activity + auto
 * timeline events) and the evidence date of AUTO-detected integrity signals (that
 * date is the article's). Editor-entered dates are never touched. Demo mode only;
 * rows are matched by the mock dataset's own guids, so nothing else can move.
 */

/** Smaller drifts are left alone (a restart minutes later needn't rewrite rows). */
export const DEMO_REALIGN_MIN_SHIFT_MS = 60 * 60 * 1000;

/** The shift that moves `storedNewest` onto `anchor`, or null when not worth it. */
export function demoRealignShiftMs(
  storedNewest: Date | null,
  anchor: Date | null,
  minShiftMs = DEMO_REALIGN_MIN_SHIFT_MS,
): number | null {
  if (!storedNewest || !anchor) return null;
  const shift = anchor.getTime() - storedNewest.getTime();
  if (!Number.isFinite(shift) || Math.abs(shift) < minShiftMs) return null;
  return shift;
}

const MOCK_GUIDS: string[] = [
  ...new Set(
    MOCK_FEED_ITEMS.map((i) => (typeof i.guid === 'string' ? i.guid.trim() : '')).filter(
      (g) => g.length > 0 && g.length <= 400,
    ),
  ),
];

export async function realignStoredDemoFeedDates(
  anchor: Date | null = DEMO_FEED_ANCHOR,
): Promise<{ shiftHours: number; articles: number } | null> {
  if (!isDemo() || !anchor || MOCK_GUIDS.length === 0) return null;
  const [newest] = await db
    .select({ at: sql<Date | null>`max(${articles.publishDate})`.mapWith(articles.publishDate) })
    .from(articles)
    .where(inArray(articles.externalGuid, MOCK_GUIDS));
  const storedNewest = newest?.at instanceof Date ? newest.at : null;
  const shift = demoRealignShiftMs(storedNewest, anchor);
  if (shift == null) return null;
  const interval = sql`(${shift}::bigint * interval '1 millisecond')`;

  return db.transaction(async (tx) => {
    const moved = await tx
      .update(articles)
      .set({ publishDate: sql`${articles.publishDate} + ${interval}` })
      .where(
        and(inArray(articles.externalGuid, MOCK_GUIDS), sql`${articles.publishDate} is not null`),
      )
      .returning({ id: articles.id });
    const articleIds = moved.map((m) => m.id);
    const topicIds = new Set<string>();
    for (let i = 0; i < articleIds.length; i += 500) {
      const links = await tx
        .select({ topicId: articleTopics.topicId })
        .from(articleTopics)
        .where(inArray(articleTopics.articleId, articleIds.slice(i, i + 500)));
      for (const l of links) topicIds.add(l.topicId);
    }
    const topicList = [...topicIds];
    for (let i = 0; i < topicList.length; i += 500) {
      const chunk = topicList.slice(i, i + 500);
      await tx
        .update(topics)
        .set({ lastActivityAt: sql`${topics.lastActivityAt} + ${interval}` })
        .where(inArray(topics.id, chunk));
      await tx
        .update(topicTimelineEvents)
        .set({ occurredAt: sql`${topicTimelineEvents.occurredAt} + ${interval}` })
        .where(inArray(topicTimelineEvents.topicId, chunk));
    }
    await tx
      .update(articleIntegritySignals)
      .set({ evidenceDate: sql`${articleIntegritySignals.evidenceDate} + ${interval}` })
      .where(
        and(
          eq(articleIntegritySignals.origin, 'auto'),
          inArray(articleIntegritySignals.externalGuid, MOCK_GUIDS),
          sql`${articleIntegritySignals.evidenceDate} is not null`,
        ),
      );
    return { shiftHours: Math.round(shift / 3_600_000), articles: moved.length };
  });
}
