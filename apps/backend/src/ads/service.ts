import { and, desc, eq, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { AdPlacementStatus } from '@gameskeep/shared/constants';
import type { PromoPricingInput } from '@gameskeep/shared/validation';
import { db } from '../db/client';
import { adPlacements, adSlots, appSettings, subjects, topics } from '../db/schema';
import { writeAudit, type AuditActor } from '../admin/audit';
import { homepageSettings } from '../homepage/settings';

/**
 * Ad / promotion service (SPEC I8, Slice 2). No payment gateway — `status` is
 * admin-set and `active` means "live + labeled Promoted". Public reads are
 * leak-proof (they expose only the advertiser-facing creative, never price /
 * contact / notes); the creative is UGC and is rendered ESCAPED by the frontend.
 */

/** A placement is live iff status=active AND now is inside its (optional) window. */
function liveWindow(now: Date) {
  return and(
    eq(adPlacements.status, 'active'),
    or(isNull(adPlacements.startsAt), lte(adPlacements.startsAt, now)),
    or(isNull(adPlacements.endsAt), gte(adPlacements.endsAt, now)),
  );
}

export interface PublicPlacement {
  headline: string;
  body: string | null;
  ctaUrl: string | null;
  ctaLabel: string | null;
  advertiser: string;
  /** What is promoted, if anything — drives the render-forced label:
   *  "Promoted" for all of them ("Sponsored" is the outlet's own signal). */
  game: { slug: string; name: string } | null;
  story: { slug: string; title: string } | null;
}
export interface SlotView {
  slotKey: string;
  fallback: string; // 'ad' | 'organic' | 'hide'
  format: string;
  placement: PublicPlacement | null;
  /** For a slot INSIDE a list (e.g. the story coverage list): its 1-based row. */
  listPosition: number | null;
  /**
   * `ads.showUnsoldPlaceholder` (Phase P S2, default false): while off an UNSOLD
   * slot renders nothing publicly, whatever its fallback; on → the fallback.
   */
  showPlaceholder: boolean;
}

const toPublic = (p: {
  headline: string;
  body: string | null;
  ctaUrl: string | null;
  ctaLabel: string | null;
  advertiserName: string;
  gameSlug: string | null;
  gameName: string | null;
  topicSlug: string | null;
  topicTitle: string | null;
}): PublicPlacement => ({
  headline: p.headline,
  body: p.body,
  ctaUrl: p.ctaUrl,
  ctaLabel: p.ctaLabel,
  advertiser: p.advertiserName,
  game: p.gameSlug && p.gameName ? { slug: p.gameSlug, name: p.gameName } : null,
  story: p.topicSlug && p.topicTitle ? { slug: p.topicSlug, title: p.topicTitle } : null,
});

/** What an `AdSlot key=…` renders: its live placement (if any) + its fallback. */
export async function slotPublicView(slotKey: string, now: Date = new Date()): Promise<SlotView> {
  const [slot] = await db
    .select({
      id: adSlots.id,
      fallback: adSlots.fallback,
      format: adSlots.format,
      isActive: adSlots.isActive,
      listPosition: adSlots.listPosition,
    })
    .from(adSlots)
    .where(eq(adSlots.key, slotKey))
    .limit(1);
  const showPlaceholder = (await homepageSettings()).showUnsoldPlaceholder;
  // Unknown/disabled slot → the "AD" fallback (rendered only if placeholders are on).
  if (!slot || !slot.isActive)
    return {
      slotKey,
      fallback: 'ad',
      format: 'card',
      placement: null,
      listPosition: null,
      showPlaceholder,
    };

  const [p] = await db
    .select({
      headline: adPlacements.headline,
      body: adPlacements.body,
      ctaUrl: adPlacements.ctaUrl,
      ctaLabel: adPlacements.ctaLabel,
      advertiserName: adPlacements.advertiserName,
      gameSlug: subjects.slug,
      gameName: subjects.name,
      topicSlug: topics.slug,
      topicTitle: topics.title,
    })
    .from(adPlacements)
    .leftJoin(subjects, eq(subjects.id, adPlacements.promotedSubjectId))
    .leftJoin(topics, eq(topics.slug, adPlacements.promotedTopicSlug))
    .where(and(eq(adPlacements.slotId, slot.id), liveWindow(now)))
    .orderBy(desc(adPlacements.updatedAt))
    .limit(1);

  return {
    slotKey,
    fallback: slot.fallback,
    format: slot.format,
    placement: p ? toPublic(p) : null,
    listPosition: slot.listPosition ?? null,
    showPlaceholder,
  };
}

/** An active placement promoting a game (by subject slug) — the game-page badge. */
export async function promotionForGame(
  slug: string,
  now: Date = new Date(),
): Promise<{ advertiser: string; headline: string; ctaUrl: string | null } | null> {
  const [p] = await db
    .select({
      advertiser: adPlacements.advertiserName,
      headline: adPlacements.headline,
      ctaUrl: adPlacements.ctaUrl,
    })
    .from(adPlacements)
    .innerJoin(subjects, eq(subjects.id, adPlacements.promotedSubjectId))
    .where(and(eq(subjects.slug, slug), liveWindow(now)))
    .orderBy(desc(adPlacements.updatedAt))
    .limit(1);
  return p ?? null;
}

/**
 * The live PAID placements of each homepage section (owner decision: any
 * section; games or stories; as many as the section has paid positions). In
 * booking order — the first booked fills the first paid position. Leak-proof:
 * the item ref + the advertiser display name for the render-forced label only.
 */
export async function activeSectionPromotions(
  now: Date = new Date(),
): Promise<Map<string, { ref: string; advertiser: string; kind: 'game' | 'story' }[]>> {
  const rows = await db
    .select({
      sectionId: adPlacements.sectionId,
      gameSlug: subjects.slug,
      topicSlug: adPlacements.promotedTopicSlug,
      advertiser: adPlacements.advertiserName,
    })
    .from(adPlacements)
    .leftJoin(subjects, eq(subjects.id, adPlacements.promotedSubjectId))
    .where(and(isNotNull(adPlacements.sectionId), liveWindow(now)))
    .orderBy(
      sql`${adPlacements.startsAt} ASC NULLS FIRST`,
      adPlacements.createdAt,
      adPlacements.id,
    );
  const out = new Map<string, { ref: string; advertiser: string; kind: 'game' | 'story' }[]>();
  for (const r of rows) {
    if (!r.sectionId) continue;
    const item = r.topicSlug
      ? { ref: `t:${r.topicSlug}`, advertiser: r.advertiser, kind: 'story' as const }
      : r.gameSlug
        ? { ref: `g:${r.gameSlug}`, advertiser: r.advertiser, kind: 'game' as const }
        : null;
    if (!item) continue;
    const list = out.get(r.sectionId) ?? [];
    list.push(item);
    out.set(r.sectionId, list);
  }
  return out;
}

/**
 * A slug → advertiser map for every game with an ACTIVE promotion (Upcoming
 * enrichment). Lets the Upcoming view mark a PAID Promoted entry AND name the
 * advertiser for the render-forced "Promoted · <advertiser>" label — the same
 * always-labeled transparency as the game-page badge. Leak-proof (slug +
 * advertiser display name only; never price / contact / notes).
 */
export async function activeGamePromotions(now: Date = new Date()): Promise<Map<string, string>> {
  const rows = await db
    .select({ slug: subjects.slug, advertiser: adPlacements.advertiserName })
    .from(adPlacements)
    .innerJoin(subjects, eq(subjects.id, adPlacements.promotedSubjectId))
    .where(liveWindow(now));
  const map = new Map<string, string>();
  for (const r of rows) if (r.slug && !map.has(r.slug)) map.set(r.slug, r.advertiser);
  return map;
}

// ── admin views (aggregate, staff-only) ──────────────────────────────────────
export interface InventoryRow {
  slotKey: string;
  label: string;
  page: string;
  format: string;
  fallback: string;
  state: 'active' | 'scheduled' | 'free';
  placement: {
    advertiser: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
  } | null;
}

/** Every slot + its current occupancy (active > scheduled > free). */
export async function inventory(now: Date = new Date()): Promise<InventoryRow[]> {
  const slots = await db
    .select({
      id: adSlots.id,
      key: adSlots.key,
      label: adSlots.label,
      page: adSlots.page,
      format: adSlots.format,
      fallback: adSlots.fallback,
    })
    .from(adSlots)
    .where(eq(adSlots.isActive, true))
    .orderBy(adSlots.page, adSlots.sort);

  const rows: InventoryRow[] = [];
  for (const s of slots) {
    const placements = await db
      .select({
        advertiser: adPlacements.advertiserName,
        status: adPlacements.status,
        startsAt: adPlacements.startsAt,
        endsAt: adPlacements.endsAt,
      })
      .from(adPlacements)
      .where(eq(adPlacements.slotId, s.id))
      .orderBy(desc(adPlacements.updatedAt));
    const active = placements.find(
      (p) =>
        p.status === 'active' &&
        (!p.startsAt || p.startsAt <= now) &&
        (!p.endsAt || p.endsAt >= now),
    );
    const scheduled = placements.find((p) => p.status === 'scheduled');
    const chosen = active ?? scheduled ?? null;
    rows.push({
      slotKey: s.key,
      label: s.label,
      page: s.page,
      format: s.format,
      fallback: s.fallback,
      state: active ? 'active' : scheduled ? 'scheduled' : 'free',
      placement: chosen
        ? {
            advertiser: chosen.advertiser,
            status: chosen.status,
            startsAt: chosen.startsAt ? chosen.startsAt.toISOString() : null,
            endsAt: chosen.endsAt ? chosen.endsAt.toISOString() : null,
          }
        : null,
    });
  }
  return rows;
}

export interface SlotAnalytics {
  slotKey: string;
  label: string;
  impressions: number;
  clicks: number;
  ctr: number; // clicks / impressions
  placements: number;
  occupied: boolean;
}

/** Per-slot aggregate analytics (impressions/clicks/occupancy). No per-user data. */
export async function adAnalytics(): Promise<{
  slots: SlotAnalytics[];
  totals: { slots: number; free: number; impressions: number; clicks: number };
}> {
  const rows = await db
    .select({
      slotKey: adSlots.key,
      label: adSlots.label,
      impressions: sql<string>`coalesce(sum(${adPlacements.impressions}), 0)`,
      clicks: sql<string>`coalesce(sum(${adPlacements.clicks}), 0)`,
      placements: sql<string>`count(${adPlacements.id})`,
      active: sql<string>`count(*) filter (where ${adPlacements.status} = 'active')`,
    })
    .from(adSlots)
    .leftJoin(adPlacements, eq(adPlacements.slotId, adSlots.id))
    .where(eq(adSlots.isActive, true))
    .groupBy(adSlots.id, adSlots.key, adSlots.label, adSlots.sort, adSlots.page)
    .orderBy(adSlots.page, adSlots.sort);

  let impTotal = 0;
  let clkTotal = 0;
  let free = 0;
  const slots = rows.map((r) => {
    const impressions = Number(r.impressions);
    const clicks = Number(r.clicks);
    const occupied = Number(r.active) > 0;
    impTotal += impressions;
    clkTotal += clicks;
    if (!occupied) free += 1;
    return {
      slotKey: r.slotKey,
      label: r.label,
      impressions,
      clicks,
      ctr: impressions > 0 ? Math.round((clicks / impressions) * 1000) / 10 : 0,
      placements: Number(r.placements),
      occupied,
    };
  });
  return { slots, totals: { slots: slots.length, free, impressions: impTotal, clicks: clkTotal } };
}

// ── admin-only promotion pricing reference (Upcoming enrichment, decision 4) ──
export interface PromoPricing {
  note: string | null;
  tiers: { label: string; priceCents: number | null; currency: string; note: string | null }[];
}

const PROMO_PRICING_KEY = 'promo-pricing';
const EMPTY_PRICING: PromoPricing = { note: null, tiers: [] };

/**
 * The internal promotion pricing reference. RBAC-gated (the `ads` admin section
 * = admin-40) and NEVER returned by any public route — staff read it only when
 * preparing an off-site offer. Coerced defensively from stored JSON.
 */
export async function getPromoPricing(): Promise<PromoPricing> {
  try {
    const [row] = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, PROMO_PRICING_KEY))
      .limit(1);
    const raw = (row?.value ?? {}) as Record<string, unknown>;
    const tiers = Array.isArray(raw.tiers) ? raw.tiers : [];
    return {
      note: typeof raw.note === 'string' ? raw.note : null,
      tiers: tiers.slice(0, 20).map((t) => {
        const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>;
        return {
          label: typeof o.label === 'string' ? o.label : '',
          priceCents: typeof o.priceCents === 'number' ? o.priceCents : null,
          currency: typeof o.currency === 'string' ? o.currency : 'USD',
          note: typeof o.note === 'string' ? o.note : null,
        };
      }),
    };
  } catch {
    return { ...EMPTY_PRICING };
  }
}

/** Set the internal pricing reference (audited). Admin-only; never public. */
export async function setPromoPricing(
  input: PromoPricingInput,
  actor: AuditActor,
): Promise<PromoPricing> {
  const value = {
    note: input.note ?? null,
    tiers: (input.tiers ?? []).map((t) => ({
      label: t.label,
      priceCents: t.priceCents ?? null,
      currency: t.currency,
      note: t.note ?? null,
    })),
  };
  await db
    .insert(appSettings)
    .values({ key: PROMO_PRICING_KEY, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  await writeAudit({
    action: 'update',
    entityType: 'app-settings',
    entityId: PROMO_PRICING_KEY,
    changes: { tiers: { to: value.tiers.length } },
    summary: `updated promotion pricing reference (${value.tiers.length} tier(s))`,
    actor,
  });
  return value;
}

/** Admin manually sets a placement's status (the activation switch). Audited. */
export async function setPlacementStatus(
  id: string,
  status: AdPlacementStatus,
  actor: AuditActor,
): Promise<{ status: string } | null> {
  const [before] = await db
    .select({ status: adPlacements.status, advertiserName: adPlacements.advertiserName })
    .from(adPlacements)
    .where(eq(adPlacements.id, id))
    .limit(1);
  if (!before) return null;
  await db
    .update(adPlacements)
    .set({ status, updatedAt: new Date() })
    .where(eq(adPlacements.id, id));
  await writeAudit({
    action: 'update',
    entityType: 'ad-placement',
    entityId: id,
    changes: { status: { from: before.status, to: status } },
    summary: `ad placement "${before.advertiserName}" → ${status}`,
    actor,
  });
  return { status };
}
