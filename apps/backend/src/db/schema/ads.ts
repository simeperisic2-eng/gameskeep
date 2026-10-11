import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import {
  adPlacementStatusEnum,
  adSlotFallbackEnum,
  homepageSectionKindEnum,
  subjectTypeEnum,
} from './enums';
import { homepageSections } from './homepage';
import { subjects } from './subjects';
import { primaryId, timestamps } from './_shared';

/**
 * Ad / promotion inventory (SPEC I8, Slice 2; BLUEPRINT §2.10 + the Part-3 slot
 * rule). Monetization-ready structure with NO payment gateway (owner decision):
 * billing is off-site and a placement is activated MANUALLY by an admin. Every
 * `AdSlot` on the site references an `ad_slots.key`; an ACTIVE `ad_placements`
 * row fills that slot with its (UGC, escaped-on-render) creative + a mandatory
 * Promoted label; otherwise the slot shows its unsold fallback.
 */
export const adSlots = pgTable(
  'ad_slots',
  {
    id: primaryId(),
    /** Stable key the site's AdSlot references (e.g. `home-hero`, `game-sidebar`). */
    key: varchar('key', { length: 80 }).notNull().unique(),
    label: varchar('label', { length: 160 }).notNull(),
    /** Where it lives (home / game / topic / sources / upcoming / awards / catalog). */
    page: varchar('page', { length: 60 }).notNull(),
    /** The slot's content format (banner / card / sidebar / hero) — display hint. */
    format: varchar('format', { length: 40 }).notNull().default('card'),
    /** Unsold fallback: the demo "AD" box, page-native organic content, or hide. */
    fallback: adSlotFallbackEnum('fallback').notNull().default('ad'),
    isActive: boolean('is_active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    ...timestamps(),
  },
  (t) => [index('ad_slots_page_idx').on(t.page)],
);

/**
 * A booking on a slot. `status` is ADMIN-SET (draft → scheduled → active → ended)
 * after off-site payment — there is no gateway. The creative is USER-GENERATED
 * (advertiser-supplied) so it is stored raw and rendered ESCAPED; input is
 * validated (URL scheme + lengths). `promotedSubjectId` links a "Promote a game"
 * placement to its game so the game page can show a Promoted badge. `impressions`
 * / `clicks` are aggregate counters (mock in demo; a batched counter feeds them
 * in production — never a per-render write).
 */
export const adPlacements = pgTable(
  'ad_placements',
  {
    id: primaryId(),
    // TARGET: exactly one of a page slot or a homepage DISCOVERY section (S2).
    slotId: uuid('slot_id').references(() => adSlots.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id'),
    /** Always 'discovery' when set — with the composite FK this makes a data
     *  section unreferenceable: the DB rejects selling it (S2). */
    sectionKind: homepageSectionKindEnum('section_kind'),
    advertiserName: varchar('advertiser_name', { length: 160 }).notNull(),
    advertiserContact: varchar('advertiser_contact', { length: 200 }),
    // ── UGC creative (escaped on render, validated on input) ──
    headline: varchar('headline', { length: 120 }).notNull(),
    body: varchar('body', { length: 400 }),
    ctaUrl: text('cta_url'),
    ctaLabel: varchar('cta_label', { length: 60 }),
    // Optional link to the promoted game (drives the game-page Promoted badge).
    promotedSubjectId: uuid('promoted_subject_id').references(() => subjects.id, {
      onDelete: 'set null',
    }),
    /** 'game' (the default) — with the composite FK only a GAME can be promoted;
     *  stories are never promotable anywhere (S2). Unchecked while the id is null. */
    promotedSubjectType: subjectTypeEnum('promoted_subject_type').default('game'),
    status: adPlacementStatusEnum('status').notNull().default('draft'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    // Pricing is recorded for the arrangement; there is NO on-site charge.
    priceCents: integer('price_cents'),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    // Aggregate analytics counters (no per-user data).
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    // Admin notes about the off-site payment arrangement.
    notes: text('notes'),
    ...timestamps(),
  },
  (t) => [
    index('ad_placements_slot_idx').on(t.slotId),
    index('ad_placements_status_idx').on(t.status),
    index('ad_placements_subject_idx').on(t.promotedSubjectId),
    index('ad_placements_section_idx').on(t.sectionId),
    // Paid placements may target DISCOVERY sections only: (section, kind) must
    // exist in homepage_sections AND kind must be 'discovery'.
    foreignKey({
      name: 'ad_placements_section_discovery_fk',
      columns: [t.sectionId, t.sectionKind],
      foreignColumns: [homepageSections.id, homepageSections.kind],
    }), // no cascade: a section is never deleted, and its billing records must not be
    check(
      'ad_placements_section_kind_discovery',
      sql`section_kind IS NULL OR section_kind = 'discovery'`,
    ),
    check('ad_placements_section_pair', sql`(section_id IS NULL) = (section_kind IS NULL)`),
    check('ad_placements_one_target', sql`num_nonnulls(slot_id, section_id) = 1`),
    // Only a GAME can be promoted: (subject, type) must exist with type = game.
    foreignKey({
      name: 'ad_placements_promoted_game_fk',
      columns: [t.promotedSubjectId, t.promotedSubjectType],
      foreignColumns: [subjects.id, subjects.type],
    }).onDelete('set null'),
    check(
      'ad_placements_promoted_game',
      sql`promoted_subject_type IS NULL OR promoted_subject_type = 'game'`,
    ),
    // At most ONE active Promoted item per discovery section.
    uniqueIndex('ad_placements_one_active_per_section')
      .on(t.sectionId)
      .where(sql`section_id IS NOT NULL AND status = 'active'`),
  ],
);
