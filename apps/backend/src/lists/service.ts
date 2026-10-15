import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  LIST_CATEGORY_SEED,
  LIST_DETECT_DEFAULTS,
  LIST_LINE_KEYS,
  type ListLineKey,
  type ListStatus,
} from '@gameskeep/shared/constants';
import { listLexiconInput } from '@gameskeep/shared/validation';
import { db } from '../db/client';
import {
  appSettings,
  articles,
  editorialListCategories,
  editorialListConsensus,
  editorialListEntries,
  editorialLists,
  games,
  sources,
  subjects,
} from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';
import { rulesSettings } from '../rules/settings';
import { curationFor } from '../curation/service';
import { findGameByName, resolveOrQueue } from '../catalog/resolve';
import { isDemo } from '../config/env';
import { detectListCandidate, parseEntries } from './rules';

/**
 * Editorial lists (Phase P S4). Ingest only files CANDIDATES; editors confirm,
 * reject, or add a list by hand. Only CONFIRMED lists are ever public — and never
 * as a copy of the outlet's list (owner): public reads return the consensus,
 * per-game positions ("#3 at IGN"), the comparison lines and a link out to each
 * original list. The full entry list exists only in the admin reads below.
 */
export class ListError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const SYSTEM: AuditActor = { label: 'system:lists' };

// ── detection lexicon ─────────────────────────────────────────────────────────
export const LIST_LEXICON_KEY = 'lists-lexicon';

export async function listLexicon(): Promise<{ patterns: string[]; gotyPatterns: string[] }> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, LIST_LEXICON_KEY))
      .limit(1);
    const parsed = listLexiconInput.safeParse(row?.value);
    return parsed.success ? parsed.data : { ...LIST_DETECT_DEFAULTS };
  } catch {
    return { ...LIST_DETECT_DEFAULTS };
  }
}

export async function setListLexicon(input: unknown, actor: AuditActor) {
  const next = listLexiconInput.parse(input);
  const before = await listLexicon();
  await db
    .insert(appSettings)
    .values({ key: LIST_LEXICON_KEY, value: next })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: next, updatedAt: new Date() } });
  await writeAudit({
    action: 'update',
    entityType: 'app-settings',
    entityId: LIST_LEXICON_KEY,
    changes: { from: before, to: next },
    summary: 'editorial-list detection phrases',
    actor,
  });
  return next;
}

// ── categories ────────────────────────────────────────────────────────────────
const CATEGORIES_SEEDED_KEY = 'list-categories-seeded';

/** Seed the two owner categories ONCE; editors own the list after. */
export async function ensureListCategories(): Promise<void> {
  const [marker] = await db
    .select({ key: appSettings.key })
    .from(appSettings)
    .where(eq(appSettings.key, CATEGORIES_SEEDED_KEY))
    .limit(1);
  if (marker) return;
  await db
    .insert(editorialListCategories)
    .values(LIST_CATEGORY_SEED.map((c) => ({ key: c.key, label: c.label, sort: c.sort })))
    .onConflictDoNothing();
  await db
    .insert(appSettings)
    .values({ key: CATEGORIES_SEEDED_KEY, value: { at: new Date().toISOString() } })
    .onConflictDoNothing();
}

export async function listCategories(activeOnly = true) {
  const rows = await db
    .select({
      key: editorialListCategories.key,
      label: editorialListCategories.label,
      sort: editorialListCategories.sort,
      active: editorialListCategories.active,
    })
    .from(editorialListCategories)
    .orderBy(asc(editorialListCategories.sort), asc(editorialListCategories.label));
  return activeOnly ? rows.filter((r) => r.active) : rows;
}

// ── ingest hooks ──────────────────────────────────────────────────────────────
/** File list-like feed articles as CANDIDATES (a decided list is never touched). */
export async function detectListCandidates(guids: string[]): Promise<number> {
  if (guids.length === 0) return 0;
  const lexicon = await listLexicon();
  let filed = 0;
  for (let i = 0; i < guids.length; i += 500) {
    const chunk = guids.slice(i, i + 500);
    const rows = await db
      .select({
        id: articles.id,
        guid: articles.externalGuid,
        title: articles.title,
        url: articles.url,
        publishDate: articles.publishDate,
        sourceId: articles.sourceId,
        sourceName: sources.name,
      })
      .from(articles)
      .leftJoin(sources, eq(sources.id, articles.sourceId))
      .where(and(inArray(articles.externalGuid, chunk), eq(articles.origin, 'aggregated')));
    for (const r of rows) {
      const hit = detectListCandidate(r.title, lexicon);
      if (!hit || !r.guid) continue;
      const inserted = await db
        .insert(editorialLists)
        .values({
          status: 'candidate',
          articleId: r.id,
          externalGuid: r.guid,
          sourceId: r.sourceId,
          outletName: (r.sourceName ?? 'Unknown outlet').slice(0, 200),
          title: r.title.slice(0, 300),
          url: r.url,
          year: hit.year,
          categoryKey: hit.categoryKey,
          publishedAt: r.publishDate,
          detectedBy: 'auto',
        })
        .onConflictDoNothing()
        .returning({ id: editorialLists.id });
      filed += inserted.length;
    }
  }
  return filed;
}

/** After a re-cluster the feed articles are new rows — find them again by guid. */
export async function relinkListArticles(): Promise<void> {
  await db.execute(sql`
    UPDATE editorial_lists AS l SET article_id = a.id
    FROM articles AS a
    WHERE l.article_id IS NULL AND l.external_guid IS NOT NULL AND a.external_guid = l.external_guid
  `);
}

// ── admin ─────────────────────────────────────────────────────────────────────
export interface AdminListRow {
  id: string;
  status: ListStatus;
  outletName: string;
  title: string;
  url: string | null;
  year: number | null;
  categoryKey: string | null;
  publishedAt: string | null;
  detectedBy: string;
  decidedBy: string | null;
  entries: number;
  matched: number;
}

export async function listQueue(): Promise<{
  candidates: AdminListRow[];
  confirmed: AdminListRow[];
  rejected: AdminListRow[];
}> {
  const rows = await db
    .select({
      id: editorialLists.id,
      status: editorialLists.status,
      outletName: editorialLists.outletName,
      title: editorialLists.title,
      url: editorialLists.url,
      year: editorialLists.year,
      categoryKey: editorialLists.categoryKey,
      publishedAt: editorialLists.publishedAt,
      detectedBy: editorialLists.detectedBy,
      decidedBy: editorialLists.decidedByLabel,
      // Qualified on purpose: in a single-table select Drizzle renders a column bare
      // ("id"), which inside this subquery would bind to e.id (every count read 0).
      entries: sql<number>`(SELECT count(*)::int FROM editorial_list_entries e WHERE e.list_id = "editorial_lists"."id")`,
      matched: sql<number>`(SELECT count(*)::int FROM editorial_list_entries e WHERE e.list_id = "editorial_lists"."id" AND e.game_id IS NOT NULL)`,
    })
    .from(editorialLists)
    .orderBy(
      desc(editorialLists.year),
      asc(editorialLists.outletName),
      desc(editorialLists.createdAt),
    );
  const shape = (r: (typeof rows)[number]): AdminListRow => ({
    ...r,
    status: r.status as ListStatus,
    publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
  });
  return {
    candidates: rows.filter((r) => r.status === 'candidate').map(shape),
    confirmed: rows.filter((r) => r.status === 'confirmed').map(shape),
    rejected: rows
      .filter((r) => r.status === 'rejected')
      .slice(0, 50)
      .map(shape),
  };
}

async function loadList(id: string) {
  const [row] = await db.select().from(editorialLists).where(eq(editorialLists.id, id)).limit(1);
  if (!row) throw new ListError(404, 'No such list.');
  return row;
}

/** ADMIN ONLY — the full entries (never served publicly). */
export async function getListAdmin(id: string) {
  const list = await loadList(id);
  const entries = await db
    .select({
      id: editorialListEntries.id,
      rank: editorialListEntries.rank,
      rawName: editorialListEntries.rawName,
      match: editorialListEntries.match,
      gameSlug: subjects.slug,
      gameName: subjects.name,
    })
    .from(editorialListEntries)
    .leftJoin(games, eq(games.id, editorialListEntries.gameId))
    .leftJoin(subjects, eq(subjects.id, games.subjectId))
    .where(eq(editorialListEntries.listId, id))
    .orderBy(asc(editorialListEntries.rank), asc(editorialListEntries.rawName));
  return {
    list: {
      ...list,
      publishedAt: list.publishedAt ? list.publishedAt.toISOString() : null,
      decidedAt: list.decidedAt ? list.decidedAt.toISOString() : null,
    },
    entries,
  };
}

async function sourceIdOf(slug: string | null | undefined): Promise<string | null> {
  if (!slug) return null;
  const [s] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.slug, slug))
    .limit(1);
  if (!s) throw new ListError(400, `No source "${slug}".`);
  return s.id;
}

export async function createList(
  input: {
    outletName: string;
    sourceSlug?: string | null;
    title: string;
    url: string;
    year?: number | null;
    categoryKey?: string | null;
    publishedAt?: Date | null;
    notes?: string | null;
  },
  actor: AuditActor,
): Promise<{ id: string }> {
  if (input.categoryKey) await assertCategory(input.categoryKey);
  const [row] = await db
    .insert(editorialLists)
    .values({
      status: 'candidate',
      sourceId: await sourceIdOf(input.sourceSlug),
      outletName: input.outletName,
      title: input.title,
      url: input.url,
      year: input.year ?? null,
      categoryKey: input.categoryKey ?? null,
      publishedAt: input.publishedAt ?? null,
      detectedBy: 'editor',
      notes: input.notes ?? null,
    })
    .returning({ id: editorialLists.id });
  if (!row) throw new ListError(500, 'List not created.');
  await writeAudit({
    action: 'create',
    entityType: 'editorial-list',
    entityId: row.id,
    changes: { ...input, publishedAt: input.publishedAt?.toISOString() ?? null },
    summary: `list added by hand: ${input.outletName} — ${input.title}`,
    actor,
  });
  return row;
}

async function assertCategory(key: string): Promise<void> {
  const cats = await listCategories(false);
  if (!cats.some((c) => c.key === key)) throw new ListError(400, `No list category "${key}".`);
}

export async function updateList(
  id: string,
  patch: {
    outletName?: string;
    sourceSlug?: string | null;
    title?: string;
    url?: string;
    year?: number | null;
    categoryKey?: string | null;
    publishedAt?: Date | null;
    notes?: string | null;
  },
  actor: AuditActor,
): Promise<boolean> {
  const before = await loadList(id);
  if (patch.categoryKey) await assertCategory(patch.categoryKey);
  const set: Record<string, unknown> = { updatedAt: new Date() };
  for (const k of [
    'outletName',
    'title',
    'url',
    'year',
    'categoryKey',
    'publishedAt',
    'notes',
  ] as const) {
    if (patch[k] !== undefined) set[k] = patch[k];
  }
  if (patch.sourceSlug !== undefined) set.sourceId = await sourceIdOf(patch.sourceSlug);
  if (before.status === 'confirmed') assertPublishable({ ...before, ...set } as typeof before);
  await db.update(editorialLists).set(set).where(eq(editorialLists.id, id));
  await writeAudit({
    action: 'update',
    entityType: 'editorial-list',
    entityId: id,
    changes: { from: pick(before, Object.keys(set)), to: set },
    summary: `list edited: ${before.outletName} — ${before.title}`,
    actor,
  });
  return before.status === 'confirmed';
}

const pick = (o: Record<string, unknown>, keys: string[]) =>
  Object.fromEntries(keys.filter((k) => k !== 'updatedAt').map((k) => [k, o[k]]));

/** A confirmed list must carry what every public mention needs: outlet, link, year, category. */
function assertPublishable(l: {
  url: string | null;
  year: number | null;
  categoryKey: string | null;
  outletName: string;
}) {
  if (!l.url || !/^https?:\/\//i.test(l.url))
    throw new ListError(400, 'A confirmed list needs a link to the original (http/https).');
  if (!l.year) throw new ListError(400, 'A confirmed list needs a year.');
  if (!l.categoryKey) throw new ListError(400, 'A confirmed list needs a category.');
  if (!l.outletName.trim()) throw new ListError(400, 'A confirmed list needs an outlet.');
}

export async function decideList(
  id: string,
  status: ListStatus,
  note: string | undefined,
  actor: AuditActor,
): Promise<void> {
  const before = await loadList(id);
  if (status === 'confirmed') {
    assertPublishable(before);
    await assertCategory(before.categoryKey!);
  }
  if (before.status === status) return;
  await db
    .update(editorialLists)
    .set({
      status,
      decidedByLabel: status === 'candidate' ? null : actor.label.slice(0, 120),
      decidedAt: status === 'candidate' ? null : new Date(),
      notes: note ? note : before.notes,
      updatedAt: new Date(),
    })
    .where(eq(editorialLists.id, id));
  await writeAudit({
    action: 'update',
    entityType: 'editorial-list',
    entityId: id,
    changes: { status: { from: before.status, to: status }, note: note ?? null },
    summary: `list ${status}: ${before.outletName} — ${before.title}`,
    actor,
  });
}

/** Replace a list's entries from pasted ranked lines; each is auto-matched to a game. */
export async function setListEntries(id: string, text: string, actor: AuditActor) {
  const list = await loadList(id);
  const parsed = parseEntries(text);
  const values: (typeof editorialListEntries.$inferInsert)[] = [];
  for (const e of parsed) {
    const game = await findGameByName(e.name);
    values.push({
      listId: id,
      rank: e.rank,
      rawName: e.name,
      gameId: game?.gameId ?? null,
      match: game ? 'auto' : 'unmatched',
    });
  }
  await db.transaction(async (tx) => {
    await tx.delete(editorialListEntries).where(eq(editorialListEntries.listId, id));
    if (values.length) await tx.insert(editorialListEntries).values(values);
  });
  const matched = values.filter((v) => v.gameId).length;
  await writeAudit({
    action: 'update',
    entityType: 'editorial-list',
    entityId: id,
    changes: { entries: values.length, matched },
    summary: `list entries set (${values.length}, ${matched} matched): ${list.outletName} — ${list.title}`,
    actor,
  });
  return { entries: values.length, matched, confirmed: list.status === 'confirmed' };
}

/** Re-match one entry: a game by slug, no game, or file the name in the unmatched-games queue. */
export async function matchEntry(
  entryId: string,
  input: { gameSlug: string | null; queue?: boolean },
  actor: AuditActor,
): Promise<{ confirmed: boolean }> {
  const [entry] = await db
    .select({
      id: editorialListEntries.id,
      listId: editorialListEntries.listId,
      rawName: editorialListEntries.rawName,
      gameId: editorialListEntries.gameId,
    })
    .from(editorialListEntries)
    .where(eq(editorialListEntries.id, entryId))
    .limit(1);
  if (!entry) throw new ListError(404, 'No such entry.');
  const list = await loadList(entry.listId);
  let gameId: string | null = null;
  let match: 'editor' | 'unmatched' | 'auto' = 'unmatched';
  if (input.gameSlug) {
    const [g] = await db
      .select({ id: games.id })
      .from(games)
      .innerJoin(subjects, eq(subjects.id, games.subjectId))
      .where(eq(subjects.slug, input.gameSlug))
      .limit(1);
    if (!g) throw new ListError(400, `No game "${input.gameSlug}".`);
    gameId = g.id;
    match = 'editor';
  } else if (input.queue) {
    const out = await resolveOrQueue(
      entry.rawName,
      { list: list.title, outlet: list.outletName },
      actor,
    );
    gameId = out.gameId ?? null;
    match = gameId ? 'auto' : 'unmatched';
  }
  await db
    .update(editorialListEntries)
    .set({ gameId, match, updatedAt: new Date() })
    .where(eq(editorialListEntries.id, entryId));
  await writeAudit({
    action: 'update',
    entityType: 'editorial-list',
    entityId: entry.listId,
    changes: {
      entry: entry.rawName,
      gameId: { from: entry.gameId, to: gameId },
      queued: Boolean(input.queue),
    },
    summary: `list entry "${entry.rawName}" → ${input.gameSlug ?? (input.queue ? 'unmatched queue' : 'no game')}`,
    actor,
  });
  return { confirmed: list.status === 'confirmed' };
}

// ── consensus reads ───────────────────────────────────────────────────────────
interface PairInfo {
  year: number;
  categoryKey: string;
  label: string;
  lists: number;
  isPublic: boolean;
}

/** Confirmed lists per (year, category) with an active category. */
async function pairs(): Promise<PairInfo[]> {
  const [cats, rules] = await Promise.all([listCategories(true), rulesSettings()]);
  const label = new Map(cats.map((c) => [c.key, c.label]));
  const rows = await db
    .select({
      year: editorialLists.year,
      categoryKey: editorialLists.categoryKey,
      n: sql<number>`count(*)::int`,
    })
    .from(editorialLists)
    .where(eq(editorialLists.status, 'confirmed'))
    .groupBy(editorialLists.year, editorialLists.categoryKey);
  return rows
    .filter(
      (r): r is { year: number; categoryKey: string; n: number } =>
        r.year != null && r.categoryKey != null && label.has(r.categoryKey),
    )
    .map((r) => ({
      year: r.year,
      categoryKey: r.categoryKey,
      label: label.get(r.categoryKey)!,
      lists: r.n,
      isPublic: r.n >= rules.editorialLists.indexMinLists,
    }))
    .sort((a, b) => b.year - a.year || a.label.localeCompare(b.label));
}

function lineAllowed(key: string, rules: Awaited<ReturnType<typeof rulesSettings>>): boolean {
  const r = rules.editorialLists;
  return (
    (key === 'soloTop' && r.lineSoloTop) ||
    (key === 'coverage' && r.lineCoverage) ||
    (key === 'spread' && r.lineSpread)
  );
}

/** PUBLIC: the lists index — only consensus pages that are public. */
export async function publicListsIndex() {
  const ps = (await pairs()).filter((p) => p.isPublic);
  const out = [];
  for (const p of ps) {
    const top = await db
      .select({ slug: subjects.slug, name: subjects.name })
      .from(editorialListConsensus)
      .innerJoin(games, eq(games.id, editorialListConsensus.gameId))
      .innerJoin(subjects, eq(subjects.id, games.subjectId))
      .where(
        and(
          eq(editorialListConsensus.year, p.year),
          eq(editorialListConsensus.categoryKey, p.categoryKey),
          eq(editorialListConsensus.inConsensus, true),
        ),
      )
      .orderBy(asc(editorialListConsensus.position))
      .limit(3);
    out.push({ year: p.year, categoryKey: p.categoryKey, label: p.label, lists: p.lists, top });
  }
  return out;
}

/**
 * The public order of one consensus (pure; unit-tested): editor pins lead (only
 * games already IN the consensus — a pin can never promote a one-list game),
 * excludes drop, then the row cap. The page and every game page use this.
 */
export function curateConsensus<T extends { slug: string }>(
  rows: T[],
  cur: { pins: string[]; excludes: string[] },
  maxRows: number,
): T[] {
  const ex = new Set(cur.excludes);
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const pinned = [...new Set(cur.pins)]
    .map((slug) => bySlug.get(slug))
    .filter((r): r is T => Boolean(r));
  const pinSet = new Set(pinned.map((r) => r.slug));
  return [...pinned, ...rows.filter((r) => !pinSet.has(r.slug))]
    .filter((r) => !ex.has(r.slug))
    .slice(0, Math.max(0, maxRows));
}

/** A game's position on a public consensus page (null when it is not shown there). */
async function publicPositionOf(
  year: number,
  categoryKey: string,
  gameSlug: string,
  rules: Awaited<ReturnType<typeof rulesSettings>>,
): Promise<number | null> {
  const [cur, rows] = await Promise.all([
    curationFor('lists', `${year}:${categoryKey}`, 'consensus'),
    db
      .select({ slug: subjects.slug })
      .from(editorialListConsensus)
      .innerJoin(games, eq(games.id, editorialListConsensus.gameId))
      .innerJoin(subjects, eq(subjects.id, games.subjectId))
      .where(
        and(
          eq(editorialListConsensus.year, year),
          eq(editorialListConsensus.categoryKey, categoryKey),
          eq(editorialListConsensus.inConsensus, true),
        ),
      )
      .orderBy(asc(editorialListConsensus.position)),
  ]);
  const i = curateConsensus(rows, cur, rules.editorialLists.maxRows).findIndex(
    (r) => r.slug === gameSlug,
  );
  return i >= 0 ? i + 1 : null;
}

export interface PublicConsensus {
  year: number;
  category: { key: string; label: string };
  totalLists: number;
  /** The original lists — outlet, title, link out. NEVER their entries. */
  lists: { outlet: string; title: string; url: string; publishedAt: string | null }[];
  rows: {
    position: number;
    game: { slug: string; name: string; releaseDate: string | null };
    appearances: number;
    avgRank: number;
    positions: { outlet: string; rank: number; url: string | null }[];
    lines: string[];
  }[];
  computedAt: string | null;
}

/** PUBLIC: one consensus page (null when not public). */
export async function publicConsensus(
  year: number,
  categoryKey: string,
): Promise<PublicConsensus | null> {
  const p = (await pairs()).find((x) => x.year === year && x.categoryKey === categoryKey);
  if (!p || !p.isPublic) return null;
  const rules = await rulesSettings();
  const pageKey = `${year}:${categoryKey}`;
  const [cur, lineCur] = await Promise.all([
    curationFor('lists', pageKey, 'consensus'),
    curationFor('lists', pageKey, 'comparison-lines'),
  ]);
  const hiddenLines = new Set(lineCur.excludes);
  const lists = await db
    .select({
      outlet: editorialLists.outletName,
      title: editorialLists.title,
      url: editorialLists.url,
      publishedAt: editorialLists.publishedAt,
    })
    .from(editorialLists)
    .where(
      and(
        eq(editorialLists.status, 'confirmed'),
        eq(editorialLists.year, year),
        eq(editorialLists.categoryKey, categoryKey),
      ),
    )
    .orderBy(asc(editorialLists.outletName));
  const rows = await db
    .select({
      slug: subjects.slug,
      name: subjects.name,
      releaseDate: games.releaseDate,
      appearances: editorialListConsensus.appearances,
      avgRank: editorialListConsensus.avgRank,
      position: editorialListConsensus.position,
      positions: editorialListConsensus.positions,
      lines: editorialListConsensus.lines,
      computedAt: editorialListConsensus.computedAt,
    })
    .from(editorialListConsensus)
    .innerJoin(games, eq(games.id, editorialListConsensus.gameId))
    .innerJoin(subjects, eq(subjects.id, games.subjectId))
    .where(
      and(
        eq(editorialListConsensus.year, year),
        eq(editorialListConsensus.categoryKey, categoryKey),
        // Owner rule: only games on ≥ the minimum (never 1) lists — no outlet's
        // list is ever republished as a page of ours.
        eq(editorialListConsensus.inConsensus, true),
      ),
    )
    .orderBy(asc(editorialListConsensus.position));
  // Editor pins (only among consensus rows) lead; excludes drop.
  const ordered = curateConsensus(rows, cur, rules.editorialLists.maxRows);
  return {
    year,
    category: { key: categoryKey, label: p.label },
    totalLists: lists.length,
    lists: lists
      .filter((l): l is typeof l & { url: string } => Boolean(l.url))
      .map((l) => ({
        outlet: l.outlet,
        title: l.title,
        url: l.url,
        publishedAt: l.publishedAt ? l.publishedAt.toISOString() : null,
      })),
    rows: ordered.map((r, i) => ({
      position: i + 1,
      game: { slug: r.slug, name: r.name, releaseDate: r.releaseDate },
      appearances: r.appearances,
      avgRank: Number(r.avgRank),
      positions: (r.positions ?? []).map((x) => ({ outlet: x.outlet, rank: x.rank, url: x.url })),
      lines: (r.lines ?? [])
        .filter((l) => lineAllowed(l.key, rules) && !hiddenLines.has(`${r.slug}|${l.key}`))
        .map((l) => l.text),
    })),
    computedAt: rows[0]?.computedAt ? rows[0].computedAt.toISOString() : null,
  };
}

export interface GameEditorialLists {
  count: number;
  lists: {
    id: string;
    outlet: string;
    title: string;
    url: string;
    rank: number;
    year: number;
    category: string;
  }[];
  lines: string[];
  consensus: { year: number; categoryKey: string; label: string; position: number }[];
}

/** PUBLIC: a game's positions on confirmed lists ("#3 at IGN") + its lines. */
export async function gameEditorialLists(
  gameId: string,
  gameSlug: string,
): Promise<GameEditorialLists> {
  const [rules, ps, cur] = await Promise.all([
    rulesSettings(),
    pairs(),
    curationFor('game', gameSlug, 'editorial-lists'),
  ]);
  const active = new Map(ps.map((p) => [`${p.year}:${p.categoryKey}`, p]));
  const rows = await db
    .select({
      id: editorialLists.id,
      outlet: editorialLists.outletName,
      title: editorialLists.title,
      url: editorialLists.url,
      year: editorialLists.year,
      categoryKey: editorialLists.categoryKey,
      rank: sql<number>`min(${editorialListEntries.rank})::int`,
    })
    .from(editorialListEntries)
    .innerJoin(editorialLists, eq(editorialLists.id, editorialListEntries.listId))
    .where(and(eq(editorialListEntries.gameId, gameId), eq(editorialLists.status, 'confirmed')))
    .groupBy(editorialLists.id)
    .orderBy(
      desc(editorialLists.year),
      asc(sql`min(${editorialListEntries.rank})`),
      asc(editorialLists.outletName),
    );
  const ex = new Set(cur.excludes);
  const lists = rows
    .filter(
      (r): r is typeof r & { url: string; year: number; categoryKey: string } =>
        Boolean(r.url) &&
        r.year != null &&
        r.categoryKey != null &&
        active.has(`${r.year}:${r.categoryKey}`) &&
        !ex.has(r.id),
    )
    .map((r) => ({
      id: r.id,
      outlet: r.outlet,
      title: r.title,
      url: r.url,
      rank: r.rank,
      year: r.year,
      category: active.get(`${r.year}:${r.categoryKey}`)!.label,
    }));
  const cons = await db
    .select({
      year: editorialListConsensus.year,
      categoryKey: editorialListConsensus.categoryKey,
      position: editorialListConsensus.position,
      inConsensus: editorialListConsensus.inConsensus,
      lines: editorialListConsensus.lines,
    })
    .from(editorialListConsensus)
    .where(eq(editorialListConsensus.gameId, gameId))
    .orderBy(desc(editorialListConsensus.year));
  const lines: string[] = [];
  const consensus: GameEditorialLists['consensus'] = [];
  for (const c of cons) {
    const p = active.get(`${c.year}:${c.categoryKey}`);
    if (!p) continue;
    const lineCur = await curationFor('lists', `${c.year}:${c.categoryKey}`, 'comparison-lines');
    const hidden = new Set(lineCur.excludes);
    for (const l of c.lines ?? []) {
      if (lineAllowed(l.key, rules) && !hidden.has(`${gameSlug}|${l.key}`)) {
        lines.push(`${p.label} ${c.year}: ${l.text}`);
      }
    }
    if (p.isPublic && c.inConsensus) {
      // The position the consensus PAGE shows (editor pins / excludes / row cap
      // applied) — never the raw stored one, so the two can't disagree.
      const position = await publicPositionOf(c.year, c.categoryKey, gameSlug, rules);
      if (position != null) {
        consensus.push({ year: c.year, categoryKey: c.categoryKey, label: p.label, position });
      }
    }
  }
  const shown = lists.slice(0, rules.editorialLists.gamePageMax);
  return { count: shown.length, lists: shown, lines: shown.length ? lines : [], consensus };
}

/** Sitemap: public consensus pages. */
export async function sitemapListPages(): Promise<
  { year: number; categoryKey: string; lastModified: string | null }[]
> {
  const ps = (await pairs()).filter((p) => p.isPublic);
  const out = [];
  for (const p of ps) {
    const [row] = await db
      .select({ at: editorialListConsensus.computedAt })
      .from(editorialListConsensus)
      .where(
        and(
          eq(editorialListConsensus.year, p.year),
          eq(editorialListConsensus.categoryKey, p.categoryKey),
        ),
      )
      .limit(1);
    out.push({
      year: p.year,
      categoryKey: p.categoryKey,
      lastModified: row?.at ? row.at.toISOString() : null,
    });
  }
  return out;
}

/** ADMIN: the full consensus preview (every row, every line, for curation). */
export async function adminConsensus(year: number, categoryKey: string) {
  const rows = await db
    .select({
      slug: subjects.slug,
      name: subjects.name,
      appearances: editorialListConsensus.appearances,
      avgRank: editorialListConsensus.avgRank,
      position: editorialListConsensus.position,
      inConsensus: editorialListConsensus.inConsensus,
      positions: editorialListConsensus.positions,
      lines: editorialListConsensus.lines,
    })
    .from(editorialListConsensus)
    .innerJoin(games, eq(games.id, editorialListConsensus.gameId))
    .innerJoin(subjects, eq(subjects.id, games.subjectId))
    .where(
      and(
        eq(editorialListConsensus.year, year),
        eq(editorialListConsensus.categoryKey, categoryKey),
      ),
    )
    .orderBy(
      asc(sql`${editorialListConsensus.position} NULLS LAST`),
      desc(editorialListConsensus.appearances),
      asc(editorialListConsensus.avgRank),
    );
  const p = (await pairs()).find((x) => x.year === year && x.categoryKey === categoryKey) ?? null;
  return {
    pair: p,
    rows: rows.map((r) => ({ ...r, avgRank: Number(r.avgRank) })),
    lineKeys: LIST_LINE_KEYS as readonly ListLineKey[],
  };
}

export async function consensusPairs(): Promise<PairInfo[]> {
  return pairs();
}

// ── demo data ─────────────────────────────────────────────────────────────────
interface DemoList {
  outlet: string;
  year: number;
  category: 'goty' | 'best-of-year';
  title: string;
  games: string[]; // slugs in rank order
}

/** Mock data (demo only): confirmed year-end lists on the demo outlets; links go to the outlet's site. */
const DEMO_LISTS: DemoList[] = [
  {
    outlet: 'ign',
    year: 2023,
    category: 'best-of-year',
    title: 'The best games of 2023',
    games: [
      'baldurs-gate-3',
      'the-legend-of-zelda-tears-of-the-kingdom',
      'alan-wake-2',
      'resident-evil-4',
      'street-fighter-6',
      'pizza-tower',
      'diablo-iv',
      'lethal-company',
      'mortal-kombat-1',
      'counter-strike-2',
    ],
  },
  {
    outlet: 'gamespot',
    year: 2023,
    category: 'best-of-year',
    title: 'Best games of 2023',
    games: [
      'the-legend-of-zelda-tears-of-the-kingdom',
      'baldurs-gate-3',
      'resident-evil-4',
      'alan-wake-2',
      'pizza-tower',
      'street-fighter-6',
      'lethal-company',
      'cities-skylines-ii',
      'diablo-iv',
      'f1-23',
    ],
  },
  {
    outlet: 'eurogamer',
    year: 2023,
    category: 'best-of-year',
    title: 'Our top games of 2023',
    games: [
      'pizza-tower',
      'baldurs-gate-3',
      'alan-wake-2',
      'the-legend-of-zelda-tears-of-the-kingdom',
      'lethal-company',
      'resident-evil-4',
      'street-fighter-6',
      'counter-strike-2',
      'mortal-kombat-1',
      'diablo-iv',
    ],
  },
  {
    outlet: 'pc-gamer',
    year: 2023,
    category: 'best-of-year',
    title: 'The best PC games of 2023',
    games: [
      'baldurs-gate-3',
      'lethal-company',
      'alan-wake-2',
      'counter-strike-2',
      'cities-skylines-ii',
      'diablo-iv',
      'resident-evil-4',
      'pizza-tower',
      'street-fighter-6',
      'mortal-kombat-1',
    ],
  },
  {
    outlet: 'polygon',
    year: 2023,
    category: 'goty',
    title: 'Game of the Year 2023',
    games: [
      'baldurs-gate-3',
      'the-legend-of-zelda-tears-of-the-kingdom',
      'alan-wake-2',
      'pizza-tower',
      'resident-evil-4',
    ],
  },
  {
    outlet: 'gamesradar',
    year: 2023,
    category: 'goty',
    title: 'Game of the Year 2023',
    games: [
      'the-legend-of-zelda-tears-of-the-kingdom',
      'baldurs-gate-3',
      'resident-evil-4',
      'alan-wake-2',
      'street-fighter-6',
    ],
  },
  {
    outlet: 'vg247',
    year: 2023,
    category: 'goty',
    title: 'Our Game of the Year 2023',
    games: [
      'baldurs-gate-3',
      'alan-wake-2',
      'lethal-company',
      'the-legend-of-zelda-tears-of-the-kingdom',
      'pizza-tower',
    ],
  },
  {
    outlet: 'ign',
    year: 2024,
    category: 'best-of-year',
    title: 'The best games of 2024',
    games: [
      'helldivers-2',
      'balatro',
      'final-fantasy-xvi',
      'like-a-dragon-infinite-wealth',
      'tekken-8',
      'dragon-s-dogma-2',
      'hades-ii',
      'manor-lords',
    ],
  },
  {
    outlet: 'eurogamer',
    year: 2024,
    category: 'best-of-year',
    title: 'Our top games of 2024',
    games: [
      'balatro',
      'like-a-dragon-infinite-wealth',
      'helldivers-2',
      'hades-ii',
      'tekken-8',
      'final-fantasy-xvi',
      'manor-lords',
      'dragon-s-dogma-2',
    ],
  },
  {
    outlet: 'kotaku',
    year: 2024,
    category: 'best-of-year',
    title: 'The best games of 2024',
    games: [
      'balatro',
      'helldivers-2',
      'like-a-dragon-infinite-wealth',
      'final-fantasy-xvi',
      'dragon-s-dogma-2',
      'tekken-8',
      'hades-ii',
      'manor-lords',
    ],
  },
];

/** Seed the demo lists once each (idempotent by a stable guid). Demo only. */
export async function seedDemoLists(): Promise<number> {
  if (!isDemo()) return 0;
  let created = 0;
  for (const d of DEMO_LISTS) {
    const guid = `demo-list-${d.outlet}-${d.year}-${d.category}`;
    const [exists] = await db
      .select({ id: editorialLists.id })
      .from(editorialLists)
      .where(eq(editorialLists.externalGuid, guid))
      .limit(1);
    if (exists) continue;
    const [src] = await db
      .select({ id: sources.id, name: sources.name, website: sources.websiteUrl })
      .from(sources)
      .where(eq(sources.slug, d.outlet))
      .limit(1);
    if (!src?.website) continue; // the outlet arrives with the first ingest — try again then
    const slugs = await db
      .select({ slug: subjects.slug, gameId: games.id, name: subjects.name })
      .from(games)
      .innerJoin(subjects, eq(subjects.id, games.subjectId))
      .where(inArray(subjects.slug, d.games));
    const bySlug = new Map(slugs.map((s) => [s.slug, s]));
    // Never a partial list: wait until the catalog import brought every game in.
    if (!d.games.every((slug) => bySlug.has(slug))) continue;
    // The list and its entries land together (a list is seeded once, by guid).
    const made = await db.transaction(async (tx) => {
      const [list] = await tx
        .insert(editorialLists)
        .values({
          status: 'confirmed',
          externalGuid: guid,
          sourceId: src.id,
          outletName: src.name,
          title: d.title,
          url: src.website,
          year: d.year,
          categoryKey: d.category,
          publishedAt: new Date(Date.UTC(d.year, 11, 12)),
          detectedBy: 'editor',
          decidedByLabel: 'demo-seed',
          decidedAt: new Date(Date.UTC(d.year, 11, 14)),
          notes:
            'Demo data (mock): positions are illustrative; the link goes to the outlet’s site.',
        })
        .onConflictDoNothing()
        .returning({ id: editorialLists.id });
      if (!list) return false;
      const entries = d.games
        .map((slug, i) => ({ rank: i + 1, g: bySlug.get(slug)! }))
        .map((e) => ({
          listId: list.id,
          rank: e.rank,
          rawName: e.g.name,
          gameId: e.g.gameId,
          match: 'auto',
        }));
      await tx.insert(editorialListEntries).values(entries);
      return true;
    });
    if (made) created += 1;
  }
  if (created) {
    await writeAudit({
      action: 'create',
      entityType: 'editorial-list',
      entityId: 'demo-seed',
      changes: { created },
      summary: `demo editorial lists: ${created}`,
      actor: SYSTEM,
    });
  }
  return created;
}
