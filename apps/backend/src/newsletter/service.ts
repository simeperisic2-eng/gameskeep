import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { NEWSLETTER_SEGMENT_ALL, type NewsletterCampaignKind } from '@gameskeep/shared/constants';
import type {
  newsletterCampaignCreate,
  newsletterCampaignUpdate,
} from '@gameskeep/shared/validation';
import type { z } from 'zod';
import { db } from '../db/client';
import { newsletterCampaigns, newsletterSubscriptions, topics, userConsents } from '../db/schema';
import { env } from '../config/env';
import { sendNewsletterEmail } from '../email/send';
import { MARKETING_CONSENT_TYPE } from '../awards/subscribe';
import { writeAudit, type AuditActor } from '../admin/audit';

/**
 * Newsletter campaigns (SPEC I8, Slice 3; BLUEPRINT 2.8). Staff compose/segment/
 * send campaigns over a SWAPPABLE send seam — in demo the Mock EmailSender writes
 * to `email_outbox` (ZERO network). No new AI: a `digest` body is assembled from
 * the EXISTING topic summaries. Segmentation is GDPR-gated: only ACTIVE +
 * not-withdrawn marketing subscribers are ever targetable, and no PII beyond the
 * address is used. Every mutation is audit-logged.
 */

type NewsletterErrorCode = 'not_found' | 'bad_state' | 'empty_audience';

export class NewsletterError extends Error {
  constructor(
    public readonly code: NewsletterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'NewsletterError';
  }
}

// ── GDPR-gated audience resolution ────────────────────────────────────────────
export interface Recipient {
  id: string;
  email: string;
  unsubscribeToken: string;
  userId: string | null;
}

/**
 * The authoritative GDPR gate (SPEC I8 verify). A subscriber is targetable iff:
 *   - their subscription is ACTIVE (unsubscribe / account-deletion clear this), AND
 *   - they are in the segment ('all', or their `source` matches), AND
 *   - they have NOT withdrawn marketing consent — for a REGISTERED subscriber we
 *     check the `user_consents` ledger and exclude anyone whose LATEST marketing
 *     consent event is a WITHDRAWAL. (Anonymous rows have no ledger; their opt-in
 *     is carried on the row itself, governed by `active`.)
 *
 * This holds even if a future code path flips only one of the two signals — the
 * withdrawn-consent check is independent of the `active` flag. Belt-and-braces:
 * `/auth/consent` marketing-withdrawal ALSO deactivates the subscription
 * (see awards/subscribe.ts), so the two can't drift in normal operation.
 */
export async function resolveAudience(segment: string): Promise<Recipient[]> {
  const notWithdrawn = sql`not exists (
    select 1 from ${userConsents} c
    where c.user_id = ${newsletterSubscriptions.userId}
      and c.consent_type = ${MARKETING_CONSENT_TYPE}
      and c.granted = false
      and c.created_at = (
        select max(c2.created_at) from ${userConsents} c2
        where c2.user_id = ${newsletterSubscriptions.userId}
          and c2.consent_type = ${MARKETING_CONSENT_TYPE}
      )
  )`;

  return db
    .select({
      id: newsletterSubscriptions.id,
      email: newsletterSubscriptions.email,
      unsubscribeToken: newsletterSubscriptions.unsubscribeToken,
      userId: newsletterSubscriptions.userId,
    })
    .from(newsletterSubscriptions)
    .where(
      and(
        eq(newsletterSubscriptions.active, true),
        segment === NEWSLETTER_SEGMENT_ALL
          ? undefined
          : eq(newsletterSubscriptions.source, segment),
        notWithdrawn,
      ),
    );
}

/** How many subscribers a segment would reach right now (GDPR-gated preview). */
export async function audienceSize(segment: string): Promise<number> {
  return (await resolveAudience(segment)).length;
}

// ── digest assembly (reuses EXISTING summaries — no new AI) ────────────────────
/**
 * Build a plain-text digest from the EXISTING topic summaries (`tldr` /
 * `ai_summary`) — nothing is generated. Picks the most recently active stories
 * that already carry a summary. Returns null when there is nothing summarized
 * yet (the route surfaces that instead of shipping an empty digest).
 */
export async function buildDigest(
  limit = 6,
): Promise<{ subject: string; preheader: string; body: string } | null> {
  const rows = await db
    .select({
      slug: topics.slug,
      title: topics.title,
      tldr: topics.tldr,
      aiSummary: topics.aiSummary,
    })
    .from(topics)
    .where(or(sql`${topics.tldr} is not null`, sql`${topics.aiSummary} is not null`))
    .orderBy(sql`${topics.lastActivityAt} desc nulls last`)
    .limit(limit);

  if (rows.length === 0) return null;

  const site = env.PUBLIC_SITE_URL.replace(/\/+$/, '');
  const items = rows.map((t) => {
    const summary = (t.tldr ?? t.aiSummary ?? '').trim();
    return [`▸ ${t.title}`, summary, `${site}/topics/${t.slug}`].filter(Boolean).join('\n');
  });

  // Clamp to the column limits (varchar(200)) — the preheader is a join of real
  // titles and can easily exceed 200 chars (anti-bug rule: never trust length).
  const clamp = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  return {
    subject: clamp(`GamesKeep digest — ${rows.length} stories worth your time`, 200),
    preheader: clamp(
      rows
        .map((t) => t.title)
        .slice(0, 3)
        .join(' · '),
      200,
    ),
    body: [
      'The stories our readers are following right now — with the bias and',
      'quality signal baked in. Read the full analysis on each.',
      '',
      items.join('\n\n'),
    ].join('\n'),
  };
}

// ── campaign CRUD (compose / edit drafts) ─────────────────────────────────────
type CreateInput = z.infer<typeof newsletterCampaignCreate>;
type UpdateInput = z.infer<typeof newsletterCampaignUpdate>;

export async function createCampaign(
  input: CreateInput,
  actor: AuditActor,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(newsletterCampaigns)
    .values({
      subject: input.subject,
      preheader: input.preheader ?? null,
      body: input.body,
      segment: input.segment,
      kind: input.kind as NewsletterCampaignKind,
      status: input.scheduledAt ? 'scheduled' : 'draft',
      scheduledAt: input.scheduledAt ?? null,
      createdBy: actor.userId ?? null,
    })
    .returning({ id: newsletterCampaigns.id });
  if (!row) throw new NewsletterError('bad_state', 'Failed to create the campaign.');
  await writeAudit({
    action: 'create',
    entityType: 'newsletter-campaign',
    entityId: row.id,
    changes: {
      subject: { from: null, to: input.subject },
      segment: { from: null, to: input.segment },
    },
    summary: `newsletter "${input.subject}" composed (${input.kind}, → ${input.segment})`,
    actor,
  });
  return { id: row.id };
}

/** Edit a campaign that has NOT been sent. A sent/sending campaign is immutable. */
export async function updateCampaign(
  id: string,
  patch: UpdateInput,
  actor: AuditActor,
): Promise<{ id: string }> {
  const [before] = await db
    .select({ status: newsletterCampaigns.status, subject: newsletterCampaigns.subject })
    .from(newsletterCampaigns)
    .where(eq(newsletterCampaigns.id, id))
    .limit(1);
  if (!before) throw new NewsletterError('not_found', 'Unknown campaign.');
  if (before.status === 'sent' || before.status === 'sending') {
    throw new NewsletterError('bad_state', 'A sent campaign can no longer be edited.');
  }

  await db
    .update(newsletterCampaigns)
    .set({
      ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
      ...(patch.preheader !== undefined ? { preheader: patch.preheader ?? null } : {}),
      ...(patch.body !== undefined ? { body: patch.body } : {}),
      ...(patch.segment !== undefined ? { segment: patch.segment } : {}),
      ...(patch.scheduledAt !== undefined ? { scheduledAt: patch.scheduledAt ?? null } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      updatedAt: new Date(),
    })
    .where(eq(newsletterCampaigns.id, id));
  await writeAudit({
    action: 'update',
    entityType: 'newsletter-campaign',
    entityId: id,
    changes: patch.status ? { status: { from: before.status, to: patch.status } } : {},
    summary: `newsletter "${before.subject}" edited`,
    actor,
  });
  return { id };
}

// ── send (Mock seam → outbox, zero network) ───────────────────────────────────
/**
 * Send a campaign to its GDPR-gated audience. Only a draft/scheduled campaign
 * may send (a sent one can't re-send). Fans out one email per recipient through
 * the active EmailSender (Mock → `email_outbox` in demo, ZERO network), each
 * carrying that recipient's own unsubscribe link, then records the aggregate
 * recipient count. Audited.
 */
export async function sendCampaign(
  id: string,
  actor: AuditActor,
): Promise<{ recipientCount: number }> {
  const [c] = await db
    .select({
      status: newsletterCampaigns.status,
      subject: newsletterCampaigns.subject,
      body: newsletterCampaigns.body,
      segment: newsletterCampaigns.segment,
    })
    .from(newsletterCampaigns)
    .where(eq(newsletterCampaigns.id, id))
    .limit(1);
  if (!c) throw new NewsletterError('not_found', 'Unknown campaign.');
  if (c.status !== 'draft' && c.status !== 'scheduled') {
    throw new NewsletterError('bad_state', `A ${c.status} campaign cannot be sent.`);
  }

  const audience = await resolveAudience(c.segment);
  if (audience.length === 0) {
    throw new NewsletterError('empty_audience', 'No consented subscribers in this segment.');
  }

  await db
    .update(newsletterCampaigns)
    .set({ status: 'sending', updatedAt: new Date() })
    .where(eq(newsletterCampaigns.id, id));

  let sent = 0;
  for (const r of audience) {
    const ok = await sendNewsletterEmail(
      r.email,
      c.subject,
      c.body,
      r.unsubscribeToken,
      r.userId ?? undefined,
    );
    if (ok) sent += 1;
  }

  await db
    .update(newsletterCampaigns)
    .set({ status: 'sent', sentAt: new Date(), recipientCount: sent, updatedAt: new Date() })
    .where(eq(newsletterCampaigns.id, id));
  await writeAudit({
    action: 'update',
    entityType: 'newsletter-campaign',
    entityId: id,
    changes: { status: { from: c.status, to: 'sent' }, recipientCount: { from: 0, to: sent } },
    summary: `newsletter "${c.subject}" sent to ${sent} subscriber(s)`,
    actor,
  });
  return { recipientCount: sent };
}

// ── analytics + subscriber management ─────────────────────────────────────────
export interface NewsletterOverview {
  subscribers: { total: number; active: number; unsubscribed: number };
  segments: { segment: string; active: number }[];
  growth: { weekEnding: string; activeSubscribers: number }[];
  campaigns: {
    id: string;
    subject: string;
    segment: string;
    kind: string;
    status: string;
    recipientCount: number;
    opens: number;
    clicks: number;
    scheduledAt: string | null;
    sentAt: string | null;
    createdAt: string | null;
  }[];
}

/** Dashboard payload: subscriber stats, per-segment active counts, 8-week growth, campaigns. */
export async function newsletterOverview(now: Date = new Date()): Promise<NewsletterOverview> {
  const [counts] = await db
    .select({
      total: sql<string>`count(*)`,
      active: sql<string>`count(*) filter (where ${newsletterSubscriptions.active} = true)`,
    })
    .from(newsletterSubscriptions);
  const total = Number(counts?.total ?? 0);
  const active = Number(counts?.active ?? 0);

  const segmentRows = await db
    .select({
      segment: newsletterSubscriptions.source,
      active: sql<string>`count(*) filter (where ${newsletterSubscriptions.active} = true)`,
    })
    .from(newsletterSubscriptions)
    .groupBy(newsletterSubscriptions.source)
    .orderBy(desc(sql`count(*) filter (where ${newsletterSubscriptions.active} = true)`));

  // 8 weekly points: ACTIVE-as-of each week end (created by then, not yet
  // unsubscribed by then) — real growth from the subscription timeline.
  const growth: { weekEnding: string; activeSubscribers: number }[] = [];
  for (let w = 7; w >= 0; w -= 1) {
    const end = new Date(now.getTime() - w * 7 * 86_400_000);
    const [row] = await db
      .select({ n: sql<string>`count(*)` })
      .from(newsletterSubscriptions)
      .where(
        sql`${newsletterSubscriptions.createdAt} <= ${end} and (${newsletterSubscriptions.unsubscribedAt} is null or ${newsletterSubscriptions.unsubscribedAt} > ${end})`,
      );
    growth.push({
      weekEnding: end.toISOString().slice(0, 10),
      activeSubscribers: Number(row?.n ?? 0),
    });
  }

  const campaignRows = await db
    .select()
    .from(newsletterCampaigns)
    .orderBy(desc(newsletterCampaigns.createdAt))
    .limit(50);

  return {
    subscribers: { total, active, unsubscribed: total - active },
    segments: segmentRows.map((s) => ({ segment: s.segment, active: Number(s.active) })),
    growth,
    campaigns: campaignRows.map((c) => ({
      id: c.id,
      subject: c.subject,
      segment: c.segment,
      kind: c.kind,
      status: c.status,
      recipientCount: c.recipientCount,
      opens: c.opens,
      clicks: c.clicks,
      scheduledAt: c.scheduledAt ? c.scheduledAt.toISOString() : null,
      sentAt: c.sentAt ? c.sentAt.toISOString() : null,
      createdAt: c.createdAt ? c.createdAt.toISOString() : null,
    })),
  };
}

export interface SubscriberRow {
  id: string;
  email: string;
  source: string;
  active: boolean;
  registered: boolean;
  createdAt: string | null;
  unsubscribedAt: string | null;
}

/** Staff subscriber list — the address is the only PII (no name/profile joined). */
export async function listSubscribers(query?: string, limit = 100): Promise<SubscriberRow[]> {
  const q = query?.trim();
  const rows = await db
    .select({
      id: newsletterSubscriptions.id,
      email: newsletterSubscriptions.email,
      source: newsletterSubscriptions.source,
      active: newsletterSubscriptions.active,
      userId: newsletterSubscriptions.userId,
      createdAt: newsletterSubscriptions.createdAt,
      unsubscribedAt: newsletterSubscriptions.unsubscribedAt,
    })
    .from(newsletterSubscriptions)
    .where(q ? ilike(newsletterSubscriptions.email, `%${q}%`) : undefined)
    .orderBy(desc(newsletterSubscriptions.createdAt))
    .limit(Math.min(limit, 500));

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    source: r.source,
    active: r.active,
    registered: r.userId !== null,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    unsubscribedAt: r.unsubscribedAt ? r.unsubscribedAt.toISOString() : null,
  }));
}

/** Staff deactivates a subscription (honours the same suppression as self-unsubscribe). */
export async function staffUnsubscribe(id: string, actor: AuditActor): Promise<boolean> {
  const [sub] = await db
    .select({ email: newsletterSubscriptions.email, active: newsletterSubscriptions.active })
    .from(newsletterSubscriptions)
    .where(eq(newsletterSubscriptions.id, id))
    .limit(1);
  if (!sub) return false;
  await db
    .update(newsletterSubscriptions)
    .set({ active: false, unsubscribedAt: new Date(), updatedAt: new Date() })
    .where(eq(newsletterSubscriptions.id, id));
  await writeAudit({
    action: 'update',
    entityType: 'newsletter-subscription',
    entityId: id,
    changes: { active: { from: sub.active, to: false } },
    summary: `subscriber unsubscribed by staff`,
    actor,
  });
  return true;
}
