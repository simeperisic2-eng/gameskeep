import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import {
  HOMEPAGE_MAX_ITEMS,
  HOMEPAGE_SECTIONS,
  HOMEPAGE_SECTION_KEYS,
  type HomepageItemType,
  type HomepageSectionKey,
  type HomepageSectionKind,
  type HomepageSectionMode,
} from '@gameskeep/shared/constants';
import type {
  HomepagePinsInput,
  HomepagePromotionCreate,
  HomepageSectionPatch,
} from '@gameskeep/shared/validation';
import { db } from '../db/client';
import {
  adPlacements,
  appSettings,
  homepageSectionPins,
  homepageSections,
  subjects,
  topics,
} from '../db/schema';
import { diffRows, writeAudit, type AuditActor } from '../admin/audit';
import { LISTS_SETTINGS_KEY } from '../lists/settings';
import { coerceRules, ruleDimensionsFor, type SectionRules } from './rules';

/**
 * Homepage section configuration (Phase P S2): the fixed catalogue's rows,
 * edited through the admin (title, enabled, order, mode, count, Δ window, card
 * tags, feed rules, pins, the discovery Promoted position) — every change
 * validated against the section's kind and audited old → new.
 */
export class HomepageConfigError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

export interface SectionRow {
  id: string;
  key: HomepageSectionKey;
  kind: HomepageSectionKind;
  items: HomepageItemType;
  delta: boolean;
  title: string;
  enabled: boolean;
  position: number;
  mode: HomepageSectionMode;
  itemCount: number;
  deltaWindowHours: number | null;
  cardTagFamilies: string[];
  cardTagCount: number;
  rules: SectionRules;
  promotedPosition: number | null;
}

export interface SectionPin {
  position: number;
  topicSlug: string | null;
  gameSlug: string | null;
  /** Display name; null when the pinned story no longer exists (stale pin). */
  name: string | null;
}

const isKey = (k: string): k is HomepageSectionKey =>
  (HOMEPAGE_SECTION_KEYS as string[]).includes(k);

function shape(r: typeof homepageSections.$inferSelect): SectionRow | null {
  if (!isKey(r.key)) return null; // a row outside the catalogue is never served
  const def = HOMEPAGE_SECTIONS[r.key];
  return {
    id: r.id,
    key: r.key,
    kind: r.kind,
    items: def.items,
    delta: def.delta,
    title: r.title,
    enabled: r.enabled,
    position: r.position,
    mode: r.mode,
    itemCount: r.itemCount,
    deltaWindowHours: r.deltaWindowHours ?? null,
    cardTagFamilies: r.cardTagFamilies ?? [],
    cardTagCount: r.cardTagCount,
    rules: coerceRules(r.rules),
    promotedPosition: r.promotedPosition ?? null,
  };
}

export async function listSections(): Promise<SectionRow[]> {
  const rows = await db.select().from(homepageSections).orderBy(asc(homepageSections.position));
  return rows.map(shape).filter((s): s is SectionRow => s !== null);
}

export async function sectionByKey(key: string): Promise<SectionRow | null> {
  if (!isKey(key)) return null;
  const [row] = await db
    .select()
    .from(homepageSections)
    .where(eq(homepageSections.key, key))
    .limit(1);
  return row ? shape(row) : null;
}

// ── ensure + one-time migration of the legacy `lists` homepage knobs ─────────

type Raw = Record<string, unknown>;
const clampInt = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
const slugList = (v: unknown): string[] =>
  Array.isArray(v)
    ? [...new Set(v.filter((s): s is string => typeof s === 'string' && /^[a-z0-9-]+$/.test(s)))]
    : [];

/**
 * Create every catalogue section that's missing (idempotent, every mode). On a
 * section's FIRST creation the legacy `lists` homepage knobs it supersedes are
 * carried over — hero/feed/top-rated counts and the topic / game pins — so an
 * upgraded install keeps its editorial choices. Returns the keys created.
 */
export async function ensureHomepageSections(): Promise<string[]> {
  const existing = new Set(
    (await db.select({ key: homepageSections.key }).from(homepageSections)).map((r) => r.key),
  );
  const missing = HOMEPAGE_SECTION_KEYS.filter((k) => !existing.has(k));
  if (missing.length === 0) return [];

  const [listsRow] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, LISTS_SETTINGS_KEY))
    .limit(1);
  const legacy = (listsRow?.value ?? {}) as Raw;
  const legacyCount: Partial<Record<HomepageSectionKey, number | null>> = {
    trending: clampInt(legacy.heroCount, 1, HOMEPAGE_MAX_ITEMS),
    latest: clampInt(legacy.feedCount, 1, HOMEPAGE_MAX_ITEMS),
    top_rated: clampInt(legacy.topRatedCount, 1, HOMEPAGE_MAX_ITEMS),
  };

  for (const key of missing) {
    const def = HOMEPAGE_SECTIONS[key];
    const [row] = await db
      .insert(homepageSections)
      .values({
        key,
        kind: def.kind,
        title: def.title,
        enabled: def.defaults.enabled,
        position: def.defaults.position,
        mode: def.defaults.mode,
        itemCount: legacyCount[key] ?? def.defaults.itemCount,
        deltaWindowHours: def.defaults.deltaWindowHours,
        promotedPosition: def.defaults.promotedPosition,
      })
      .onConflictDoNothing()
      .returning({ id: homepageSections.id });
    if (!row) continue;

    // Legacy pins → explicit positions (in the order the admin had listed them).
    const legacyPins =
      key === 'trending'
        ? slugList(legacy.pinnedTopicSlugs).map((slug) => ({ topicSlug: slug, subjectId: null }))
        : key === 'top_rated'
          ? (
              await db
                .select({ id: subjects.id, slug: subjects.slug })
                .from(subjects)
                .where(
                  and(
                    inArray(subjects.slug, [...slugList(legacy.pinnedGameSlugs), '__none__']),
                    eq(subjects.type, 'game'),
                  ),
                )
            )
              .sort(
                (a, b) =>
                  slugList(legacy.pinnedGameSlugs).indexOf(a.slug) -
                  slugList(legacy.pinnedGameSlugs).indexOf(b.slug),
              )
              .map((s) => ({ topicSlug: null, subjectId: s.id }))
          : [];
    const pins = legacyPins.slice(0, HOMEPAGE_MAX_ITEMS);
    if (pins.length) {
      await db.insert(homepageSectionPins).values(
        pins.map((p, i) => ({
          sectionId: row.id,
          position: i + 1,
          topicSlug: p.topicSlug,
          subjectId: p.subjectId,
          createdByLabel: 'system:lists-migration',
        })),
      );
    }
  }
  return missing;
}

// ── reads for the admin ────────────────────────────────────────────────────────

export async function pinsFor(sectionId: string): Promise<SectionPin[]> {
  const rows = await db
    .select({
      position: homepageSectionPins.position,
      topicSlug: homepageSectionPins.topicSlug,
      gameSlug: subjects.slug,
      gameName: subjects.name,
      topicTitle: topics.title,
    })
    .from(homepageSectionPins)
    .leftJoin(subjects, eq(subjects.id, homepageSectionPins.subjectId))
    .leftJoin(topics, eq(topics.slug, homepageSectionPins.topicSlug))
    .where(eq(homepageSectionPins.sectionId, sectionId))
    .orderBy(asc(homepageSectionPins.position));
  return rows.map((r) => ({
    position: r.position,
    topicSlug: r.topicSlug ?? null,
    gameSlug: r.topicSlug ? null : (r.gameSlug ?? null),
    name: r.topicSlug ? (r.topicTitle ?? null) : (r.gameName ?? null),
  }));
}

export interface SectionPromotion {
  id: string;
  advertiser: string;
  gameSlug: string | null;
  gameName: string | null;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
}

export async function promotionsFor(sectionId: string): Promise<SectionPromotion[]> {
  const rows = await db
    .select({
      id: adPlacements.id,
      advertiser: adPlacements.advertiserName,
      gameSlug: subjects.slug,
      gameName: subjects.name,
      status: adPlacements.status,
      startsAt: adPlacements.startsAt,
      endsAt: adPlacements.endsAt,
    })
    .from(adPlacements)
    .leftJoin(subjects, eq(subjects.id, adPlacements.promotedSubjectId))
    .where(eq(adPlacements.sectionId, sectionId))
    .orderBy(sql`${adPlacements.updatedAt} DESC`);
  return rows.map((r) => ({
    id: r.id,
    advertiser: r.advertiser,
    gameSlug: r.gameSlug ?? null,
    gameName: r.gameName ?? null,
    status: r.status,
    startsAt: r.startsAt ? r.startsAt.toISOString() : null,
    endsAt: r.endsAt ? r.endsAt.toISOString() : null,
  }));
}

// ── writes ─────────────────────────────────────────────────────────────────────

/** Check a patch against the section's kind; returns the clean column values. */
export function validateSectionPatch(
  section: Pick<SectionRow, 'key' | 'kind' | 'items' | 'delta' | 'itemCount'>,
  patch: HomepageSectionPatch,
): Partial<typeof homepageSections.$inferInsert> {
  const bad = (m: string): never => {
    throw new HomepageConfigError(400, m);
  };
  const out: Partial<typeof homepageSections.$inferInsert> = {};
  if (patch.title !== undefined) out.title = patch.title;
  if (patch.enabled !== undefined) out.enabled = patch.enabled;
  if (patch.mode !== undefined) {
    if (section.kind === 'block' && patch.mode !== 'auto')
      bad(`"${section.key}" is a block — it has no items to pin.`);
    if (section.key === 'our_picks' && patch.mode !== 'manual')
      bad('Our picks is manual only (team recommendations — no automatic rule).');
    out.mode = patch.mode;
  }
  if (patch.itemCount !== undefined) out.itemCount = patch.itemCount;
  if (patch.deltaWindowHours !== undefined) {
    if (!section.delta && patch.deltaWindowHours !== null)
      bad(`"${section.key}" shows no Δ — it has no window to set.`);
    if (section.delta && patch.deltaWindowHours === null)
      bad(`"${section.key}" needs a Δ window (hours).`);
    out.deltaWindowHours = patch.deltaWindowHours;
  }
  if (patch.cardTagFamilies !== undefined || patch.cardTagCount !== undefined) {
    if (section.items === 'none') bad(`"${section.key}" is a block — it shows no cards.`);
    if (patch.cardTagFamilies !== undefined)
      out.cardTagFamilies = [...new Set(patch.cardTagFamilies.map((s) => s.toLowerCase()))];
    if (patch.cardTagCount !== undefined) out.cardTagCount = patch.cardTagCount;
  }
  if (patch.rules !== undefined) {
    const allowed = ruleDimensionsFor(section.items);
    for (const sideName of ['include', 'exclude'] as const) {
      const side = patch.rules[sideName] ?? {};
      for (const [dim, list] of Object.entries(side)) {
        if (list && list.length && !(allowed as string[]).includes(dim))
          bad(
            allowed.length
              ? `"${section.key}" can filter on ${allowed.join(', ')} — not ${dim}.`
              : `"${section.key}" is a block — it has no feed rules.`,
          );
      }
    }
    out.rules = coerceRules(patch.rules);
  }
  if (patch.promotedPosition !== undefined) {
    if (section.kind !== 'discovery' && patch.promotedPosition !== null)
      bad(
        `"${section.key}" is a ${section.kind} section — paid placements are never shown there (discovery sections only: New, Upcoming, Featured).`,
      );
    out.promotedPosition = patch.promotedPosition;
  }
  return out;
}

const auditable = (s: SectionRow): Raw => ({
  title: s.title,
  enabled: s.enabled,
  mode: s.mode,
  itemCount: s.itemCount,
  deltaWindowHours: s.deltaWindowHours,
  cardTagFamilies: s.cardTagFamilies,
  cardTagCount: s.cardTagCount,
  rules: s.rules,
  promotedPosition: s.promotedPosition,
});

export async function updateSection(
  key: string,
  patch: HomepageSectionPatch,
  actor: AuditActor,
): Promise<SectionRow> {
  const before = await sectionByKey(key);
  if (!before) throw new HomepageConfigError(404, `Unknown section "${key}".`);
  const values = validateSectionPatch(before, patch);
  if (Object.keys(values).length === 0) return before;
  await db
    .update(homepageSections)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(homepageSections.id, before.id));
  const after = (await sectionByKey(key))!;
  const changes = diffRows(auditable(before), auditable(after));
  if (Object.keys(changes).length > 0) {
    await writeAudit({
      action: 'update',
      entityType: 'homepage-section',
      entityId: key,
      changes,
      summary: `homepage section "${key}": ${Object.keys(changes).join(', ')}`,
      actor,
    });
  }
  return after;
}

/** Set the page order: `keys` must be exactly the catalogue, each once. */
export async function reorderSections(keys: string[], actor: AuditActor): Promise<SectionRow[]> {
  const set = new Set(keys);
  if (
    set.size !== keys.length ||
    set.size !== HOMEPAGE_SECTION_KEYS.length ||
    !HOMEPAGE_SECTION_KEYS.every((k) => set.has(k))
  ) {
    throw new HomepageConfigError(
      400,
      `The order must list every section exactly once (${HOMEPAGE_SECTION_KEYS.join(', ')}).`,
    );
  }
  const before = (await listSections()).map((s) => s.key);
  await db.transaction(async (tx) => {
    for (let i = 0; i < keys.length; i += 1) {
      await tx
        .update(homepageSections)
        .set({ position: i + 1, updatedAt: new Date() })
        .where(eq(homepageSections.key, keys[i]!));
    }
  });
  const after = await listSections();
  if (before.join(',') !== after.map((s) => s.key).join(',')) {
    await writeAudit({
      action: 'update',
      entityType: 'homepage-section',
      entityId: 'order',
      changes: { order: { from: before, to: after.map((s) => s.key) } },
      summary: 'homepage section order changed',
      actor,
    });
  }
  return after;
}

/** Replace a section's pins (positions must be within its item count). */
export async function setSectionPins(
  key: string,
  input: HomepagePinsInput,
  actor: AuditActor,
): Promise<SectionPin[]> {
  const section = await sectionByKey(key);
  if (!section) throw new HomepageConfigError(404, `Unknown section "${key}".`);
  const bad = (m: string): never => {
    throw new HomepageConfigError(400, m);
  };
  if (section.items === 'none' && input.pins.length)
    bad(`"${key}" is a block — it has no items to pin.`);
  const positions = new Set<number>();
  const rows: { position: number; topicSlug: string | null; subjectId: string | null }[] = [];
  for (const p of input.pins) {
    if (p.position > section.itemCount)
      bad(`Pin position ${p.position} is past "${key}"'s ${section.itemCount} items.`);
    if (positions.has(p.position)) bad(`Two pins at position ${p.position}.`);
    positions.add(p.position);
    if (p.topicSlug) {
      if (section.items === 'game') bad(`"${key}" lists games — pin a game, not a story.`);
      const [t] = await db
        .select({ id: topics.id })
        .from(topics)
        .where(eq(topics.slug, p.topicSlug))
        .limit(1);
      if (!t) bad(`No story "${p.topicSlug}".`);
      rows.push({ position: p.position, topicSlug: p.topicSlug, subjectId: null });
    } else if (p.gameSlug) {
      if (section.items === 'topic') bad(`"${key}" lists stories — pin a story, not a game.`);
      const [g] = await db
        .select({ id: subjects.id })
        .from(subjects)
        .where(and(eq(subjects.slug, p.gameSlug), eq(subjects.type, 'game')))
        .limit(1);
      if (!g) bad(`No game "${p.gameSlug}".`);
      rows.push({ position: p.position, topicSlug: null, subjectId: g!.id });
    }
  }
  const before = await pinsFor(section.id);
  await db.transaction(async (tx) => {
    await tx.delete(homepageSectionPins).where(eq(homepageSectionPins.sectionId, section.id));
    if (rows.length) {
      await tx
        .insert(homepageSectionPins)
        .values(rows.map((r) => ({ ...r, sectionId: section.id, createdByLabel: actor.label })));
    }
  });
  const after = await pinsFor(section.id);
  const label = (ps: SectionPin[]): string[] =>
    ps.map((p) => `${p.position}:${p.topicSlug ?? p.gameSlug}`);
  await writeAudit({
    action: 'update',
    entityType: 'homepage-section',
    entityId: `${key}:pins`,
    changes: { pins: { from: label(before), to: label(after) } },
    summary: `homepage section "${key}" pins: ${label(after).join(', ') || 'none'}`,
    actor,
  });
  return after;
}

/**
 * Create a PAID placement for a homepage section (draft — activation is the
 * admin's status switch after off-site payment). Data sections are rejected
 * here (service) and by the DB (composite FK + CHECK). Only a GAME can be
 * promoted; stories never are.
 */
export async function createSectionPromotion(
  key: string,
  input: HomepagePromotionCreate,
  actor: AuditActor,
): Promise<SectionPromotion> {
  const section = await sectionByKey(key);
  if (!section) throw new HomepageConfigError(404, `Unknown section "${key}".`);
  if (section.kind !== 'discovery') {
    throw new HomepageConfigError(
      400,
      `"${section.title}" is a ${section.kind} section and is never sold — paid placements can only target a discovery section (New, Upcoming, Featured).`,
    );
  }
  const [game] = await db
    .select({ id: subjects.id, name: subjects.name })
    .from(subjects)
    .where(and(eq(subjects.slug, input.gameSlug), eq(subjects.type, 'game')))
    .limit(1);
  if (!game)
    throw new HomepageConfigError(400, `No game "${input.gameSlug}" — only games can be promoted.`);
  const [row] = await db
    .insert(adPlacements)
    .values({
      sectionId: section.id,
      sectionKind: 'discovery',
      advertiserName: input.advertiserName,
      advertiserContact: input.advertiserContact ?? null,
      headline: input.headline ?? game.name.slice(0, 120),
      promotedSubjectId: game.id,
      promotedSubjectType: 'game',
      status: 'draft',
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      priceCents: input.priceCents ?? null,
      currency: input.currency ?? 'USD',
      notes: input.notes ?? null,
    })
    .returning({ id: adPlacements.id });
  await writeAudit({
    action: 'create',
    entityType: 'ad-placement',
    entityId: row!.id,
    changes: { created: { section: key, game: input.gameSlug, advertiser: input.advertiserName } },
    summary: `section promotion "${input.advertiserName}" → ${key} (${input.gameSlug}), draft`,
    actor,
  });
  const all = await promotionsFor(section.id);
  return all.find((p) => p.id === row!.id)!;
}
