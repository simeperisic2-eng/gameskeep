import { and, eq, sql } from 'drizzle-orm';
import { isDemo } from '../config/env';
import { db } from '../db/client';
import { appSettings, gameCommunityNotes, games, subjects, users } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';
import { polishText } from '../ai/client';
import { rulesSettings } from '../rules/settings';
import {
  countSentences,
  validatePolish,
  wordDiff,
  type DiffOp,
  type PolishVerdict,
} from './polish-validator';

/**
 * "What the community says" (Phase P S5) — an EDITOR's note on a game page:
 * 2–3 sentences (admin rule), at least one source link (a fixed rule: facts
 * carry a source + link), an as-of date and the editor's name.
 *
 * "Polish with AI" rewrites the editor's text only; the no-new-claims validator
 * checks the rewrite against the original and the editor sees the diff. A
 * rejected rewrite can never be accepted — the editor can still edit and
 * publish by hand. Nothing is public until an editor (moderator+) publishes.
 * Every step is audited with both texts. An approved note is editorial content:
 * it carries no AI label.
 */
export class NoteError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface NoteSource {
  url: string;
  label?: string;
}
export interface AdminNote {
  game: { id: string; slug: string; name: string };
  status: 'draft' | 'published';
  text: string;
  sources: NoteSource[];
  asOf: string | null;
  editor: string | null;
  publishedAt: string | null;
  /** The live copy (null when nothing is published). */
  published: { text: string; sources: NoteSource[]; asOf: string | null } | null;
  polish: {
    original: string;
    candidate: string;
    ok: boolean;
    issues: { kind: string; token: string }[];
    provider: string | null;
    at: string | null;
    diff: DiffOp[];
  } | null;
}

const today = (): string => new Date().toISOString().slice(0, 10);

async function gameBySlug(slug: string): Promise<{ id: string; slug: string; name: string }> {
  const [g] = await db
    .select({ id: games.id, slug: subjects.slug, name: subjects.name })
    .from(games)
    .innerJoin(subjects, eq(subjects.id, games.subjectId))
    .where(eq(subjects.slug, slug))
    .limit(1);
  if (!g) throw new NoteError(404, `No game "${slug}".`);
  return g;
}

async function rowOf(gameId: string) {
  const [r] = await db
    .select()
    .from(gameCommunityNotes)
    .where(eq(gameCommunityNotes.gameId, gameId))
    .limit(1);
  return r ?? null;
}

function shape(game: AdminNote['game'], r: Awaited<ReturnType<typeof rowOf>>): AdminNote {
  return {
    game,
    status: r?.status === 'published' ? 'published' : 'draft',
    text: r?.text ?? '',
    sources: (r?.sources ?? []).filter((s) => s && typeof s.url === 'string'),
    asOf: r?.asOf ?? null,
    editor: r?.editorLabel ?? null,
    publishedAt: r?.publishedAt ? r.publishedAt.toISOString() : null,
    published:
      r?.status === 'published' && r.publishedText
        ? {
            text: r.publishedText,
            sources: r.publishedSources ?? [],
            asOf: r.publishedAsOf ?? null,
          }
        : null,
    polish:
      r?.polishCandidate != null && r.polishOriginal != null
        ? {
            original: r.polishOriginal,
            candidate: r.polishCandidate,
            ok: Boolean(r.polishOk),
            issues: r.polishIssues ?? [],
            provider: r.polishProvider ?? null,
            at: r.polishedAt ? r.polishedAt.toISOString() : null,
            diff: wordDiff(r.polishOriginal, r.polishCandidate),
          }
        : null,
  };
}

export async function getNote(slug: string): Promise<AdminNote> {
  const game = await gameBySlug(slug);
  return shape(game, await rowOf(game.id));
}

/** The admin list: every game with a note, plus its state. */
export async function listNotes(): Promise<
  { slug: string; name: string; status: string; updatedAt: string; editor: string | null }[]
> {
  const rows = await db
    .select({
      slug: subjects.slug,
      name: subjects.name,
      status: gameCommunityNotes.status,
      updatedAt: gameCommunityNotes.updatedAt,
      editor: gameCommunityNotes.editorLabel,
    })
    .from(gameCommunityNotes)
    .innerJoin(games, eq(games.id, gameCommunityNotes.gameId))
    .innerJoin(subjects, eq(subjects.id, games.subjectId))
    .orderBy(sql`${gameCommunityNotes.updatedAt} DESC`);
  return rows.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() }));
}

async function upsert(gameId: string, patch: Partial<typeof gameCommunityNotes.$inferInsert>) {
  await db
    .insert(gameCommunityNotes)
    .values({ gameId, ...patch })
    .onConflictDoUpdate({
      target: gameCommunityNotes.gameId,
      set: { ...patch, updatedAt: new Date() },
    });
}

/** Save a draft (text, sources, as-of). Never public by itself. */
export async function saveDraft(
  slug: string,
  input: { text: string; sources: NoteSource[]; asOf?: string | null },
  actor: AuditActor,
): Promise<AdminNote> {
  const game = await gameBySlug(slug);
  const before = await rowOf(game.id);
  const text = input.text.replace(/\s+/gu, ' ').trim();
  await upsert(game.id, { text, sources: input.sources, asOf: input.asOf ?? before?.asOf ?? null });
  await writeAudit({
    action: before ? 'update' : 'create',
    entityType: 'community-note',
    entityId: game.id,
    changes: {
      text: { from: before?.text ?? null, to: text },
      sources: { from: before?.sources ?? null, to: input.sources },
    },
    summary: `community note draft: ${game.name}`,
    actor,
  });
  return getNote(slug);
}

/**
 * Polish: the AI rewrites the editor's text (or `candidate` — a rewrite made
 * elsewhere — is checked instead). The validator's verdict + both texts are
 * stored and audited; nothing changes the note until the editor accepts.
 */
export async function polishNote(
  slug: string,
  input: { text: string; candidate?: string },
  actor: AuditActor,
): Promise<AdminNote & { verdict: PolishVerdict }> {
  const game = await gameBySlug(slug);
  const original = input.text.replace(/\s+/gu, ' ').trim();
  let candidate = input.candidate?.trim();
  let provider = 'pasted';
  if (!candidate) {
    try {
      const out = await polishText(original);
      candidate = out.text.trim();
      provider = out.model;
    } catch {
      throw new NoteError(
        503,
        'The AI service is unavailable — edit the text by hand, or try again.',
      );
    }
  }
  if (!candidate) throw new NoteError(422, 'The polish came back empty.');
  const verdict = validatePolish(original, candidate);
  await upsert(game.id, {
    polishOriginal: original,
    polishCandidate: candidate,
    polishOk: verdict.ok,
    polishIssues: verdict.issues,
    polishProvider: provider,
    polishedAt: new Date(),
  });
  await writeAudit({
    action: 'update',
    entityType: 'community-note',
    entityId: game.id,
    changes: {
      polish: { original, candidate, ok: verdict.ok, issues: verdict.issues, provider },
    },
    summary: `community note polish ${verdict.ok ? 'passed' : 'REJECTED'}: ${game.name}`,
    actor,
  });
  return { ...(await getNote(slug)), verdict };
}

/** Accept a polish that passed the validator → it becomes the draft text. */
export async function acceptPolish(slug: string, actor: AuditActor): Promise<AdminNote> {
  const game = await gameBySlug(slug);
  const r = await rowOf(game.id);
  if (!r?.polishCandidate || r.polishOriginal == null)
    throw new NoteError(409, 'No polish waiting.');
  // Re-check (a stored verdict is never trusted on its own).
  const verdict = validatePolish(r.polishOriginal, r.polishCandidate);
  if (!verdict.ok) {
    throw new NoteError(
      422,
      'This rewrite adds claims that are not in your text (see the list) — it cannot be used. Edit and publish by hand instead.',
    );
  }
  await db
    .update(gameCommunityNotes)
    .set({
      text: r.polishCandidate,
      polishOriginal: null,
      polishCandidate: null,
      polishOk: null,
      polishIssues: null,
      updatedAt: new Date(),
    })
    .where(eq(gameCommunityNotes.gameId, game.id));
  await writeAudit({
    action: 'update',
    entityType: 'community-note',
    entityId: game.id,
    changes: { text: { from: r.text, to: r.polishCandidate }, acceptedPolish: true },
    summary: `community note polish accepted: ${game.name}`,
    actor,
  });
  return getNote(slug);
}

export async function discardPolish(slug: string, actor: AuditActor): Promise<AdminNote> {
  const game = await gameBySlug(slug);
  await db
    .update(gameCommunityNotes)
    .set({ polishOriginal: null, polishCandidate: null, polishOk: null, polishIssues: null })
    .where(eq(gameCommunityNotes.gameId, game.id));
  await writeAudit({
    action: 'update',
    entityType: 'community-note',
    entityId: game.id,
    changes: { polishDiscarded: true },
    summary: `community note polish discarded: ${game.name}`,
    actor,
  });
  return getNote(slug);
}

/** Why this note cannot be published (empty = it can). Pure-ish; the rules come in. */
export function publishProblems(
  note: { text: string; sources: NoteSource[]; asOf?: string | null },
  rules: { minSentences: number; maxSentences: number; maxChars: number },
): string[] {
  const out: string[] = [];
  const text = note.text.trim();
  if (!text) out.push('The note is empty.');
  // Fixed rule (facts carry a source + link): no link, no note.
  if (!note.sources.some((s) => /^https?:\/\//iu.test(s.url))) {
    out.push('Add at least one source link.');
  }
  const n = countSentences(text);
  if (text && (n < rules.minSentences || n > rules.maxSentences)) {
    out.push(
      `Write ${rules.minSentences === rules.maxSentences ? rules.minSentences : `${rules.minSentences}–${rules.maxSentences}`} sentences (now ${n}).`,
    );
  }
  if (text.length > rules.maxChars) out.push(`Keep it under ${rules.maxChars} characters.`);
  if (note.asOf && note.asOf > today()) out.push('The as-of date cannot be in the future.');
  return out;
}

export async function publishNote(slug: string, actor: AuditActor): Promise<AdminNote> {
  const game = await gameBySlug(slug);
  const r = await rowOf(game.id);
  if (!r) throw new NoteError(409, 'Save the note first.');
  const rules = (await rulesSettings()).communityNote;
  const problems = publishProblems({ text: r.text, sources: r.sources ?? [], asOf: r.asOf }, rules);
  if (problems.length) throw new NoteError(400, problems.join(' '));
  // The editor's public name: the staff display name, else the sign-in name.
  let editorLabel = actor.label.slice(0, 120);
  if (actor.userId) {
    const [u] = await db
      .select({ displayName: users.displayName, username: users.username })
      .from(users)
      .where(eq(users.id, actor.userId))
      .limit(1);
    editorLabel = (u?.displayName || u?.username || editorLabel).slice(0, 120);
  }
  await db
    .update(gameCommunityNotes)
    .set({
      status: 'published',
      asOf: r.asOf ?? today(),
      // The snapshot readers see — a later draft edit never changes it.
      publishedText: r.text,
      publishedSources: r.sources ?? [],
      publishedAsOf: r.asOf ?? today(),
      editorUserId: actor.userId ?? null,
      editorLabel,
      publishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(gameCommunityNotes.gameId, game.id));
  await writeAudit({
    action: 'update',
    entityType: 'community-note',
    entityId: game.id,
    changes: { status: { from: r.status, to: 'published' }, text: r.text, sources: r.sources },
    summary: `community note published: ${game.name}`,
    actor,
  });
  return getNote(slug);
}

export async function unpublishNote(slug: string, actor: AuditActor): Promise<AdminNote> {
  const game = await gameBySlug(slug);
  const r = await rowOf(game.id);
  if (!r || r.status !== 'published') throw new NoteError(409, 'The note is not published.');
  await db
    .update(gameCommunityNotes)
    .set({
      status: 'draft',
      publishedText: null,
      publishedSources: null,
      publishedAsOf: null,
      updatedAt: new Date(),
    })
    .where(eq(gameCommunityNotes.gameId, game.id));
  await writeAudit({
    action: 'update',
    entityType: 'community-note',
    entityId: game.id,
    changes: { status: { from: 'published', to: 'draft' } },
    summary: `community note unpublished: ${game.name}`,
    actor,
  });
  return getNote(slug);
}

export interface PublicCommunityNote {
  text: string;
  sources: NoteSource[];
  asOf: string | null;
  editor: string | null;
}

/** PUBLIC: the published note only. */
export async function publicCommunityNote(gameId: string): Promise<PublicCommunityNote | null> {
  const [r] = await db
    .select({
      text: gameCommunityNotes.publishedText,
      sources: gameCommunityNotes.publishedSources,
      asOf: gameCommunityNotes.publishedAsOf,
      editor: gameCommunityNotes.editorLabel,
    })
    .from(gameCommunityNotes)
    .where(and(eq(gameCommunityNotes.gameId, gameId), eq(gameCommunityNotes.status, 'published')))
    .limit(1);
  if (!r?.text || !r.text.trim()) return null;
  const sources = (r.sources ?? []).filter(
    (s) => s && typeof s.url === 'string' && /^https?:\/\//iu.test(s.url),
  );
  if (sources.length === 0) return null; // the fixed rule holds at read time too
  return { text: r.text, sources, asOf: r.asOf ?? null, editor: r.editor ?? null };
}

const DEMO_NOTE_MARKER = 'community-notes-seeded';

/**
 * Demo only: one MOCK editor note (Baldur's Gate 3) so the demo shows the block.
 * Seeded once (marker) — an editor's deletion sticks. Invented text; the links
 * go to real public community hubs.
 */
export async function seedDemoCommunityNote(): Promise<boolean> {
  if (!isDemo()) return false;
  const [marker] = await db
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, DEMO_NOTE_MARKER))
    .limit(1);
  if (marker) return false;
  const [g] = await db
    .select({ id: games.id })
    .from(games)
    .innerJoin(subjects, eq(subjects.id, games.subjectId))
    .where(eq(subjects.slug, 'baldurs-gate-3'))
    .limit(1);
  if (!g) return false; // the game arrives with the catalog — try again next boot
  const text =
    'Players on the official forums and Reddit mostly praise the latest patch for fixing crashes in the final act. Performance on Steam Deck remains the most common complaint.';
  const sources = [
    { url: 'https://www.reddit.com/r/BaldursGate3/', label: 'r/BaldursGate3' },
    { url: 'https://forums.larian.com/', label: 'Larian forums' },
  ];
  await db
    .insert(gameCommunityNotes)
    .values({
      gameId: g.id,
      status: 'published',
      text,
      sources,
      asOf: today(),
      publishedText: text,
      publishedSources: sources,
      publishedAsOf: today(),
      editorLabel: 'GamesKeep Editorial (demo)',
      publishedAt: new Date(),
    })
    .onConflictDoNothing();
  await db
    .insert(appSettings)
    .values({ key: DEMO_NOTE_MARKER, value: { at: new Date().toISOString() } })
    .onConflictDoNothing();
  return true;
}
