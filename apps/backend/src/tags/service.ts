import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  PAY_TO_WIN_TAG_SLUG,
  TAG_SEED,
  type GameTagSource,
  type GameTagState,
  type TagFamily,
} from '@gameskeep/shared/constants';
import type { TagSuggestionDecision } from '@gameskeep/shared/validation';
import { db } from '../db/client';
import {
  gameContentFlags,
  gameTags,
  gameTagVotes,
  games,
  subjects,
  tagSuggestions,
  tags,
  users,
} from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';
import { getRatingSettings } from '../ratings/rating-settings';
import { voterCredibility } from '../community/weighting';
import {
  detectTagSpike,
  issueStatus,
  matchTag,
  normalizeTagName,
  provenanceLine,
  tagScore,
  thresholdReached,
  type IssueStatus,
} from './rules';
import { tagSettings, type TagSettings } from './settings';

/**
 * Tags (Phase P S3): votes → a credibility-weighted score → the moderation queue
 * → editor confirmation → public. Editors can also publish directly. Every
 * staff action is audited; reader votes are not (like ratings), suggestions are
 * (like the public game suggestion). Reads for pages are light single queries.
 */
export class TagError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface TagActor {
  id: string;
}

// ── lookups ──────────────────────────────────────────────────────────────────
async function gameBySlug(slug: string): Promise<{ id: string; slug: string; name: string }> {
  const [g] = await db
    .select({ id: games.id, slug: subjects.slug, name: subjects.name })
    .from(games)
    .innerJoin(subjects, and(eq(subjects.id, games.subjectId), eq(subjects.type, 'game')))
    .where(eq(subjects.slug, slug))
    .limit(1);
  if (!g) throw new TagError(404, `No game "${slug}".`);
  return g;
}

async function activeTagBySlug(
  slug: string,
): Promise<{ id: string; slug: string; name: string; family: TagFamily }> {
  const [t] = await db
    .select({ id: tags.id, slug: tags.slug, name: tags.name, family: tags.family })
    .from(tags)
    .where(and(eq(tags.slug, slug), eq(tags.active, true)))
    .limit(1);
  if (!t) throw new TagError(404, `No tag "${slug}".`);
  return t;
}

async function taxonomy(): Promise<
  {
    id: string;
    slug: string;
    name: string;
    family: TagFamily;
    aliases: string[];
    active: boolean;
  }[]
> {
  return db
    .select({
      id: tags.id,
      slug: tags.slug,
      name: tags.name,
      family: tags.family,
      aliases: tags.aliases,
      active: tags.active,
    })
    .from(tags)
    .orderBy(asc(tags.sort), asc(tags.name));
}

// ── scoring ──────────────────────────────────────────────────────────────────
/** Re-score one game↔tag from its votes (credibility read live) + the spike flag. */
export async function recomputeGameTag(
  gameId: string,
  tagId: string,
  ctx?: { settings: TagSettings; weights: Parameters<typeof voterCredibility>[1] },
): Promise<void> {
  const settings = ctx?.settings ?? (await tagSettings());
  const weights = ctx?.weights ?? (await getRatingSettings()).credibility;
  const rows = await db
    .select({
      createdAt: gameTagVotes.createdAt,
      isEmailVerified: users.isEmailVerified,
      reputation: users.reputation,
      userCreatedAt: users.createdAt,
    })
    .from(gameTagVotes)
    .innerJoin(users, eq(users.id, gameTagVotes.userId))
    .where(and(eq(gameTagVotes.gameId, gameId), eq(gameTagVotes.tagId, tagId)));
  const now = Date.now();
  const votes = rows.map((r) => ({
    createdAt: r.createdAt,
    credibility: voterCredibility(
      { isEmailVerified: r.isEmailVerified, reputation: r.reputation, createdAt: r.userCreatedAt },
      weights,
      now,
    ),
  }));
  const spike = detectTagSpike(votes, settings, now);
  const lastVote = votes.reduce<Date | null>(
    (m, v) => (!m || v.createdAt > m ? v.createdAt : m),
    null,
  );
  await db
    .update(gameTags)
    .set({
      weightedScore: tagScore(votes, settings.minCredibility),
      voteCount: votes.length,
      lastVoteAt: lastVote,
      flagged: spike.flagged,
      flagInfo: spike.flagged || spike.windowCount > 0 ? spike : null,
    })
    .where(and(eq(gameTags.gameId, gameId), eq(gameTags.tagId, tagId)));
}

/** Re-score every voted game↔tag (after a reputation recompute moves credibility). */
export async function recomputeAllTagScores(): Promise<number> {
  const pairs = await db
    .selectDistinct({ gameId: gameTagVotes.gameId, tagId: gameTagVotes.tagId })
    .from(gameTagVotes);
  const ctx = { settings: await tagSettings(), weights: (await getRatingSettings()).credibility };
  for (const p of pairs) await recomputeGameTag(p.gameId, p.tagId, ctx);
  return pairs.length;
}

// ── reader actions (community scope: CSRF + verified + per-user limit) ──────
export async function voteTag(
  actor: TagActor,
  gameSlug: string,
  tagSlug: string,
): Promise<{ voted: true }> {
  const game = await gameBySlug(gameSlug);
  const tag = await activeTagBySlug(tagSlug);
  await db
    .insert(gameTagVotes)
    .values({ userId: actor.id, gameId: game.id, tagId: tag.id })
    .onConflictDoNothing();
  // A first report opens a PENDING instance (the queue); an existing one — any
  // state, including an editor's removal (a tombstone) — is left as it is.
  await db
    .insert(gameTags)
    .values({ gameId: game.id, tagId: tag.id, state: 'pending', source: 'players' })
    .onConflictDoNothing();
  await recomputeGameTag(game.id, tag.id);
  return { voted: true };
}

export async function withdrawTagVote(
  actor: TagActor,
  gameSlug: string,
  tagSlug: string,
): Promise<{ voted: false }> {
  const game = await gameBySlug(gameSlug);
  const tag = await activeTagBySlug(tagSlug);
  await db
    .delete(gameTagVotes)
    .where(
      and(
        eq(gameTagVotes.userId, actor.id),
        eq(gameTagVotes.gameId, game.id),
        eq(gameTagVotes.tagId, tag.id),
      ),
    );
  await recomputeGameTag(game.id, tag.id);
  return { voted: false };
}

/** The taxonomy a reader can vote on + which of it they voted for this game. */
export async function readerTagState(
  userId: string,
  gameSlug: string,
): Promise<{ tags: { slug: string; name: string; family: TagFamily }[]; mine: string[] }> {
  const game = await gameBySlug(gameSlug);
  const all = (await taxonomy()).filter((t) => t.active);
  const mine = userId
    ? await db
        .select({ slug: tags.slug })
        .from(gameTagVotes)
        .innerJoin(tags, eq(tags.id, gameTagVotes.tagId))
        .where(and(eq(gameTagVotes.userId, userId), eq(gameTagVotes.gameId, game.id)))
    : [];
  return {
    tags: all.map((t) => ({ slug: t.slug, name: t.name, family: t.family })),
    mine: mine.map((m) => m.slug),
  };
}

/** A new tag NAME → the suggestion queue (never live). A known name → vote instead. */
export async function suggestTag(
  actor: TagActor,
  gameSlug: string,
  name: string,
): Promise<{ status: 'queued' } | { status: 'exists'; tagSlug: string }> {
  const game = await gameBySlug(gameSlug);
  const known = matchTag(name, await taxonomy());
  if (known) return { status: 'exists', tagSlug: known.slug };
  const normalized = normalizeTagName(name);
  if (!normalized) throw new TagError(400, 'That name has no letters or digits.');
  const [pending] = await db
    .select({ id: tagSuggestions.id, attempts: tagSuggestions.attempts })
    .from(tagSuggestions)
    .where(
      and(
        eq(tagSuggestions.status, 'pending'),
        eq(tagSuggestions.normalized, normalized),
        eq(tagSuggestions.gameId, game.id),
      ),
    )
    .limit(1);
  if (pending) {
    await db
      .update(tagSuggestions)
      .set({ attempts: Math.min(32_000, pending.attempts + 1) })
      .where(eq(tagSuggestions.id, pending.id));
    return { status: 'queued' };
  }
  const [row] = await db
    .insert(tagSuggestions)
    .values({
      rawName: name.slice(0, 120),
      normalized,
      gameId: game.id,
      source: 'user',
      userId: actor.id,
    })
    .returning({ id: tagSuggestions.id });
  await writeAudit({
    action: 'create',
    entityType: 'tag-suggestion',
    entityId: row!.id,
    changes: { created: { name, game: gameSlug } },
    summary: `reader suggested tag "${name}" for ${gameSlug} (pending review)`,
    actor: { label: 'public: tag-suggestion', userId: actor.id },
  });
  return { status: 'queued' };
}

// ── public reads ─────────────────────────────────────────────────────────────
export interface PublicTag {
  slug: string;
  name: string;
  family: TagFamily;
  /** "Unusual voting activity" — only when the admin switch is on (default off). */
  unusual: boolean;
}
export interface PublicIssueTag extends PublicTag {
  status: IssueStatus;
  /** The truthful provenance line (issue tags only). */
  provenance: string | null;
  firstSeen: string;
  lastConfirmed: string | null;
  resolvedAt: string | null;
  patchRef: string | null;
  /** "Past issue" range: first seen → the last fresh signal. */
  pastUntil: string | null;
}
export interface GameTagGroups {
  content: PublicTag[];
  issues: PublicIssueTag[];
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const ISSUE_ORDER: Record<IssueStatus, number> = { active: 0, past: 1, resolved: 2 };

/** Published tags of a set of games, grouped Content / Issues (public shape). */
export async function publicTagGroups(gameIds: string[]): Promise<Map<string, GameTagGroups>> {
  const out = new Map<string, GameTagGroups>();
  if (gameIds.length === 0) return out;
  const settings = await tagSettings();
  const rows = await db
    .select({
      gameId: gameTags.gameId,
      source: gameTags.source,
      flagged: gameTags.flagged,
      firstSeenAt: gameTags.firstSeenAt,
      lastVoteAt: gameTags.lastVoteAt,
      lastConfirmedAt: gameTags.lastConfirmedAt,
      resolvedAt: gameTags.resolvedAt,
      patchRef: gameTags.patchRef,
      slug: tags.slug,
      name: tags.name,
      family: tags.family,
      sort: tags.sort,
    })
    .from(gameTags)
    .innerJoin(tags, eq(tags.id, gameTags.tagId))
    .where(
      and(
        inArray(gameTags.gameId, gameIds),
        eq(gameTags.state, 'published'),
        eq(tags.active, true),
      ),
    )
    .orderBy(asc(tags.sort), asc(tags.name));
  const now = Date.now();
  for (const r of rows) {
    const g = out.get(r.gameId) ?? { content: [], issues: [] };
    const base: PublicTag = {
      slug: r.slug,
      name: r.name,
      family: r.family,
      unusual: settings.showAnomalyLabel && r.flagged,
    };
    if (r.family === 'content') {
      g.content.push(base);
    } else {
      const status = issueStatus(r, settings.issueExpiryDays, now);
      const fresh = new Date(
        Math.max(
          r.firstSeenAt.getTime(),
          r.lastVoteAt?.getTime() ?? 0,
          r.lastConfirmedAt?.getTime() ?? 0,
        ),
      );
      g.issues.push({
        ...base,
        status,
        provenance: provenanceLine(r.family, r.source),
        firstSeen: r.firstSeenAt.toISOString(),
        lastConfirmed: iso(r.lastConfirmedAt),
        resolvedAt: iso(r.resolvedAt),
        patchRef: status === 'resolved' ? r.patchRef : null,
        pastUntil: status === 'past' ? fresh.toISOString() : null,
      });
    }
    out.set(r.gameId, g);
  }
  for (const g of out.values()) {
    g.issues.sort((a, b) => ISSUE_ORDER[a.status] - ISSUE_ORDER[b.status]);
  }
  return out;
}

export interface CardTag {
  family: TagFamily;
  slug: string;
  name: string;
}

/**
 * The tags a CARD shows: the configured families in order, then the count. Only
 * CURRENT issues (active) appear on cards — a past or resolved issue lives on the
 * game page with its dates, not as a card warning.
 */
export function cardTags(
  groups: GameTagGroups | undefined,
  families: readonly string[],
  count: number,
): CardTag[] {
  if (!groups || count <= 0) return [];
  const out: CardTag[] = [];
  for (const fam of families) {
    const list =
      fam === 'content'
        ? groups.content
        : fam === 'issue'
          ? groups.issues.filter((i) => i.status === 'active')
          : [];
    for (const t of list) out.push({ family: t.family, slug: t.slug, name: t.name });
  }
  return out.slice(0, count);
}

/** Published-tag slugs per game id (the homepage section rules' `tags` dimension). */
export async function publishedTagSlugsByGame(): Promise<Map<string, string[]>> {
  const rows = await db
    .select({ gameId: gameTags.gameId, slug: tags.slug })
    .from(gameTags)
    .innerJoin(tags, eq(tags.id, gameTags.tagId))
    .where(and(eq(gameTags.state, 'published'), eq(tags.active, true)));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.gameId, [...(out.get(r.gameId) ?? []), r.slug]);
  return out;
}

export interface TagFacet {
  slug: string;
  name: string;
  family: TagFamily;
  count: number;
}

/** Active tags with ≥1 published game, with their game counts (catalog facets). */
export async function tagFacets(): Promise<TagFacet[]> {
  const rows = await db
    .select({
      slug: tags.slug,
      name: tags.name,
      family: tags.family,
      sort: tags.sort,
      count: sql<number>`count(*)::int`,
    })
    .from(gameTags)
    .innerJoin(tags, eq(tags.id, gameTags.tagId))
    .where(and(eq(gameTags.state, 'published'), eq(tags.active, true)))
    .groupBy(tags.slug, tags.name, tags.family, tags.sort)
    .orderBy(asc(tags.family), asc(tags.sort), asc(tags.name));
  return rows.map((r) => ({ slug: r.slug, name: r.name, family: r.family, count: r.count }));
}

/** Game slugs carrying each published tag (catalog include / exclude). */
export async function gameSlugsByTag(tagSlugs: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>(tagSlugs.map((s) => [s, new Set<string>()]));
  if (tagSlugs.length === 0) return out;
  const rows = await db
    .select({ tag: tags.slug, game: subjects.slug })
    .from(gameTags)
    .innerJoin(tags, eq(tags.id, gameTags.tagId))
    .innerJoin(games, eq(games.id, gameTags.gameId))
    .innerJoin(subjects, eq(subjects.id, games.subjectId))
    .where(
      and(eq(gameTags.state, 'published'), eq(tags.active, true), inArray(tags.slug, tagSlugs)),
    );
  for (const r of rows) out.get(r.tag)?.add(r.game);
  return out;
}

/** Tag identity for its public page (active only). */
export async function publicTag(
  slug: string,
): Promise<{ slug: string; name: string; family: TagFamily; intro: string | null } | null> {
  const [t] = await db
    .select({ slug: tags.slug, name: tags.name, family: tags.family, intro: tags.intro })
    .from(tags)
    .where(and(eq(tags.slug, slug), eq(tags.active, true)))
    .limit(1);
  return t ?? null;
}

/** Indexable tag pages (≥ indexMinGames published games) for the sitemap. */
export async function sitemapTags(): Promise<{ slug: string; lastModified: string | null }[]> {
  const { indexMinGames } = await tagSettings();
  const rows = await db
    .select({
      slug: tags.slug,
      count: sql<number>`count(*)::int`,
      lastmod: sql<Date | null>`max(${gameTags.updatedAt})`,
    })
    .from(gameTags)
    .innerJoin(tags, eq(tags.id, gameTags.tagId))
    .where(and(eq(gameTags.state, 'published'), eq(tags.active, true)))
    .groupBy(tags.slug);
  return rows
    .filter((r) => r.count >= indexMinGames)
    .map((r) => ({
      slug: r.slug,
      lastModified: r.lastmod ? new Date(r.lastmod as unknown as string).toISOString() : null,
    }));
}

// ── moderation (editors = moderator rank and up) ─────────────────────────────
export interface QueueRow {
  id: string;
  game: { slug: string; name: string };
  tag: { slug: string; name: string; family: TagFamily };
  state: GameTagState;
  source: GameTagSource;
  weightedScore: number;
  voteCount: number;
  thresholdReached: boolean;
  /** The anomaly flag — ALWAYS shown to editors (owner, S3 (b)). */
  flagged: boolean;
  flagInfo: unknown;
  firstSeenAt: string;
  lastVoteAt: string | null;
  lastConfirmedAt: string | null;
  confirmedBy: string | null;
  resolvedAt: string | null;
  patchRef: string | null;
  issueStatus: IssueStatus | null;
}
export interface SuggestionRow {
  id: string;
  rawName: string;
  normalized: string;
  source: 'import' | 'user';
  game: { slug: string; name: string } | null;
  attempts: number;
  createdAt: string;
}

export async function moderationQueue(): Promise<{
  threshold: number;
  pending: QueueRow[];
  published: QueueRow[];
  suggestions: SuggestionRow[];
}> {
  const settings = await tagSettings();
  const rows = await db
    .select({
      id: gameTags.id,
      gameSlug: subjects.slug,
      gameName: subjects.name,
      tagSlug: tags.slug,
      tagName: tags.name,
      family: tags.family,
      state: gameTags.state,
      source: gameTags.source,
      weightedScore: gameTags.weightedScore,
      voteCount: gameTags.voteCount,
      flagged: gameTags.flagged,
      flagInfo: gameTags.flagInfo,
      firstSeenAt: gameTags.firstSeenAt,
      lastVoteAt: gameTags.lastVoteAt,
      lastConfirmedAt: gameTags.lastConfirmedAt,
      confirmedBy: gameTags.confirmedByLabel,
      resolvedAt: gameTags.resolvedAt,
      patchRef: gameTags.patchRef,
    })
    .from(gameTags)
    .innerJoin(tags, eq(tags.id, gameTags.tagId))
    .innerJoin(games, eq(games.id, gameTags.gameId))
    .innerJoin(subjects, eq(subjects.id, games.subjectId))
    .where(
      sql`${gameTags.state} = 'pending' OR (${gameTags.state} = 'published' AND ${tags.family} = 'issue')`,
    )
    .orderBy(desc(gameTags.flagged), desc(gameTags.weightedScore), desc(gameTags.firstSeenAt));
  const now = Date.now();
  const shape = (r: (typeof rows)[number]): QueueRow => ({
    id: r.id,
    game: { slug: r.gameSlug, name: r.gameName },
    tag: { slug: r.tagSlug, name: r.tagName, family: r.family },
    state: r.state,
    source: r.source,
    weightedScore: r.weightedScore,
    voteCount: r.voteCount,
    thresholdReached: thresholdReached(r.weightedScore, settings.publishThreshold),
    flagged: r.flagged,
    flagInfo: r.flagInfo,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastVoteAt: iso(r.lastVoteAt),
    lastConfirmedAt: iso(r.lastConfirmedAt),
    confirmedBy: r.confirmedBy,
    resolvedAt: iso(r.resolvedAt),
    patchRef: r.patchRef,
    issueStatus: r.family === 'issue' ? issueStatus(r, settings.issueExpiryDays, now) : null,
  });
  const sugg = await db
    .select({
      id: tagSuggestions.id,
      rawName: tagSuggestions.rawName,
      normalized: tagSuggestions.normalized,
      source: tagSuggestions.source,
      attempts: tagSuggestions.attempts,
      createdAt: tagSuggestions.createdAt,
      gameSlug: subjects.slug,
      gameName: subjects.name,
    })
    .from(tagSuggestions)
    .leftJoin(games, eq(games.id, tagSuggestions.gameId))
    .leftJoin(subjects, eq(subjects.id, games.subjectId))
    .where(eq(tagSuggestions.status, 'pending'))
    .orderBy(desc(tagSuggestions.attempts), desc(tagSuggestions.createdAt));
  return {
    threshold: settings.publishThreshold,
    pending: rows.filter((r) => r.state === 'pending').map(shape),
    published: rows.filter((r) => r.state === 'published').map(shape),
    suggestions: sugg.map((s) => ({
      id: s.id,
      rawName: s.rawName,
      normalized: s.normalized,
      source: s.source,
      game: s.gameSlug && s.gameName ? { slug: s.gameSlug, name: s.gameName } : null,
      attempts: s.attempts,
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

async function instance(id: string): Promise<{
  id: string;
  state: GameTagState;
  source: GameTagSource;
  family: TagFamily;
  weightedScore: number;
  gameSlug: string;
  tagSlug: string;
  resolvedAt: Date | null;
  patchRef: string | null;
}> {
  const [r] = await db
    .select({
      id: gameTags.id,
      state: gameTags.state,
      source: gameTags.source,
      family: tags.family,
      weightedScore: gameTags.weightedScore,
      gameSlug: subjects.slug,
      tagSlug: tags.slug,
      resolvedAt: gameTags.resolvedAt,
      patchRef: gameTags.patchRef,
    })
    .from(gameTags)
    .innerJoin(tags, eq(tags.id, gameTags.tagId))
    .innerJoin(games, eq(games.id, gameTags.gameId))
    .innerJoin(subjects, eq(subjects.id, games.subjectId))
    .where(eq(gameTags.id, id))
    .limit(1);
  if (!r) throw new TagError(404, 'No such tag on a game.');
  return r;
}

async function audit(
  id: string,
  changes: Record<string, unknown>,
  summary: string,
  actor: AuditActor,
): Promise<void> {
  await writeAudit({
    action: 'update',
    entityType: 'game-tag',
    entityId: id,
    changes,
    summary,
    actor,
  });
}

/** Confirm a PLAYER-reported tag: only once its weighted score reached the threshold. */
export async function confirmGameTag(id: string, actor: AuditActor): Promise<void> {
  const t = await instance(id);
  if (t.state !== 'pending')
    throw new TagError(409, `Only a pending tag can be confirmed (it is ${t.state}).`);
  const { publishThreshold } = await tagSettings();
  if (!thresholdReached(t.weightedScore, publishThreshold)) {
    throw new TagError(
      409,
      `Below the threshold (${t.weightedScore} of ${publishThreshold}) — wait for more credible votes, or publish it as editors.`,
    );
  }
  const now = new Date();
  await db
    .update(gameTags)
    .set({
      state: 'published',
      source: 'players',
      lastConfirmedAt: now,
      confirmedByLabel: actor.label,
      confirmedByUserId: actor.userId ?? null,
    })
    .where(eq(gameTags.id, id));
  await audit(
    id,
    { state: { from: 'pending', to: 'published' } },
    `confirmed "${t.tagSlug}" on ${t.gameSlug} (score ${t.weightedScore} ≥ ${publishThreshold})`,
    actor,
  );
}

/** Publish a tag on a game directly — "Added by editors" (owner, S3 (c)). */
export async function publishDirect(
  input: { gameSlug: string; tagSlug: string },
  actor: AuditActor,
): Promise<{ id: string }> {
  const game = await gameBySlug(input.gameSlug);
  const tag = await activeTagBySlug(input.tagSlug);
  const now = new Date();
  const [existing] = await db
    .select({ id: gameTags.id, state: gameTags.state })
    .from(gameTags)
    .where(and(eq(gameTags.gameId, game.id), eq(gameTags.tagId, tag.id)))
    .limit(1);
  if (existing?.state === 'published') {
    throw new TagError(409, `"${tag.name}" is already public on ${game.name}.`);
  }
  let id: string;
  if (existing) {
    await db
      .update(gameTags)
      .set({
        state: 'published',
        source: 'editors',
        lastConfirmedAt: now,
        confirmedByLabel: actor.label,
        confirmedByUserId: actor.userId ?? null,
        resolvedAt: null,
        patchRef: null,
      })
      .where(eq(gameTags.id, existing.id));
    id = existing.id;
  } else {
    const [row] = await db
      .insert(gameTags)
      .values({
        gameId: game.id,
        tagId: tag.id,
        state: 'published',
        source: 'editors',
        firstSeenAt: now,
        lastConfirmedAt: now,
        confirmedByLabel: actor.label,
        confirmedByUserId: actor.userId ?? null,
      })
      .returning({ id: gameTags.id });
    id = row!.id;
  }
  await writeAudit({
    action: existing ? 'update' : 'create',
    entityType: 'game-tag',
    entityId: id,
    changes: {
      state: { from: existing?.state ?? null, to: 'published' },
      source: { to: 'editors' },
    },
    summary: `published "${tag.slug}" on ${game.slug} as editors`,
    actor,
  });
  return { id };
}

/** Reject a pending tag or REMOVE a published one — the row stays as a tombstone. */
export async function rejectGameTag(id: string, actor: AuditActor): Promise<void> {
  const t = await instance(id);
  if (t.state === 'rejected') return;
  await db.update(gameTags).set({ state: 'rejected' }).where(eq(gameTags.id, id));
  await audit(
    id,
    { state: { from: t.state, to: 'rejected' } },
    `${t.state === 'published' ? 'removed' : 'rejected'} "${t.tagSlug}" on ${t.gameSlug}`,
    actor,
  );
}

/** Put a removed/rejected tag back in the queue, or un-resolve an issue. */
export async function reopenGameTag(id: string, actor: AuditActor): Promise<void> {
  const t = await instance(id);
  if (t.state === 'rejected') {
    await db.update(gameTags).set({ state: 'pending' }).where(eq(gameTags.id, id));
    await audit(
      id,
      { state: { from: 'rejected', to: 'pending' } },
      `reopened "${t.tagSlug}" on ${t.gameSlug}`,
      actor,
    );
    return;
  }
  if (t.resolvedAt) {
    await db.update(gameTags).set({ resolvedAt: null, patchRef: null }).where(eq(gameTags.id, id));
    await audit(
      id,
      {
        resolvedAt: { from: iso(t.resolvedAt), to: null },
        patchRef: { from: t.patchRef, to: null },
      },
      `un-resolved "${t.tagSlug}" on ${t.gameSlug}`,
      actor,
    );
    return;
  }
  throw new TagError(409, 'Nothing to reopen.');
}

/** An editor re-confirms a published ISSUE (it is still happening). */
export async function reconfirmIssue(id: string, actor: AuditActor): Promise<void> {
  const t = await instance(id);
  if (t.state !== 'published' || t.family !== 'issue') {
    throw new TagError(409, 'Only a published issue tag can be re-confirmed.');
  }
  const now = new Date();
  await db
    .update(gameTags)
    .set({
      lastConfirmedAt: now,
      confirmedByLabel: actor.label,
      confirmedByUserId: actor.userId ?? null,
    })
    .where(eq(gameTags.id, id));
  await audit(
    id,
    { lastConfirmedAt: { to: now.toISOString() } },
    `re-confirmed "${t.tagSlug}" on ${t.gameSlug}`,
    actor,
  );
}

/** Resolve a published ISSUE with its patch / version reference. */
export async function resolveIssue(id: string, patchRef: string, actor: AuditActor): Promise<void> {
  const t = await instance(id);
  if (t.state !== 'published' || t.family !== 'issue') {
    throw new TagError(409, 'Only a published issue tag can be resolved.');
  }
  const now = new Date();
  await db.update(gameTags).set({ resolvedAt: now, patchRef }).where(eq(gameTags.id, id));
  await audit(
    id,
    {
      resolvedAt: { from: null, to: now.toISOString() },
      patchRef: { from: t.patchRef, to: patchRef },
    },
    `resolved "${t.tagSlug}" on ${t.gameSlug} in ${patchRef}`,
    actor,
  );
}

const titleCase = (s: string): string =>
  s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

/** Attach a tag to a suggestion's game: an import becomes public, a reader's goes to the queue. */
async function attachFromSuggestion(
  s: { gameId: string | null; source: 'import' | 'user' },
  tagId: string,
  actor: AuditActor,
): Promise<void> {
  if (!s.gameId) return;
  await db
    .insert(gameTags)
    .values(
      s.source === 'import'
        ? {
            gameId: s.gameId,
            tagId,
            state: 'published',
            source: 'import',
            confirmedByLabel: actor.label,
            confirmedByUserId: actor.userId ?? null,
          }
        : { gameId: s.gameId, tagId, state: 'pending', source: 'players' },
    )
    .onConflictDoNothing();
}

/** Decide a suggestion — accept (a new tag), merge (an alias), or reject. */
export async function decideSuggestion(
  id: string,
  decision: TagSuggestionDecision,
  actor: AuditActor,
): Promise<{ tagSlug: string | null; affected: number }> {
  const [s] = await db
    .select({
      id: tagSuggestions.id,
      rawName: tagSuggestions.rawName,
      normalized: tagSuggestions.normalized,
      gameId: tagSuggestions.gameId,
      source: tagSuggestions.source,
      status: tagSuggestions.status,
    })
    .from(tagSuggestions)
    .where(eq(tagSuggestions.id, id))
    .limit(1);
  if (!s) throw new TagError(404, 'No such suggestion.');
  if (s.status !== 'pending') throw new TagError(409, `Already ${s.status}.`);
  // The same name from the same source is decided together (an unmatched imported
  // tag usually sits on many games).
  const siblings = await db
    .select({ id: tagSuggestions.id, gameId: tagSuggestions.gameId, source: tagSuggestions.source })
    .from(tagSuggestions)
    .where(
      and(
        eq(tagSuggestions.status, 'pending'),
        eq(tagSuggestions.normalized, s.normalized),
        eq(tagSuggestions.source, s.source),
      ),
    );
  const ids = siblings.map((x) => x.id);
  const now = new Date();
  let tagId: string | null = null;
  let tagSlug: string | null = null;

  if (decision.action === 'accept') {
    const name = titleCase(decision.name ?? s.rawName).slice(0, 80);
    const slug = normalizeTagName(name);
    if (!slug) throw new TagError(400, 'That name makes no slug.');
    const [clash] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, slug)).limit(1);
    if (clash) throw new TagError(409, `A tag "${slug}" already exists — merge into it instead.`);
    const aliases = normalizeTagName(s.rawName) !== slug ? [s.rawName] : [];
    const [t] = await db
      .insert(tags)
      .values({ family: decision.family, slug, name, aliases })
      .returning({ id: tags.id, slug: tags.slug });
    tagId = t!.id;
    tagSlug = t!.slug;
    await writeAudit({
      action: 'create',
      entityType: 'tag-taxonomy',
      entityId: t!.id,
      changes: { created: { family: decision.family, slug, name, aliases } },
      summary: `accepted suggested tag "${s.rawName}" → ${decision.family} "${name}"`,
      actor,
    });
  } else if (decision.action === 'merge') {
    const [t] = await db
      .select({ id: tags.id, slug: tags.slug, aliases: tags.aliases })
      .from(tags)
      .where(eq(tags.slug, decision.tagSlug))
      .limit(1);
    if (!t) throw new TagError(404, `No tag "${decision.tagSlug}".`);
    tagId = t.id;
    tagSlug = t.slug;
    if (!t.aliases.some((a) => normalizeTagName(a) === s.normalized)) {
      await db
        .update(tags)
        .set({ aliases: [...t.aliases, s.rawName].slice(0, 30) })
        .where(eq(tags.id, t.id));
    }
  }
  if (tagId) for (const sib of siblings) await attachFromSuggestion(sib, tagId, actor);
  const status =
    decision.action === 'accept' ? 'accepted' : decision.action === 'merge' ? 'merged' : 'rejected';
  await db
    .update(tagSuggestions)
    .set({ status, mergedIntoTagId: tagId, decidedByLabel: actor.label, decidedAt: now })
    .where(inArray(tagSuggestions.id, ids));
  await writeAudit({
    action: 'update',
    entityType: 'tag-suggestion',
    entityId: s.id,
    changes: { status: { from: 'pending', to: status }, tag: tagSlug, rows: ids.length },
    summary: `${status} suggestion "${s.rawName}"${tagSlug ? ` → ${tagSlug}` : ''} (${ids.length} row${ids.length === 1 ? '' : 's'})`,
    actor,
  });
  return { tagSlug, affected: ids.length };
}

// ── boot: taxonomy seed, imported-tag sync, the Pay-to-win migration ─────────
const SYSTEM_SEED: AuditActor = { label: 'system:tag-seed' };
const SYSTEM_IMPORT: AuditActor = { label: 'system:tag-import' };
const SYSTEM_MIGRATION: AuditActor = { label: 'system:tag-migration' };

/** A fresh install gets the spec's seed taxonomy (data — editors own it after). */
export async function ensureTagTaxonomy(): Promise<number> {
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(tags);
  if ((n?.n ?? 0) > 0) return 0;
  await db
    .insert(tags)
    .values(
      TAG_SEED.map((t, i) => ({
        family: t.family,
        slug: t.slug,
        name: t.name,
        aliases: [...t.aliases],
        sort: i * 10,
      })),
    )
    .onConflictDoNothing();
  await writeAudit({
    action: 'create',
    entityType: 'tag-taxonomy',
    entityId: 'seed',
    changes: { created: { count: TAG_SEED.length } },
    summary: `seeded the tag taxonomy (${TAG_SEED.length} tags)`,
    actor: SYSTEM_SEED,
  });
  return TAG_SEED.length;
}

/** Imported free-form names that are a property, not a tag (owner: is_indie stays a filter). */
const NOT_A_TAG = new Set(['indie']);

/**
 * Map imported free-form tags (third-party, `games.tags`) onto the taxonomy
 * (owner decision): a CONTENT match is published (source import — no
 * provenance claim); anything else is queued as an unpublished suggestion. An
 * existing instance in ANY state is never touched (an editor's removal sticks),
 * and a name already decided for that game is never re-queued. Idempotent; runs
 * at boot and after every catalog import.
 */
export async function syncImportedTags(): Promise<{ mapped: number; queued: number }> {
  const tax = (await taxonomy()).filter((t) => t.active);
  const rows = await db
    .select({ id: games.id, tags: games.tags })
    .from(games)
    .where(sql`cardinality(${games.tags}) > 0`);
  const existingSugg = new Set(
    (
      await db
        .select({ normalized: tagSuggestions.normalized, gameId: tagSuggestions.gameId })
        .from(tagSuggestions)
        .where(eq(tagSuggestions.source, 'import'))
    ).map((r) => `${r.normalized}|${r.gameId}`),
  );
  let mapped = 0;
  let queued = 0;
  for (const g of rows) {
    for (const raw of g.tags ?? []) {
      if (typeof raw !== 'string') continue;
      const normalized = normalizeTagName(raw);
      if (!normalized || NOT_A_TAG.has(normalized)) continue;
      const hit = matchTag(raw, tax);
      if (hit && hit.family === 'content') {
        const ins = await db
          .insert(gameTags)
          .values({
            gameId: g.id,
            tagId: hit.id,
            state: 'published',
            source: 'import',
            confirmedByLabel: SYSTEM_IMPORT.label,
          })
          .onConflictDoNothing()
          .returning({ id: gameTags.id });
        mapped += ins.length;
        continue;
      }
      if (existingSugg.has(`${normalized}|${g.id}`)) continue;
      const ins = await db
        .insert(tagSuggestions)
        .values({ rawName: raw.slice(0, 120), normalized, gameId: g.id, source: 'import' })
        .onConflictDoNothing()
        .returning({ id: tagSuggestions.id });
      existingSugg.add(`${normalized}|${g.id}`);
      queued += ins.length;
    }
  }
  if (mapped || queued) {
    await writeAudit({
      action: 'create',
      entityType: 'game-tag',
      entityId: 'import-sync',
      changes: { mapped, queued },
      summary: `imported tags: ${mapped} mapped onto the taxonomy, ${queued} queued as suggestions`,
      actor: SYSTEM_IMPORT,
    });
  }
  return { mapped, queued };
}

/**
 * The legacy "predatory monetization" content flag becomes the Pay-to-win ISSUE
 * tag (owner, S3 (d)) — editor-entered data, so source "editors"; it never
 * expires (only vote-driven issues do). Idempotent: an existing instance in any
 * state is left alone.
 */
export async function migratePayToWin(): Promise<number> {
  const [tag] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(eq(tags.slug, PAY_TO_WIN_TAG_SLUG))
    .limit(1);
  if (!tag) return 0;
  const flagged = await db
    .select({ gameId: gameContentFlags.gameId, at: gameContentFlags.updatedAt })
    .from(gameContentFlags)
    .where(eq(gameContentFlags.predatoryMonetization, true));
  let n = 0;
  for (const f of flagged) {
    const ins = await db
      .insert(gameTags)
      .values({
        gameId: f.gameId,
        tagId: tag.id,
        state: 'published',
        source: 'editors',
        firstSeenAt: f.at,
        lastConfirmedAt: f.at,
        confirmedByLabel: SYSTEM_MIGRATION.label,
      })
      .onConflictDoNothing()
      .returning({ id: gameTags.id });
    n += ins.length;
  }
  if (n) {
    await writeAudit({
      action: 'create',
      entityType: 'game-tag',
      entityId: 'pay-to-win-migration',
      changes: { created: n },
      summary: `migrated ${n} "predatory monetization" content flag(s) → the Pay-to-win issue tag`,
      actor: SYSTEM_MIGRATION,
    });
  }
  return n;
}
