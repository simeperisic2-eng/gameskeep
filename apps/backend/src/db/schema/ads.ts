import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { adPlacementStatusEnum, adSlotFallbackEnum } from './enums';
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
    slotId: uuid('slot_id')
      .notNull()
      .references(() => adSlots.id, { onDelete: 'cascade' }),
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
  ],
);
