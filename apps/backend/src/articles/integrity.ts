import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  INTEGRITY_SIGNAL_KINDS,
  INTEGRITY_SNIPPET_MAX,
  type IntegritySignalKind,
  type IntegritySignalStatus,
} from '@gameskeep/shared/constants';
import { db } from '../db/client';
import { articleIntegritySignals, articles, sources } from '../db/schema';
import { diffRows, writeAudit, type AuditActor } from '../admin/audit';
import type { IntegrityLexicon } from '../display/settings';

/**
 * Review integrity (Phase P S1) — evidence-backed rows on review articles:
 * publisher review copy, embargo, sponsored event / press trip. A row needs
 * evidence (a short source snippet, or a moderator note + date) and is public
 * only once confirmed — or while `integrity.autoPublish` is on, when merely
 * detected. Nothing here feeds the bias scores (the engine stays as built); and
 * the engine's TYPE-based review-copy inference never reaches a public surface —
 * public review-copy displays derive from these rows only.
 */

export const INTEGRITY_LABEL: Record<IntegritySignalKind, string> = {
  review_copy: 'Review copy from publisher',
  embargo: 'Embargo',
  sponsored_event: 'Sponsored event or press trip',
};

const LEXICON_KEY: Record<IntegritySignalKind, keyof Omit<IntegrityLexicon, 'negations'>> = {
  review_copy: 'reviewCopy',
  embargo: 'embargo',
  sponsored_event: 'sponsoredEvent',
};

// ── pure detection ───────────────────────────────────────────────────────────

export interface IntegrityText {
  title: string;
  excerpt?: string | null;
  /** An outlet's disclosure line (feed adapters fill it where the source has one). */
  disclosure?: string | null;
}

export interface DetectedIntegrity {
  kind: IntegritySignalKind;
  snippet: string;
}

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Clip to the snippet cap at a word boundary (evidence stays short). */
export function clipSnippet(s: string, max = INTEGRITY_SNIPPET_MAX): string {
  const t = squash(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(squash)
    .filter(Boolean);
}

/** A negation only cancels a match inside the SAME clause ("…provided, but no embargo"). */
function clausesOf(sentence: string): string[] {
  return sentence
    .split(/[;:,—–]|\s-\s|\bbut\b|\bhowever\b|\bwhile\b/i)
    .map(squash)
    .filter(Boolean);
}

/**
 * Find integrity signals in an article's text. Case-insensitive substring match
 * per clause; a clause that also contains a negation phrase is not a signal. The
 * snippet is the whole containing sentence (context), clipped. First hit per kind;
 * the disclosure line is read first (it is the most explicit source).
 */
export function detectIntegrity(
  text: IntegrityText,
  lexicon: IntegrityLexicon,
): DetectedIntegrity[] {
  const parts = [text.disclosure, text.excerpt, text.title].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  );
  const negations = lexicon.negations.map((n) => n.toLowerCase());
  const found: DetectedIntegrity[] = [];
  for (const kind of INTEGRITY_SIGNAL_KINDS) {
    const phrases = lexicon[LEXICON_KEY[kind]].map((p) => p.toLowerCase());
    if (phrases.length === 0) continue;
    let snippet: string | null = null;
    outer: for (const part of parts) {
      for (const sentence of sentencesOf(part)) {
        for (const clause of clausesOf(sentence)) {
          const lc = clause.toLowerCase();
          if (!phrases.some((p) => lc.includes(p))) continue;
          if (negations.some((n) => lc.includes(n))) continue;
          snippet = clipSnippet(sentence);
          break outer;
        }
      }
    }
    if (snippet) found.push({ kind, snippet });
  }
  return found;
}

// ── scan (background, inside the ingest job) ─────────────────────────────────

export interface IntegrityScanItem extends IntegrityText {
  guid: string;
}

/**
 * Scan pulled feed items for REVIEW articles already in the DB and file any new
 * auto signal as `detected`. Idempotent: one row per (article, kind) and an
 * existing row — including a moderator's confirm/dismiss — is never overwritten.
 */
export async function scanIntegrity(
  items: IntegrityScanItem[],
  lexicon: IntegrityLexicon,
): Promise<{ reviewsScanned: number; signalsFiled: number }> {
  const byGuid = new Map(items.map((i) => [i.guid, i]));
  const guids = [...byGuid.keys()];
  let reviewsScanned = 0;
  let signalsFiled = 0;
  for (let i = 0; i < guids.length; i += 500) {
    const chunk = guids.slice(i, i + 500);
    if (chunk.length === 0) continue;
    const rows = await db
      .select({
        id: articles.id,
        guid: articles.externalGuid,
        sourceId: articles.sourceId,
        publishDate: articles.publishDate,
      })
      .from(articles)
      .where(and(inArray(articles.externalGuid, chunk), eq(articles.articleType, 'review')));
    for (const row of rows) {
      const item = row.guid ? byGuid.get(row.guid) : undefined;
      if (!item) continue;
      reviewsScanned += 1;
      for (const d of detectIntegrity(item, lexicon)) {
        const inserted = await db
          .insert(articleIntegritySignals)
          .values({
            articleId: row.id,
            sourceId: row.sourceId,
            externalGuid: row.guid,
            kind: d.kind,
            origin: 'auto',
            status: 'detected',
            evidenceSnippet: d.snippet,
            evidenceDate: row.publishDate ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: articleIntegritySignals.id });
        signalsFiled += inserted.length;
      }
    }
  }
  return { reviewsScanned, signalsFiled };
}

// ── public read ──────────────────────────────────────────────────────────────

export interface PublicIntegrityRow {
  kind: IntegritySignalKind;
  label: string;
  /** `snippet` = quoted from the source article (always linked); `note` = editor. */
  evidenceType: 'snippet' | 'note';
  evidence: string;
  date: string | null;
  confirmed: boolean;
}

export function isPublicIntegrityStatus(
  status: IntegritySignalStatus,
  autoPublish: boolean,
): boolean {
  return status === 'confirmed' || (autoPublish && status === 'detected');
}

/**
 * The public evidence of a row, or null (then the row is not public). The quoted
 * source snippet wins — it is the stronger, checkable evidence — but only with an
 * http(s) source URL to link to (evidence always links out); otherwise the
 * editor's note. A confirming note never replaces a source quote.
 */
function publicEvidence(r: {
  snippet: string | null;
  note: string | null;
  url: string | null;
}): { type: 'snippet' | 'note'; text: string } | null {
  if (r.snippet && r.url && /^https?:\/\//i.test(r.url))
    return { type: 'snippet', text: r.snippet };
  if (r.note) return { type: 'note', text: r.note };
  return null;
}

/** Public integrity rows per article (public statuses with evidence only). */
export async function publicIntegrityFor(
  articleIds: string[],
  autoPublish: boolean,
): Promise<Map<string, PublicIntegrityRow[]>> {
  const out = new Map<string, PublicIntegrityRow[]>();
  if (articleIds.length === 0) return out;
  const rows = await db
    .select({
      articleId: articleIntegritySignals.articleId,
      kind: articleIntegritySignals.kind,
      status: articleIntegritySignals.status,
      snippet: articleIntegritySignals.evidenceSnippet,
      note: articleIntegritySignals.editorNote,
      evidenceDate: articleIntegritySignals.evidenceDate,
      url: articles.url,
    })
    .from(articleIntegritySignals)
    .innerJoin(articles, eq(articles.id, articleIntegritySignals.articleId))
    .where(inArray(articleIntegritySignals.articleId, articleIds));
  for (const r of rows) {
    if (!r.articleId || !isPublicIntegrityStatus(r.status, autoPublish)) continue;
    const evidence = publicEvidence(r);
    if (!evidence) continue;
    const list = out.get(r.articleId) ?? [];
    list.push({
      kind: r.kind,
      label: INTEGRITY_LABEL[r.kind],
      evidenceType: evidence.type,
      evidence: evidence.text,
      date: r.evidenceDate ? r.evidenceDate.toISOString() : null,
      confirmed: r.status === 'confirmed',
    });
    out.set(r.articleId, list);
  }
  for (const list of out.values()) {
    list.sort(
      (a, b) => INTEGRITY_SIGNAL_KINDS.indexOf(a.kind) - INTEGRITY_SIGNAL_KINDS.indexOf(b.kind),
    );
  }
  return out;
}

/**
 * Every article's PUBLIC integrity kinds (same publication + evidence rule as
 * `publicIntegrityFor`). Review copy here is the ONLY source for a public
 * review-copy display on a review (chips, topic and source counts); the other
 * kinds keep topic/source tallies from calling such an article "no signals
 * found". Small: at most one row per (review, kind).
 */
export async function publicIntegrityKinds(
  autoPublish: boolean,
): Promise<Map<string, Set<IntegritySignalKind>>> {
  const rows = await db
    .select({
      articleId: articleIntegritySignals.articleId,
      kind: articleIntegritySignals.kind,
      status: articleIntegritySignals.status,
      snippet: articleIntegritySignals.evidenceSnippet,
      note: articleIntegritySignals.editorNote,
      url: articles.url,
    })
    .from(articleIntegritySignals)
    .innerJoin(articles, eq(articles.id, articleIntegritySignals.articleId));
  const out = new Map<string, Set<IntegritySignalKind>>();
  for (const r of rows) {
    if (!r.articleId || !isPublicIntegrityStatus(r.status, autoPublish)) continue;
    if (!publicEvidence(r)) continue;
    const set = out.get(r.articleId) ?? new Set<IntegritySignalKind>();
    set.add(r.kind);
    out.set(r.articleId, set);
  }
  return out;
}

// ── moderator operations (audited) ───────────────────────────────────────────

const AUDIT_ENTITY = 'article-integrity';

export type IntegrityOpError = 'not_found' | 'not_review';

/** Add a signal, or confirm the existing one of that kind, with a note + date. */
export async function addOrConfirmSignal(
  articleId: string,
  input: { kind: IntegritySignalKind; note: string; evidenceDate: string },
  actor: AuditActor,
): Promise<{ id: string } | IntegrityOpError> {
  const [article] = await db
    .select({
      id: articles.id,
      articleType: articles.articleType,
      sourceId: articles.sourceId,
      externalGuid: articles.externalGuid,
    })
    .from(articles)
    .where(eq(articles.id, articleId))
    .limit(1);
  if (!article) return 'not_found';
  if (article.articleType !== 'review') return 'not_review';

  const evidenceDate = new Date(`${input.evidenceDate}T00:00:00Z`);
  const decided = {
    status: 'confirmed' as const,
    editorNote: input.note,
    decidedByUserId: actor.userId ?? null,
    decidedByLabel: actor.label,
    decidedAt: new Date(),
  };
  const [existing] = await db
    .select()
    .from(articleIntegritySignals)
    .where(
      and(
        eq(articleIntegritySignals.articleId, articleId),
        eq(articleIntegritySignals.kind, input.kind),
      ),
    )
    .limit(1);

  if (existing) {
    const [after] = await db
      .update(articleIntegritySignals)
      .set({ ...decided, evidenceDate, updatedAt: new Date() })
      .where(eq(articleIntegritySignals.id, existing.id))
      .returning();
    await writeAudit({
      action: 'update',
      entityType: AUDIT_ENTITY,
      entityId: existing.id,
      changes: after ? diffRows(existing, after) : null,
      summary: `confirmed ${input.kind} signal on article ${articleId}`,
      actor,
    });
    return { id: existing.id };
  }

  const [created] = await db
    .insert(articleIntegritySignals)
    .values({
      articleId,
      sourceId: article.sourceId,
      externalGuid: article.externalGuid,
      kind: input.kind,
      origin: 'editor',
      evidenceDate,
      ...decided,
    })
    .returning();
  if (!created) throw new Error('integrity: insert returned no row');
  await writeAudit({
    action: 'create',
    entityType: AUDIT_ENTITY,
    entityId: created.id,
    changes: { created: created },
    summary: `added ${input.kind} signal on article ${articleId}`,
    actor,
  });
  return { id: created.id };
}

/** Confirm or dismiss an existing signal (keeps an optional note). */
export async function decideSignal(
  signalId: string,
  status: 'confirmed' | 'dismissed',
  note: string | undefined,
  actor: AuditActor,
): Promise<{ id: string } | null> {
  const [before] = await db
    .select()
    .from(articleIntegritySignals)
    .where(eq(articleIntegritySignals.id, signalId))
    .limit(1);
  if (!before) return null;
  const [after] = await db
    .update(articleIntegritySignals)
    .set({
      status,
      ...(note ? { editorNote: note } : {}),
      decidedByUserId: actor.userId ?? null,
      decidedByLabel: actor.label,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(articleIntegritySignals.id, signalId))
    .returning();
  await writeAudit({
    action: 'update',
    entityType: AUDIT_ENTITY,
    entityId: signalId,
    changes: after ? diffRows(before, after) : null,
    summary: `${status} ${before.kind} signal on article ${before.articleId}`,
    actor,
  });
  return { id: signalId };
}

/**
 * Re-attach signals to their article by IDENTITY (source + feed guid) — after a
 * full re-cluster recreated the article rows, the moderator decisions find their
 * article again (hygiene 3). Idempotent; runs in every ingest.
 */
export async function relinkIntegrityByIdentity(): Promise<void> {
  await db.execute(sql`
    UPDATE article_integrity_signals AS s
    SET article_id = a.id, updated_at = now()
    FROM articles AS a
    WHERE s.article_id IS NULL
      AND s.external_guid IS NOT NULL
      AND a.external_guid = s.external_guid
      AND (s.source_id IS NULL OR a.source_id IS NULL OR a.source_id = s.source_id)
  `);
}

// ── admin list ───────────────────────────────────────────────────────────────

export interface AdminIntegrityReview {
  articleId: string;
  title: string;
  sourceName: string | null;
  url: string | null;
  publishDate: string | null;
  signals: {
    id: string;
    kind: IntegritySignalKind;
    origin: string;
    status: IntegritySignalStatus;
    evidenceSnippet: string | null;
    editorNote: string | null;
    evidenceDate: string | null;
    decidedByLabel: string | null;
    decidedAt: string | null;
  }[];
}

/** Review articles (newest first) with every signal row, for the moderation screen. */
export async function listReviewIntegrity(limit = 200): Promise<AdminIntegrityReview[]> {
  const reviewRows = await db
    .select({
      id: articles.id,
      title: articles.title,
      url: articles.url,
      publishDate: articles.publishDate,
      sourceName: sources.name,
    })
    .from(articles)
    .leftJoin(sources, eq(sources.id, articles.sourceId))
    .where(eq(articles.articleType, 'review'))
    .orderBy(desc(articles.publishDate))
    .limit(Math.min(Math.max(limit, 1), 500));
  const ids = reviewRows.map((r) => r.id);
  const signalRows =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(articleIntegritySignals)
          .where(inArray(articleIntegritySignals.articleId, ids));
  const byArticle = new Map<string, AdminIntegrityReview['signals']>();
  for (const s of signalRows) {
    if (!s.articleId) continue;
    const list = byArticle.get(s.articleId) ?? [];
    list.push({
      id: s.id,
      kind: s.kind,
      origin: s.origin,
      status: s.status,
      evidenceSnippet: s.evidenceSnippet,
      editorNote: s.editorNote,
      evidenceDate: s.evidenceDate ? s.evidenceDate.toISOString() : null,
      decidedByLabel: s.decidedByLabel,
      decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null,
    });
    byArticle.set(s.articleId, list);
  }
  return reviewRows.map((r) => ({
    articleId: r.id,
    title: r.title,
    sourceName: r.sourceName,
    url: r.url,
    publishDate: r.publishDate ? r.publishDate.toISOString() : null,
    signals: byArticle.get(r.id) ?? [],
  }));
}
