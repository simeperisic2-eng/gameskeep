import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { topics } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';

/**
 * AI-text provenance on stories (Phase P S5 — EU AI Act transparency, owner
 * rule): the automatic TL;DR and AI summary are AI-generated text published
 * automatically, so they carry a visible, locked "AI summary" label — until an
 * editor EDITS or APPROVES the text, which makes it editorial content (who +
 * when recorded). A later automatic regeneration of a field clears its approval
 * (the label is back). A locked field only ever holds editor text, so it counts
 * as editorial too.
 */
export class SummaryApprovalError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Editorial-or-not, as SQL booleans over `topics` (for public reads). */
export const tldrEditorialSql = sql<boolean>`(${topics.tldrApprovedAt} IS NOT NULL OR 'tldr' = ANY(${topics.lockedFields}))`;
export const summaryEditorialSql = sql<boolean>`(${topics.aiSummaryApprovedAt} IS NOT NULL OR 'aiSummary' = ANY(${topics.lockedFields}))`;

/** An editor changed the TL;DR and / or summary in the admin → those fields are editorial. */
export async function recordSummaryEdit(
  topicId: string,
  changed: string[],
  actor: AuditActor,
): Promise<void> {
  const set: Partial<typeof topics.$inferInsert> = {};
  const label = actor.label.slice(0, 120);
  if (changed.includes('tldr')) {
    set.tldrApprovedByLabel = label;
    set.tldrApprovedAt = new Date();
  }
  if (changed.includes('aiSummary')) {
    set.aiSummaryApprovedByLabel = label;
    set.aiSummaryApprovedAt = new Date();
  }
  if (Object.keys(set).length === 0) return;
  await db.update(topics).set(set).where(eq(topics.id, topicId));
}

/** "Approve" the current automatic TL;DR + summary as editorial (audited). */
export async function approveSummary(topicId: string, actor: AuditActor): Promise<void> {
  const [t] = await db
    .select({
      id: topics.id,
      title: topics.title,
      tldr: topics.tldr,
      aiSummary: topics.aiSummary,
      tldrBy: topics.tldrApprovedByLabel,
      summaryBy: topics.aiSummaryApprovedByLabel,
    })
    .from(topics)
    .where(eq(topics.id, topicId))
    .limit(1);
  if (!t) throw new SummaryApprovalError(404, 'No such story.');
  if (!t.tldr && !t.aiSummary)
    throw new SummaryApprovalError(409, 'This story has no summary to approve.');
  const label = actor.label.slice(0, 120);
  const now = new Date();
  await db
    .update(topics)
    .set({
      ...(t.tldr ? { tldrApprovedByLabel: label, tldrApprovedAt: now } : {}),
      ...(t.aiSummary ? { aiSummaryApprovedByLabel: label, aiSummaryApprovedAt: now } : {}),
    })
    .where(eq(topics.id, topicId));
  await writeAudit({
    action: 'update',
    entityType: 'topics',
    entityId: topicId,
    changes: {
      summaryApproved: { from: t.summaryBy, to: t.aiSummary ? label : t.summaryBy },
      tldrApproved: { from: t.tldrBy, to: t.tldr ? label : t.tldrBy },
      approvedText: { tldr: t.tldr, aiSummary: t.aiSummary },
    },
    summary: `AI summary approved as editorial: ${t.title.slice(0, 120)}`,
    actor,
  });
}

/** Withdraw an approval — the AI label is back (audited). Locked text stays editorial. */
export async function withdrawSummaryApproval(topicId: string, actor: AuditActor): Promise<void> {
  const res = await db
    .update(topics)
    .set({
      tldrApprovedByLabel: null,
      tldrApprovedAt: null,
      aiSummaryApprovedByLabel: null,
      aiSummaryApprovedAt: null,
    })
    .where(eq(topics.id, topicId))
    .returning({ id: topics.id, title: topics.title });
  if (res.length === 0) throw new SummaryApprovalError(404, 'No such story.');
  await writeAudit({
    action: 'update',
    entityType: 'topics',
    entityId: topicId,
    changes: { summaryApproved: { to: null }, tldrApproved: { to: null } },
    summary: `AI summary approval withdrawn: ${res[0]!.title.slice(0, 120)}`,
    actor,
  });
}

export interface StorySummaryRow {
  id: string;
  slug: string;
  title: string;
  tldr: string | null;
  aiSummary: string | null;
  tldrIsAi: boolean;
  summaryIsAi: boolean;
  tldrApprovedBy: string | null;
  summaryApprovedBy: string | null;
  approvedAt: string | null;
  locked: string[];
}

/** Recent public stories with AI text + its state (the approval queue). */
export async function listStorySummaries(
  filter: 'ai' | 'editorial' | 'all' = 'ai',
  limit = 60,
): Promise<StorySummaryRow[]> {
  const rows = await db
    .select({
      id: topics.id,
      slug: topics.slug,
      title: topics.title,
      tldr: topics.tldr,
      aiSummary: topics.aiSummary,
      tldrEditorial: tldrEditorialSql,
      summaryEditorial: summaryEditorialSql,
      tldrApprovedBy: topics.tldrApprovedByLabel,
      summaryApprovedBy: topics.aiSummaryApprovedByLabel,
      tldrApprovedAt: topics.tldrApprovedAt,
      summaryApprovedAt: topics.aiSummaryApprovedAt,
      locked: topics.lockedFields,
    })
    .from(topics)
    .where(
      sql`${topics.biasDistribution} IS NOT NULL AND (${topics.tldr} IS NOT NULL OR ${topics.aiSummary} IS NOT NULL)`,
    )
    .orderBy(sql`${topics.lastActivityAt} DESC NULLS LAST`)
    .limit(Math.min(200, Math.max(1, limit)) * (filter === 'all' ? 1 : 3));
  const out = rows.map((r) => {
    const at = [r.tldrApprovedAt, r.summaryApprovedAt]
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      tldr: r.tldr,
      aiSummary: r.aiSummary,
      tldrIsAi: Boolean(r.tldr) && !r.tldrEditorial,
      summaryIsAi: Boolean(r.aiSummary) && !r.summaryEditorial,
      tldrApprovedBy: r.tldrApprovedBy,
      summaryApprovedBy: r.summaryApprovedBy,
      approvedAt: at ? at.toISOString() : null,
      locked: r.locked ?? [],
    };
  });
  const filtered =
    filter === 'all'
      ? out
      : out.filter((r) =>
          filter === 'ai' ? r.tldrIsAi || r.summaryIsAi : !r.tldrIsAi && !r.summaryIsAi,
        );
  return filtered.slice(0, limit);
}
