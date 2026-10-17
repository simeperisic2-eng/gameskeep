import { and, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import { gameSteamReviewSummaries, games, subjects } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';
import { summarizeTopic } from '../ai/client';
import { getSteamReviewsProvider } from '../data-source/steam/reviews';
import type { SteamReviewBatch } from '../data-source/steam/types';
import { rulesSettings } from '../rules/settings';

/**
 * Steam reviews summary (Phase P S5). A background job reads the last N days of
 * a game's Steam reviews, strips everything that identifies a reviewer (names
 * from the review metadata wherever they appear in ANY review text, @handles,
 * profile links, Steam ids, emails, URLs), asks the AI for a short summary of
 * what is left, and stores ONLY: the review count, the share of positive
 * reviews, the window and the summary. No reviewer data is stored. As a
 * fail-safe a summary that still contains a reviewer name is dropped.
 *
 * Public: shown only from `steamReviews.reviewsMin` reviews, labelled "AI
 * summary of N Steam reviews, last D days" (locked) unless an editor edited or
 * approved the text. Overrides: hide, edit, approve, back to automatic.
 */

const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\bsteamcommunity\.com\/\S+/giu;
const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu;
const HANDLE_RE = /(?<![\p{L}\p{N}])@[\p{L}\p{N}_.]{2,}/giu;
const STEAM_ID_RE = /\b7656119\d{10}\b/gu;
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** Remove reviewer-identifying data from one review text (pure; unit-tested). */
export function scrubReviewText(text: string, names: readonly string[]): string {
  let out = String(text ?? '')
    .replace(URL_RE, ' ')
    .replace(EMAIL_RE, ' ')
    .replace(STEAM_ID_RE, ' ')
    .replace(HANDLE_RE, 'another reviewer');
  for (const name of names) {
    const n = String(name ?? '').trim();
    if (n.length < 2) continue;
    out = out.replace(
      new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRe(n)}(?![\\p{L}\\p{N}_])`, 'giu'),
      'another reviewer',
    );
  }
  return out
    .replace(/\s+([,.;:!?])/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 1200);
}

/** Does a text still contain any reviewer name / id / handle? (pure; the fail-safe) */
export function leaksReviewerData(text: string, names: readonly string[]): boolean {
  const t = String(text ?? '');
  if (STEAM_ID_RE.test(t) || HANDLE_RE.test(t) || /steamcommunity\.com/iu.test(t)) {
    STEAM_ID_RE.lastIndex = 0;
    HANDLE_RE.lastIndex = 0;
    return true;
  }
  const lower = t.toLowerCase();
  return names.some((n) => {
    const v = String(n ?? '')
      .trim()
      .toLowerCase();
    return v.length >= 2 && lower.includes(v);
  });
}

/** Keep the first N sentences (pure). */
export function firstSentences(text: string, n: number): string {
  const parts = String(text ?? '')
    .split(/(?<=[.!?])\s+/u)
    .filter((p) => /\p{L}/u.test(p));
  return parts.slice(0, Math.max(1, n)).join(' ').trim();
}

/** Batch → what may be stored: stats + scrubbed texts for the AI (pure). */
export function prepareBatch(batch: SteamReviewBatch): {
  count: number;
  positivePct: number | null;
  texts: string[];
  names: string[];
} {
  const names = [
    ...new Set(
      batch.reviews
        .flatMap((r) => [r.authorName, r.authorId])
        .filter((v): v is string => typeof v === 'string' && v.trim().length >= 2),
    ),
  ];
  const count = Math.max(batch.totalInWindow, batch.reviews.length);
  const positivePct =
    batch.totalInWindow > 0
      ? Math.round((batch.positiveInWindow / batch.totalInWindow) * 1000) / 10
      : batch.reviews.length > 0
        ? Math.round(
            (batch.reviews.filter((r) => r.votedUp).length / batch.reviews.length) * 1000,
          ) / 10
        : null;
  const texts = batch.reviews
    .map((r) => scrubReviewText(r.text, names))
    .filter((t) => /\p{L}{3,}/u.test(t));
  return { count, positivePct, texts, names };
}

export interface SteamSummaryRun {
  games: number;
  summarised: number;
  belowThreshold: number;
  dropped: number;
  failed: number;
}

/** The job body: every game with a Steam app id. One failing game never stops the run. */
export async function runSteamReviewSummaries(): Promise<SteamSummaryRun> {
  const rules = (await rulesSettings({ fresh: true })).steamReviews;
  const run: SteamSummaryRun = {
    games: 0,
    summarised: 0,
    belowThreshold: 0,
    dropped: 0,
    failed: 0,
  };
  if (!rules.enabled) return run;
  const provider = getSteamReviewsProvider();
  const rows = await db
    .select({ id: games.id, appId: games.steamAppId })
    .from(games)
    .where(isNotNull(games.steamAppId));
  for (const g of rows) {
    if (!g.appId) continue;
    run.games += 1;
    try {
      const batch = await provider.recentReviews(g.appId, {
        days: rules.windowDays,
        max: rules.maxReviews,
      });
      if (!batch) continue;
      const prep = prepareBatch(batch);
      let summary: string | null = null;
      if (prep.count >= rules.reviewsMin && prep.texts.length > 0) {
        const out = await summarizeTopic(prep.texts.map((t) => ({ title: '', excerpt: t })));
        const text = firstSentences(out.summary || out.tldr, rules.summarySentences);
        if (text && !leaksReviewerData(text, prep.names)) summary = text;
        else if (text) run.dropped += 1;
      } else {
        run.belowThreshold += 1;
      }
      // Reviewer names / ids are discarded here — only the stats + summary are kept.
      await storeSummary(g.id, {
        count: prep.count,
        positivePct: prep.positivePct,
        windowDays: rules.windowDays,
        summary,
        provider: provider.name,
      });
      if (summary) run.summarised += 1;
    } catch (err) {
      run.failed += 1;
      console.error('[steam-reviews] one game failed (the run continues):', (err as Error).message);
    }
  }
  return run;
}

async function storeSummary(
  gameId: string,
  v: {
    count: number;
    positivePct: number | null;
    windowDays: number;
    summary: string | null;
    provider: string;
  },
): Promise<void> {
  const [before] = await db
    .select({ summaryText: gameSteamReviewSummaries.summaryText })
    .from(gameSteamReviewSummaries)
    .where(eq(gameSteamReviewSummaries.gameId, gameId))
    .limit(1);
  const changed = (before?.summaryText ?? null) !== v.summary;
  await db
    .insert(gameSteamReviewSummaries)
    .values({
      gameId,
      reviewCount: v.count,
      positivePct: v.positivePct,
      windowDays: v.windowDays,
      summaryText: v.summary,
      provider: v.provider,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: gameSteamReviewSummaries.gameId,
      set: {
        reviewCount: v.count,
        positivePct: v.positivePct,
        windowDays: v.windowDays,
        summaryText: v.summary,
        provider: v.provider,
        computedAt: new Date(),
        updatedAt: new Date(),
        // An approval covers the text it approved: new automatic text → the AI label is back.
        ...(changed ? { approvedByLabel: null, approvedAt: null } : {}),
      },
    });
}

// ── admin ─────────────────────────────────────────────────────────────────────
export class SteamSummaryError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface AdminSteamSummary {
  slug: string;
  name: string;
  reviewCount: number;
  positivePct: number | null;
  windowDays: number;
  summaryText: string | null;
  editedText: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  hidden: boolean;
  computedAt: string | null;
  /** What readers see right now (null = nothing shown) + whether it is labelled AI. */
  publicState: 'shown-ai' | 'shown-editorial' | 'below-threshold' | 'hidden' | 'no-text';
}

function publicStateOf(
  r: {
    reviewCount: number;
    summaryText: string | null;
    editedText: string | null;
    approvedAt: Date | null;
    hidden: boolean;
  },
  reviewsMin: number,
): AdminSteamSummary['publicState'] {
  if (r.hidden) return 'hidden';
  if (r.reviewCount < reviewsMin) return 'below-threshold';
  if (r.editedText) return 'shown-editorial';
  if (!r.summaryText) return 'no-text';
  return r.approvedAt ? 'shown-editorial' : 'shown-ai';
}

export async function listSteamSummaries(): Promise<AdminSteamSummary[]> {
  const rules = (await rulesSettings()).steamReviews;
  const rows = await db
    .select({
      slug: subjects.slug,
      name: subjects.name,
      reviewCount: gameSteamReviewSummaries.reviewCount,
      positivePct: gameSteamReviewSummaries.positivePct,
      windowDays: gameSteamReviewSummaries.windowDays,
      summaryText: gameSteamReviewSummaries.summaryText,
      editedText: gameSteamReviewSummaries.editedText,
      approvedBy: gameSteamReviewSummaries.approvedByLabel,
      approvedAt: gameSteamReviewSummaries.approvedAt,
      hidden: gameSteamReviewSummaries.hidden,
      computedAt: gameSteamReviewSummaries.computedAt,
    })
    .from(gameSteamReviewSummaries)
    .innerJoin(games, eq(games.id, gameSteamReviewSummaries.gameId))
    .innerJoin(subjects, eq(subjects.id, games.subjectId))
    .orderBy(subjects.name);
  return rows.map((r) => ({
    ...r,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    computedAt: r.computedAt ? r.computedAt.toISOString() : null,
    publicState: publicStateOf(r, rules.reviewsMin),
  }));
}

/** Hide / edit / approve / back to automatic — audited old → new. */
export async function overrideSteamSummary(
  slug: string,
  input: { hidden?: boolean; text?: string | null; approve?: true },
  actor: AuditActor,
): Promise<void> {
  const [row] = await db
    .select({
      id: gameSteamReviewSummaries.id,
      gameId: gameSteamReviewSummaries.gameId,
      name: subjects.name,
      summaryText: gameSteamReviewSummaries.summaryText,
      editedText: gameSteamReviewSummaries.editedText,
      approvedAt: gameSteamReviewSummaries.approvedAt,
      approvedBy: gameSteamReviewSummaries.approvedByLabel,
      hidden: gameSteamReviewSummaries.hidden,
    })
    .from(gameSteamReviewSummaries)
    .innerJoin(games, eq(games.id, gameSteamReviewSummaries.gameId))
    .innerJoin(subjects, eq(subjects.id, games.subjectId))
    .where(eq(subjects.slug, slug))
    .limit(1);
  if (!row)
    throw new SteamSummaryError(404, 'No Steam summary for this game yet — run the job first.');
  const set: Partial<typeof gameSteamReviewSummaries.$inferInsert> = { updatedAt: new Date() };
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (input.hidden !== undefined && input.hidden !== row.hidden) {
    set.hidden = input.hidden;
    changes.hidden = { from: row.hidden, to: input.hidden };
  }
  if (input.text !== undefined) {
    // An editor's own text is editorial (who + when recorded); null = back to automatic.
    set.editedText = input.text;
    set.approvedByLabel = input.text ? actor.label.slice(0, 120) : null;
    set.approvedAt = input.text ? new Date() : null;
    changes.editedText = { from: row.editedText, to: input.text };
  }
  if (input.approve) {
    if (!row.summaryText)
      throw new SteamSummaryError(409, 'There is no automatic text to approve.');
    set.approvedByLabel = actor.label.slice(0, 120);
    set.approvedAt = new Date();
    changes.approved = { from: row.approvedBy, to: actor.label };
  }
  if (Object.keys(changes).length === 0) return;
  await db.update(gameSteamReviewSummaries).set(set).where(eq(gameSteamReviewSummaries.id, row.id));
  await writeAudit({
    action: 'update',
    entityType: 'steam-review-summary',
    entityId: row.gameId,
    changes,
    summary: `Steam reviews summary override: ${row.name}`,
    actor,
  });
}

// ── public ────────────────────────────────────────────────────────────────────
export interface PublicSteamSummary {
  reviewCount: number;
  positivePct: number | null;
  windowDays: number;
  text: string;
  /** True → render the locked "AI summary of N Steam reviews" label. */
  isAi: boolean;
  storeUrl: string | null;
}

export async function publicSteamSummary(
  gameId: string,
  steamAppId: number | null,
): Promise<PublicSteamSummary | null> {
  const rules = (await rulesSettings()).steamReviews;
  if (!rules.enabled) return null;
  const [r] = await db
    .select()
    .from(gameSteamReviewSummaries)
    .where(
      and(eq(gameSteamReviewSummaries.gameId, gameId), eq(gameSteamReviewSummaries.hidden, false)),
    )
    .limit(1);
  if (!r || r.reviewCount < rules.reviewsMin) return null;
  const text = r.editedText ?? r.summaryText;
  if (!text) return null;
  return {
    reviewCount: r.reviewCount,
    positivePct: r.positivePct ?? null,
    windowDays: r.windowDays,
    text,
    isAi: !r.editedText && !r.approvedAt,
    storeUrl: steamAppId ? `https://store.steampowered.com/app/${steamAppId}/` : null,
  };
}
