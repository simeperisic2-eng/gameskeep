import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type { CommunityBurstInfo } from '@gameskeep/shared/constants';
import {
  aiAssetFlagEnum,
  externalRatingKindEnum,
  gameStatusEnum,
  launchStateFlagEnum,
  sysReqKindEnum,
  upcomingOverrideEnum,
  videoProviderEnum,
} from './enums';
import { sources } from './sources';
import { subjects } from './subjects';
import { users } from './users';
import { primaryId, timestamps } from './_shared';

/** Stored disconnect sub-levels (SPEC I4b §2) — primary + the two detail gaps. */
export interface DisconnectDetail {
  ourVsCritics: number | null;
  communityVsWeb: number | null;
}

/**
 * Game — a Subject specialization (BLUEPRINT 2.3). The `games` row holds
 * game-specific metadata; everything that's a list or analytic lives in a
 * related table below (ratings, review, flags, videos, prices, player counts)
 * rather than being crammed into one wide row. Identity (name/slug) lives on
 * the parent `subjects` row. Ratings/analytics are stored 0..100 internally;
 * the 1–10 one-decimal display is a frontend concern.
 */
export const games = pgTable(
  'games',
  {
    id: primaryId(),
    subjectId: uuid('subject_id')
      .notNull()
      .unique()
      .references(() => subjects.id, { onDelete: 'cascade' }),

    coverUrl: text('cover_url'),
    backgroundUrl: text('background_url'), // press/public hero image
    summary: varchar('summary', { length: 600 }),
    description: text('description'),
    status: gameStatusEnum('status').notNull().default('announced'),
    releaseDate: text('release_date'), // YYYY-MM-DD (nullable, often partial/unknown)
    developer: varchar('developer', { length: 200 }),
    publisher: varchar('publisher', { length: 200 }),
    engine: varchar('engine', { length: 120 }),
    ageRatingSystem: varchar('age_rating_system', { length: 40 }), // PEGI / ESRB
    ageRatingValue: varchar('age_rating_value', { length: 40 }),
    series: varchar('series', { length: 200 }),
    mode: text('mode').array(), // singleplayer / multiplayer / co-op
    genres: text('genres').array(),
    platforms: text('platforms').array(),
    tags: text('tags').array(), // souls-like, roguelike, ...
    screenshots: text('screenshots').array(),
    socialLinks: jsonb('social_links').$type<Record<string, string>>(),

    steamAppId: integer('steam_app_id'),
    hltbMainHours: real('hltb_main_hours'),
    hltbCompletionistHours: real('hltb_completionist_hours'),
    steamCompletionRate: real('steam_completion_rate'),

    // Provider id mapping (I2): { igdb, rawg, steam, mock } — lets the live
    // IGDB/RAWG path round-trip and de-dupe by external id with no migration.
    externalRefs: jsonb('external_refs').$type<Record<string, string | number>>(),

    // Upcoming enrichment (AUTO + MANUAL OVERRIDE). A game shows in Upcoming
    // automatically by pre-release STATUS; `upcomingOverride` lets an admin force
    // it: 'show' (include regardless of status) / 'hide' (exclude) / null (auto).
    // `upcomingFeatured` is an EDITORIAL, UNLABELED curatorial pin (distinct from
    // the PAID Promoted flag, which is the always-labeled I8 ad-placement).
    // `isIndie` is an editor-set property/filter (indie is a label, not a page).
    upcomingOverride: upcomingOverrideEnum('upcoming_override'),
    upcomingFeatured: boolean('upcoming_featured').notNull().default(false),
    isIndie: boolean('is_indie').notNull().default(false),

    ...timestamps(),
  },
  (t) => [index('games_status_idx').on(t.status)],
);

/**
 * Our review — lives ONLY here, never in the article feed (BLUEPRINT 2.3).
 * One review = one score = one game (enforced by the unique game_id).
 */
export const gameReviews = pgTable('game_reviews', {
  id: primaryId(),
  gameId: uuid('game_id')
    .notNull()
    .unique()
    .references(() => games.id, { onDelete: 'cascade' }),
  authorUserId: uuid('author_user_id').references(() => users.id, { onDelete: 'set null' }),
  verdict: varchar('verdict', { length: 400 }),
  pros: text('pros').array(),
  cons: text('cons').array(),
  platformTested: varchar('platform_tested', { length: 120 }),
  hoursPlayed: real('hours_played'),
  body: text('body'),
  ourScore: smallint('our_score'), // 0..100
  publishedAt: timestamp('published_at', { withTimezone: true }),
  ...timestamps(),
});

/** Individual media-critic entries (aggregate is computed in I4). */
export const gameCriticReviews = pgTable(
  'game_critic_reviews',
  {
    id: primaryId(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    outletName: varchar('outlet_name', { length: 200 }).notNull(),
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
    score: smallint('score').notNull(), // 0..100 (normalized; the canonical value)
    // Optional native scale (I4b): when both set, the engine normalizes
    // nativeScore/nativeScaleMax → 0..100; lets "8/10" be stored + shown.
    nativeScore: real('native_score'),
    nativeScaleMax: smallint('native_scale_max'),
    excerpt: text('excerpt'),
    url: text('url'),
    reviewDate: text('review_date'), // YYYY-MM-DD
    ...timestamps(),
  },
  (t) => [index('game_critic_reviews_game_idx').on(t.gameId)],
);

/**
 * Our-community ratings (verified users). One rating per user per game,
 * enforced at the DB level (BLUEPRINT 2.6; SPEC verification #3).
 */
export const gameUserRatings = pgTable(
  'game_user_ratings',
  {
    id: primaryId(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    score: smallint('score').notNull(), // 0..100
    // Per-vote CREDIBILITY weight 0 → 1.0 (I4b): computed by the engine from the
    // voter's email/activity/age. Unproven votes → ~0; proven → 1.0. Never > 1.0.
    weight: real('weight').notNull().default(1),
    // When the vote was cast (I4b burst timing) — the engine reads THIS, not
    // createdAt, so historical imports + the review-bomb test simulate a timeline.
    ratedAt: timestamp('rated_at', { withTimezone: true }).notNull().defaultNow(),
    // Verified-playtime SLOT (defensive layer 3) — structure only; wired to Steam
    // in production, no verification logic in demo.
    hasVerifiedPlaytime: boolean('has_verified_playtime').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('game_user_rating_unique').on(t.gameId, t.userId),
    index('game_user_rating_game_rated_idx').on(t.gameId, t.ratedAt),
  ],
);

/** "Across the web" references — Steam % auto + editor notes for Reddit/others. */
export const gameExternalRatings = pgTable(
  'game_external_ratings',
  {
    id: primaryId(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    kind: externalRatingKindEnum('kind').notNull(),
    label: varchar('label', { length: 300 }).notNull(),
    score: smallint('score'), // 0..100 (nullable — may be sentiment-only)
    sentimentPct: real('sentiment_pct'),
    sampleSize: integer('sample_size'),
    isEstimate: boolean('is_estimate').notNull().default(true),
    note: text('note'),
    url: text('url'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [index('game_external_ratings_game_idx').on(t.gameId)],
);

/**
 * Computed ratings summary + disconnect (BLUEPRINT 2.3). All nullable now —
 * filled by the rating/disconnect engine in I4 with NO further migration.
 */
export const gameRatingSummaries = pgTable('game_rating_summaries', {
  id: primaryId(),
  gameId: uuid('game_id')
    .notNull()
    .unique()
    .references(() => games.id, { onDelete: 'cascade' }),
  // --- AUTO computed layers (recomputed on every re-tune; null = NO DATA, ≠ 0) ---
  ourScore: smallint('our_score'),
  criticsScore: smallint('critics_score'),
  criticsOutletCount: integer('critics_outlet_count'),
  // Community "Our" — weighted (anti-manipulation) + the naive unweighted mean
  // stored alongside it so naive-vs-weighted is inspectable + provable.
  communityOurScore: smallint('community_our_score'),
  communityOurNaiveScore: smallint('community_our_naive_score'),
  communityOurCount: integer('community_our_count'),
  communityWebScore: smallint('community_web_score'),
  // "Unusual activity" — VISIBLE flag (never silent) + the burst breakdown.
  communityBurstFlag: boolean('community_burst_flag').notNull().default(false),
  communityBurstInfo: jsonb('community_burst_info').$type<CommunityBurstInfo>(),
  // Disconnect (auto arithmetic) + sub-levels; context tag is EDITOR-ONLY.
  disconnectValue: smallint('disconnect_value'),
  disconnectBand: varchar('disconnect_band', { length: 20 }),
  disconnectDetail: jsonb('disconnect_detail').$type<DisconnectDetail>(),
  disconnectContextTag: varchar('disconnect_context_tag', { length: 200 }),
  // --- EDITOR overrides (auto value retained underneath; survive a re-tune) ---
  criticsOverride: smallint('critics_override'),
  criticsOverrideReason: text('critics_override_reason'),
  communityOverride: smallint('community_override'),
  communityOverrideReason: text('community_override_reason'),
  burstFlagOverride: boolean('burst_flag_override'), // null = use auto
  burstFlagOverrideReason: text('burst_flag_override_reason'),
  computedAt: timestamp('computed_at', { withTimezone: true }),
  ...timestamps(),
});

/** Content Flags — factual, game-level (BLUEPRINT 2.3). One row per game. */
export const gameContentFlags = pgTable('game_content_flags', {
  id: primaryId(),
  gameId: uuid('game_id')
    .notNull()
    .unique()
    .references(() => games.id, { onDelete: 'cascade' }),
  aiAssets: aiAssetFlagEnum('ai_assets').notNull().default('unknown'),
  launchState: launchStateFlagEnum('launch_state').notNull().default('unknown'),
  hasMicrotransactions: boolean('has_microtransactions').notNull().default(false),
  hasBattlePass: boolean('has_battle_pass').notNull().default(false),
  hasLootBoxesOrGacha: boolean('has_loot_boxes_or_gacha').notNull().default(false),
  predatoryMonetization: boolean('predatory_monetization').notNull().default(false),
  complexityRating: smallint('complexity_rating'), // 1..5, where known (null = unknown)
  notes: text('notes'),
  ...timestamps(),
});

/**
 * DLC list (BLUEPRINT 2.3) — name + price, reusing the price shape. Shown only
 * where it exists (the "data exists?" display rule). Filled by editors / I2 later.
 */
export const gameDlc = pgTable(
  'game_dlc',
  {
    id: primaryId(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    priceCents: integer('price_cents'),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    releaseDate: text('release_date'), // YYYY-MM-DD
    url: text('url'),
    ...timestamps(),
  },
  (t) => [index('game_dlc_game_idx').on(t.gameId)],
);

/**
 * Community-reported content-flag values (BLUEPRINT 2.3 "community-report + vote
 * option, like FPS"). STRUCTURE-ONLY slot in I4b — no aggregation/promotion logic
 * yet (mirrors the verified-playtime deferral). The slot exists so I5/I6 can wire
 * reporting + voting without a migration.
 */
export const gameFlagReports = pgTable(
  'game_flag_reports',
  {
    id: primaryId(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    flagKey: varchar('flag_key', { length: 40 }).notNull(),
    suggestedValue: varchar('suggested_value', { length: 80 }).notNull(),
    reporterUserId: uuid('reporter_user_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('game_flag_reports_game_idx').on(t.gameId)],
);

/** Videos & streams (YouTube/Twitch). Editor pin/override (BLUEPRINT 2.3). */
export const gameVideos = pgTable(
  'game_videos',
  {
    id: primaryId(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    provider: videoProviderEnum('provider').notNull().default('youtube'),
    videoUrl: text('video_url').notNull(),
    title: varchar('title', { length: 300 }),
    // A2: channel + thumbnail from the provider (YouTube Data API in production;
    // null in demo → the frontend renders its designed placeholder, no broken
    // network image offline). Thumbnails LINK OUT — never an embedded player.
    channel: varchar('channel', { length: 120 }),
    thumbnailUrl: text('thumbnail_url'),
    kind: varchar('kind', { length: 40 }).notNull().default('gameplay'),
    isPinned: boolean('is_pinned').notNull().default(false),
    isLive: boolean('is_live').notNull().default(false),
    sort: integer('sort').notNull().default(0),
    ...timestamps(),
  },
  (t) => [index('game_videos_game_idx').on(t.gameId)],
);

/** Prices per store/platform + discount tracking (BLUEPRINT 2.3). */
export const gamePrices = pgTable(
  'game_prices',
  {
    id: primaryId(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    store: varchar('store', { length: 80 }).notNull().default('steam'),
    platform: varchar('platform', { length: 80 }),
    currency: varchar('currency', { length: 3 }).notNull().default('USD'),
    priceCents: integer('price_cents').notNull(),
    discountPct: smallint('discount_pct').notNull().default(0),
    isOnSale: boolean('is_on_sale').notNull().default(false),
    url: text('url'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [index('game_prices_game_idx').on(t.gameId)],
);

/** System requirements (min/recommended) per platform (BLUEPRINT 2.3). */
export const gameSystemRequirements = pgTable(
  'game_system_requirements',
  {
    id: primaryId(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    platform: varchar('platform', { length: 80 }).notNull().default('pc'),
    kind: sysReqKindEnum('kind').notNull(),
    cpu: varchar('cpu', { length: 200 }),
    gpu: varchar('gpu', { length: 200 }),
    ramGb: integer('ram_gb'),
    storageGb: integer('storage_gb'),
    os: varchar('os', { length: 200 }),
    notes: text('notes'),
    ...timestamps(),
  },
  (t) => [index('game_sysreq_game_idx').on(t.gameId)],
);

/** Player-count history (Steam only; BLUEPRINT 2.3). Empty until later phases. */
export const gamePlayerCounts = pgTable(
  'game_player_counts',
  {
    id: primaryId(),
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    source: varchar('source', { length: 40 }).notNull().default('steam'),
    currentPlayers: integer('current_players'),
    peakPlayers: integer('peak_players'),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('game_player_counts_game_idx').on(t.gameId, t.capturedAt)],
);
