import { z } from 'zod';
import {
  AD_PLACEMENT_STATUSES,
  AD_SLOT_FALLBACKS,
  AI_ASSET_FLAGS,
  ARTICLE_ORIGINS,
  ARTICLE_TYPES,
  AWARD_CATEGORY_KINDS,
  AWARD_OUTCOME_TYPES,
  AWARD_PHASES,
  CONSENT_TYPES,
  EXTERNAL_RATING_KINDS,
  GAME_STATUSES,
  LAUNCH_STATE_FLAGS,
  SOURCE_STATUSES,
  SUBJECT_TYPES,
  TOPIC_STATUSES,
  UNMATCHED_STATUSES,
  USER_STATUSES,
  VIDEO_PROVIDERS,
} from './constants';

/**
 * Input validation schemas for the admin API — the single place where staff
 * input is checked before it touches the database (CLAUDE.md: "validate and
 * sanitize ALL input"). Backend maps these to Drizzle inserts; types are
 * inferred so backend and (later) frontend stay in lockstep.
 *
 * Each resource exposes a `*Create` schema. Update schemas are derived as
 * `.partial()` in the backend registry so every field becomes optional on PATCH.
 */

// ── reusable field validators ────────────────────────────────────────────────
const slug = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug (a-z, 0-9, hyphens)');

/** Slug is optional on input — the backend derives one from the name if absent. */
const optionalSlug = slug.optional();
const shortText = z.string().min(1).max(300);
const longText = z.string().max(20_000);
const url = z.string().url().max(2048);
const uuid = z.string().uuid();
const score0to100 = z.number().int().min(0).max(100);
const weight0to1 = z.number().min(0).max(1);
const sort = z.number().int().min(0).max(100_000).default(0);
const stringArray = z.array(z.string().min(1).max(160)).max(100);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');

/**
 * Provider id mapping for a game (I2), e.g. `{ igdb: "1234", rawg: "5678",
 * mock: "the-witcher-3" }`. Lets the live IGDB/RAWG path round-trip and de-dupe
 * by external id without another migration. Values are strings or numbers.
 */
const externalRefs = z.record(z.string().max(40), z.union([z.string().max(200), z.number()]));

// ── extensible lists (lookup tables) ─────────────────────────────────────────
const listKey = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/, 'must be a lowercase key (a-z, 0-9, - or _)');

export const roleCreate = z.object({
  key: listKey,
  label: shortText,
  rank: z.number().int().min(0).max(1000),
  isStaff: z.boolean().default(false),
  sort,
});

export const userLevelCreate = z.object({
  key: listKey,
  label: shortText,
  rank: z.number().int().min(0).max(1000),
  sort,
});

export const topicTypeCreate = z.object({
  key: listKey,
  label: shortText,
  description: longText.optional(),
  sort,
  isActive: z.boolean().default(true),
});

export const sourceTypeCreate = z.object({
  key: listKey,
  label: shortText,
  sort,
  isActive: z.boolean().default(true),
});

export const badgeCreate = z.object({
  key: listKey,
  label: shortText,
  description: longText.optional(),
  iconUrl: url.optional(),
  sort,
  isActive: z.boolean().default(true),
});

export const awardCategoryCreate = z.object({
  key: listKey,
  label: shortText,
  description: longText.optional(),
  kind: z.enum(AWARD_CATEGORY_KINDS).default('general'),
  sort,
  isActive: z.boolean().default(true),
});

// ── core models ──────────────────────────────────────────────────────────────
export const subjectCreate = z.object({
  type: z.enum(SUBJECT_TYPES),
  slug: optionalSlug,
  name: shortText,
  description: longText.optional(),
});

export const gameCreate = z.object({
  // A Game is a Subject specialization — creating one creates its Subject too.
  name: shortText,
  slug: optionalSlug,
  summary: z.string().max(600).optional(),
  description: longText.optional(),
  status: z.enum(GAME_STATUSES).default('announced'),
  releaseDate: isoDate.optional(),
  developer: z.string().max(200).optional(),
  publisher: z.string().max(200).optional(),
  engine: z.string().max(120).optional(),
  ageRatingSystem: z.string().max(40).optional(),
  ageRatingValue: z.string().max(40).optional(),
  series: z.string().max(200).optional(),
  mode: stringArray.optional(),
  genres: stringArray.optional(),
  platforms: stringArray.optional(),
  tags: stringArray.optional(),
  screenshots: z.array(url).max(50).optional(),
  coverUrl: url.optional(),
  backgroundUrl: url.optional(),
  socialLinks: z.record(z.string().max(60), url).optional(),
  steamAppId: z.number().int().positive().optional(),
  hltbMainHours: z.number().min(0).max(100_000).optional(),
  hltbCompletionistHours: z.number().min(0).max(100_000).optional(),
  steamCompletionRate: z.number().min(0).max(100).optional(),
  externalRefs: externalRefs.optional(),
});

export const sourceCreate = z.object({
  name: shortText,
  slug: optionalSlug,
  logoUrl: url.optional(),
  websiteUrl: url.optional(),
  rssUrl: url.optional(),
  description: longText.optional(),
  typeId: uuid.optional(),
  parentCompany: z.string().max(200).optional(),
  status: z.enum(SOURCE_STATUSES).default('active'),
  adapterKey: z.string().max(80).default('rss-generic'),
  pullFrequencyMinutes: z.number().int().min(1).max(100_000).default(60),
  pullDepth: z.number().int().min(1).max(1000).default(25),
  pullEnabled: z.boolean().default(true),
  reputationBaseline: weight0to1.optional(),
  reputationCommercial: weight0to1.optional(),
  reputationGeneral: weight0to1.optional(),
});

export const topicCreate = z.object({
  title: shortText,
  slug: optionalSlug,
  tldr: z.string().max(400).optional(),
  aiSummary: longText.optional(),
  status: z.enum(TOPIC_STATUSES).default('developing'),
  typeId: uuid.optional(),
});

/** Base article shape (no cross-field rule) — reused for the PATCH/update schema. */
export const articleBase = z.object({
  title: shortText,
  slug: optionalSlug,
  origin: z.enum(ARTICLE_ORIGINS).default('aggregated'),
  articleType: z.enum(ARTICLE_TYPES).default('news'),
  sourceId: uuid.optional(),
  author: z.string().max(200).optional(),
  url: url.optional(),
  thumbnailUrl: url.optional(),
  excerpt: z.string().max(2000).optional(),
  // Full text is ONLY allowed for our own articles (copyright — BLUEPRINT 2.2).
  body: longText.optional(),
  aiSummary: longText.optional(),
  publishDate: z.coerce.date().optional(),
  isPaywalled: z.boolean().default(false),
  hasAffiliateLinks: z.boolean().default(false),
  isSponsored: z.boolean().default(false),
  basedOnReviewCopy: z.boolean().default(false),
  influenceScore: score0to100.optional(),
  qualityScore: score0to100.optional(),
  internalAssessment: z.string().max(5000).optional(),
});

export const articleCreate = articleBase.refine((a) => a.origin === 'ours' || !a.body, {
  message: 'Only "ours" articles may store full body text (copyright).',
  path: ['body'],
});

// On PATCH only the sent fields are applied; the body/origin invariant is also
// guarded at the DB level (CHECK articles_body_only_ours), so partial is safe.
export const articleUpdate = articleBase.partial();

export const userCreate = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, 'letters, numbers and underscores only'),
  email: z.string().email().max(254),
  displayName: z.string().max(80).optional(),
  avatarUrl: url.optional(),
  bio: z.string().max(2000).optional(),
  roleId: uuid,
  levelId: uuid.optional(),
  reputation: z.number().int().min(0).default(0),
  isEmailVerified: z.boolean().default(false),
  status: z.enum(USER_STATUSES).default('active'),
});

// ── auth (SPEC I6, Slice 1) ──────────────────────────────────────────────────
export const authRegisterInput = z.object({
  username: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/, 'letters, numbers and underscores only'),
  email: z.string().email().max(254),
  password: z.string().min(8, 'at least 8 characters').max(200),
});

export const authLoginInput = z.object({
  /** Username OR email — resolved server-side to ONE stable account. */
  identifier: z.string().min(1).max(254),
  password: z.string().min(1).max(200),
});

// ── auth email flows (SPEC I6, Slice 2) ──────────────────────────────────────
/** Request a verification or password-reset email (enumeration-safe endpoints). */
export const authEmailRequestInput = z.object({
  email: z.string().email().max(254),
});

/** A single-use email token — 256-bit, hex-encoded (shape-gated before any DB hit). */
const emailToken = z.string().regex(/^[a-f0-9]{64}$/, 'invalid token');

/** Confirm an email address with the token from the verification link. */
export const authVerifyEmailInput = z.object({ token: emailToken });

/** Set a new password using the token from the reset link. */
export const authResetPasswordInput = z.object({
  token: emailToken,
  password: z.string().min(8, 'at least 8 characters').max(200),
});

// ── community writes (SPEC I6, Slice 4) ──────────────────────────────────────
// PUBLIC, session-scoped schemas: the acting user comes from the session (never
// the body), and per-vote credibility WEIGHT is computed by the engine (never
// the client) — unlike the admin-shaped `gameUserRatingCreate` which trusts a
// caller-supplied userId/weight. Everything one-per-user, verified-email gated.
export const COMMENT_ENTITY_TYPES = ['topic', 'article', 'game'] as const;
export const BIAS_AXES = ['influence', 'quality', 'trust'] as const;
export const REACTION_KINDS = ['like', 'insightful', 'funny', 'disagree'] as const;

/** Rate a game 0..100 (the acting user is the session; weight is engine-computed). */
export const communityRatingInput = z.object({ score: score0to100 });

/** Article trust vote — "felt honest" (+1) vs "felt like paid hype" (−1). */
export const communityTrustVoteInput = z.object({
  value: z.union([z.literal(1), z.literal(-1)]),
});

/** Topic bias vote on one axis — −1 / 0 / +1 (0 clears the stance on that axis). */
export const communityBiasVoteInput = z.object({
  axis: z.enum(BIAS_AXES),
  value: z.union([z.literal(1), z.literal(0), z.literal(-1)]),
});

/** A plain-text comment (stored RAW; escaped at render — decision 8). */
export const communityCommentInput = z.object({
  body: z.string().trim().min(1, 'empty comment').max(4000),
  parentId: uuid.optional(),
});

/** Toggle a reaction of a given kind on an entity (one-per-user-per-kind). */
export const communityReactionInput = z.object({ kind: z.enum(REACTION_KINDS) });

/** Report a comment (optional short reason). One report per user per comment. */
export const communityReportInput = z.object({
  reason: z.string().trim().max(300).optional(),
});

/** The polymorphic comment target (validated route params). */
export const communityEntityParam = z.object({
  entityType: z.enum(COMMENT_ENTITY_TYPES),
  entityId: uuid,
});

/** Reactions may ALSO target a comment — a reaction on a comment is the
 *  "received helpful-vote" that feeds reputation (SPEC I6, Slice 5). */
export const REACTION_ENTITY_TYPES = ['topic', 'article', 'game', 'comment'] as const;
export const reactionEntityParam = z.object({
  entityType: z.enum(REACTION_ENTITY_TYPES),
  entityId: uuid,
});

// ── GDPR (SPEC I6, Slice 7) ──────────────────────────────────────────────────
/** Record a versioned consent (captured with a coarsened IP server-side). */
export const consentInput = z.object({
  consentType: z.enum(CONSENT_TYPES),
  version: z.string().min(1).max(40),
  granted: z.boolean(),
});

/** Account deletion re-confirms the current password (never a session alone). */
export const deleteAccountInput = z.object({
  password: z.string().min(1).max(200),
});

/** Follow a GAME or a TOPIC for "Your Feed" (SPEC I6, Slice 6). The public
 *  surface addresses entities by SLUG; the server resolves it to an id. */
export const FOLLOW_ENTITY_TYPES = ['game', 'topic'] as const;
export const followEntityParam = z.object({
  entityType: z.enum(FOLLOW_ENTITY_TYPES),
  slug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase slug'),
});

// ── game sub-resources (auto + manual override surfaces) ─────────────────────
export const gameReviewCreate = z.object({
  gameId: uuid,
  authorUserId: uuid.optional(),
  verdict: z.string().max(400).optional(),
  pros: stringArray.optional(),
  cons: stringArray.optional(),
  platformTested: z.string().max(120).optional(),
  hoursPlayed: z.number().min(0).max(100_000).optional(),
  body: longText.optional(),
  ourScore: score0to100.optional(),
  publishedAt: z.coerce.date().optional(),
});

export const gameCriticReviewCreate = z.object({
  gameId: uuid,
  outletName: shortText,
  sourceId: uuid.optional(),
  score: score0to100,
  // Optional native scale (I4b): the engine normalizes `nativeScore/nativeScaleMax`
  // → 0..100 when present, else uses `score`. Lets an outlet's "8/10" be stored
  // and shown transparently.
  nativeScore: z.number().min(0).max(1000).optional(),
  nativeScaleMax: z.number().min(1).max(1000).optional(),
  excerpt: z.string().max(2000).optional(),
  url: url.optional(),
  reviewDate: isoDate.optional(),
});

export const gameExternalRatingCreate = z.object({
  gameId: uuid,
  kind: z.enum(EXTERNAL_RATING_KINDS),
  label: shortText,
  score: score0to100.optional(),
  sentimentPct: z.number().min(0).max(100).optional(),
  sampleSize: z.number().int().min(0).optional(),
  isEstimate: z.boolean().default(true),
  note: z.string().max(2000).optional(),
  url: url.optional(),
});

export const gameContentFlagsCreate = z.object({
  gameId: uuid,
  aiAssets: z.enum(AI_ASSET_FLAGS).default('unknown'),
  launchState: z.enum(LAUNCH_STATE_FLAGS).default('unknown'),
  hasMicrotransactions: z.boolean().default(false),
  hasBattlePass: z.boolean().default(false),
  hasLootBoxesOrGacha: z.boolean().default(false),
  predatoryMonetization: z.boolean().default(false),
  complexityRating: z.number().int().min(1).max(5).optional(), // 1..5, where known
  notes: z.string().max(2000).optional(),
});

/** A DLC entry (I4b) — name + price, reusing the price shape; shown only where it exists. */
export const gameDlcCreate = z.object({
  gameId: uuid,
  name: shortText,
  priceCents: z.number().int().min(0).optional(),
  currency: z.string().length(3).default('USD'),
  releaseDate: isoDate.optional(),
  url: url.optional(),
});

/** A community-reported flag value (I4b) — STRUCTURE-ONLY slot; no aggregation logic in demo. */
export const gameFlagReportCreate = z.object({
  gameId: uuid,
  flagKey: z.string().max(40),
  suggestedValue: z.string().max(80),
  reporterUserId: uuid.optional(),
  note: z.string().max(1000).optional(),
});

export const gameVideoCreate = z.object({
  gameId: uuid,
  provider: z.enum(VIDEO_PROVIDERS).default('youtube'),
  videoUrl: url,
  title: z.string().max(300).optional(),
  kind: z.string().max(40).default('gameplay'),
  isPinned: z.boolean().default(false),
  isLive: z.boolean().default(false),
  sort,
});

export const gamePriceCreate = z.object({
  gameId: uuid,
  store: z.string().max(80).default('steam'),
  platform: z.string().max(80).optional(),
  currency: z.string().length(3).default('USD'),
  priceCents: z.number().int().min(0),
  discountPct: z.number().int().min(0).max(100).default(0),
  isOnSale: z.boolean().default(false),
  url: url.optional(),
});

export const gameSystemRequirementCreate = z.object({
  gameId: uuid,
  platform: z.string().max(80).default('pc'),
  kind: z.enum(['minimum', 'recommended']),
  cpu: z.string().max(200).optional(),
  gpu: z.string().max(200).optional(),
  ramGb: z.number().int().min(0).max(100_000).optional(),
  storageGb: z.number().int().min(0).max(100_000).optional(),
  os: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
});

export const gamePlayerCountCreate = z.object({
  gameId: uuid,
  source: z.string().max(40).default('steam'),
  currentPlayers: z.number().int().min(0).optional(),
  peakPlayers: z.number().int().min(0).optional(),
  capturedAt: z.coerce.date().optional(),
});

export const gameUserRatingCreate = z.object({
  gameId: uuid,
  userId: uuid,
  score: score0to100,
  weight: weight0to1.default(1),
  // When the vote was cast (I4b burst timing). Defaults to now; the engine reads
  // this (not createdAt) so historical imports + the review-bomb test can simulate
  // a real timeline.
  ratedAt: z.coerce.date().optional(),
  // Verified-playtime SLOT (I4b layer 3) — structure only; no verification in demo.
  hasVerifiedPlaytime: z.boolean().default(false),
});

export const userBadgeCreate = z.object({
  userId: uuid,
  badgeId: uuid,
});

// ── awards ───────────────────────────────────────────────────────────────────
export const awardEditionCreate = z.object({
  year: z.number().int().min(1970).max(2200),
  name: shortText,
  phase: z.enum(AWARD_PHASES).default('announce'),
  description: longText.optional(),
  votingOpensAt: z.coerce.date().optional(),
  votingClosesAt: z.coerce.date().optional(),
  isPublished: z.boolean().default(false),
});

export const awardEditionCategoryCreate = z.object({
  editionId: uuid,
  categoryId: uuid,
  sponsorSlotLabel: z.string().max(120).optional(),
  sponsorSold: z.boolean().default(false),
  sort,
});

export const awardNominationCreate = z.object({
  editionCategoryId: uuid,
  subjectId: uuid,
  blurb: z.string().max(2000).optional(),
});

export const awardOutcomeCreate = z.object({
  editionCategoryId: uuid,
  outcomeType: z.enum(AWARD_OUTCOME_TYPES),
  nominationId: uuid,
});

export const awardVoteCreate = z.object({
  editionCategoryId: uuid,
  userId: uuid,
  nominationId: uuid,
  weight: weight0to1.default(1),
});

/**
 * Public award-vote body (I7 Slice 1). Unlike `awardVoteCreate` (admin CRUD), a
 * community voter supplies ONLY the nomination — the edition-category is the URL
 * param, the user is the session, and the weight is computed server-side from the
 * voter's credibility (never client-supplied).
 */
export const awardVoteInput = z.object({
  nominationId: uuid,
});

/**
 * Awards "notify me" subscribe (I7 Slice 2). Marketing is a SEPARATE consent, so
 * `consent` MUST be explicitly true — the route rejects a falsey opt-in. Works
 * for anonymous and signed-in subscribers alike.
 */
export const awardSubscribeInput = z.object({
  email: z.string().trim().email().max(320),
  consent: z.boolean(),
});

/** Login-free unsubscribe via the per-row capability token. */
export const awardUnsubscribeInput = z.object({
  token: z.string().min(1).max(64),
});

/** Staff phase transition for an award edition (guarded in the service).
 * `confirm` is required to move BACKWARD (e.g. reopening a decided vote). */
export const awardPhaseInput = z.object({
  phase: z.enum(AWARD_PHASES),
  confirm: z.boolean().optional().default(false),
});

// ── ads / promotions (I8 Slice 2) ────────────────────────────────────────────
export const adSlotCreate = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and hyphens only'),
  label: shortText,
  page: z.string().trim().min(1).max(60),
  format: z.string().trim().max(40).default('card'),
  fallback: z.enum(AD_SLOT_FALLBACKS).default('ad'),
  isActive: z.boolean().default(true),
  sort,
});

/** An http(s) URL for an advertiser CTA (no javascript:/data: — anti-XSS). */
const httpUrl = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL');

/** Advertiser-supplied creative is UGC: validated here, stored raw, escaped on render. */
export const adPlacementCreate = z.object({
  slotId: uuid,
  advertiserName: shortText,
  advertiserContact: z.string().trim().max(200).optional(),
  headline: z.string().trim().min(1).max(120),
  body: z.string().trim().max(400).optional(),
  ctaUrl: httpUrl.optional(),
  ctaLabel: z.string().trim().max(60).optional(),
  promotedSubjectId: uuid.optional(),
  status: z.enum(AD_PLACEMENT_STATUSES).default('draft'),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  priceCents: z.number().int().min(0).max(100_000_000).optional(),
  currency: z.string().trim().length(3).default('USD'),
  notes: z.string().trim().max(2000).optional(),
});

/** Admin sets a placement's status manually (after off-site payment). */
export const adStatusInput = z.object({ status: z.enum(AD_PLACEMENT_STATUSES) });

// ── game data-source / unmatched queue (I2) ──────────────────────────────────
/**
 * A raw, freeform context blob attached to an unmatched reference (e.g. the
 * article title/source that mentioned a game we don't have yet). Kept loose on
 * purpose — it's diagnostic metadata, not structured input.
 */
const rawContext = z.record(z.string().max(80), z.unknown());

/** An "unmatched game" queue row (the coverage safety net — BLUEPRINT data-source reality). */
export const unmatchedGameCreate = z.object({
  rawName: shortText,
  rawContext: rawContext.optional(),
  status: z.enum(UNMATCHED_STATUSES).default('pending'),
  resolvedSubjectId: uuid.optional(),
  resolutionNote: z.string().max(2000).optional(),
});

/**
 * Resolve-or-queue a game reference by name (the path the I3 article pipeline
 * calls). Demo resolves against the mock dataset; production would query
 * IGDB/RAWG live.
 */
export const gameResolveInput = z.object({
  name: shortText,
  context: rawContext.optional(),
});

/** Clear a queued reference by linking it to an existing game's Subject. */
export const unmatchedResolveLink = z.object({
  subjectId: uuid,
  note: z.string().max(2000).optional(),
});

/** Clear a queued reference by creating a brand-new game (reuses gameCreate). */
export const unmatchedResolveCreate = gameCreate;

/** Dismiss a queued reference (not a real game / spam / duplicate). */
export const unmatchedDismiss = z.object({
  note: z.string().max(2000).optional(),
});

// ── clustering: settings + editor controls (I3) + secondary gate (I4a) ───────
/** The secondary-gate sub-settings (SPEC I4a §7), all admin-tunable. */
const clusterGatePatch = z.object({
  enabled: z.boolean().optional(),
  minEventGapDays: z.number().min(0).max(365).optional(),
  requireDifferentEventKind: z.boolean().optional(),
});

/**
 * The event-kind keyword lexicon (SPEC I4a §7; owner directive: tunable from
 * admin, not a code change). A map of event-kind → keyword list; matching is
 * case-insensitive substring over title + excerpt.
 */
const eventKindLexiconPatch = z.record(
  z.string().max(40),
  z.array(z.string().min(1).max(60)).max(200),
);

/**
 * Admin-tunable clustering knobs (SPEC I3 §3/§4 + I4a §7). At least one field
 * must be present on a PATCH. `similarityThreshold` is cosine similarity (0..1);
 * `timeWindowDays` bounds how old a topic can be and still absorb new articles;
 * `gate` + `eventKindLexicon` configure the secondary gate.
 */
export const clusterSettingsUpdate = z
  .object({
    similarityThreshold: z.number().min(0).max(1).optional(),
    timeWindowDays: z.number().int().min(1).max(365).optional(),
    gate: clusterGatePatch.optional(),
    eventKindLexicon: eventKindLexiconPatch.optional(),
  })
  .refine(
    (o) =>
      o.similarityThreshold !== undefined ||
      o.timeWindowDays !== undefined ||
      o.gate !== undefined ||
      o.eventKindLexicon !== undefined,
    { message: 'Provide at least one clustering setting to update' },
  );

// ── bias engine: weights + per-article editor controls (I4a) ─────────────────
const biasPointWeight = z.number().min(-100).max(100);

/**
 * Tune the transparent additive bias weights (SPEC I4a §1/§2). A deep-partial
 * patch: send only the weights you want to change (e.g. `{ influence: { sponsored:
 * 80 } }`). Unknown keys are ignored by the settings store; values are clamped.
 */
export const biasWeightsUpdate = z
  .object({
    influence: z.record(z.string().max(40), biasPointWeight).optional(),
    quality: z.record(z.string().max(40), biasPointWeight).optional(),
    buckets: z
      .object({
        influenceMidpoint: score0to100.optional(),
        qualityMidpoint: score0to100.optional(),
      })
      .optional(),
  })
  .refine((o) => o.influence !== undefined || o.quality !== undefined || o.buckets !== undefined, {
    message: 'Provide influence, quality and/or buckets to update',
  });

/** A nullable override score — pass `null` to CLEAR an editor override (revert to auto). */
const overrideScore = z.union([score0to100, z.null()]);

/**
 * Editor override of an axis score (SPEC I4a §6). Sets influence and/or quality
 * with a reason; the auto value + breakdown are retained underneath so re-tuning
 * weights never clobbers the human decision. `null` clears the override.
 */
export const biasOverrideInput = z
  .object({
    influenceScore: overrideScore.optional(),
    qualityScore: overrideScore.optional(),
    reason: z.string().max(2000).optional(),
  })
  .refine((o) => o.influenceScore !== undefined || o.qualityScore !== undefined, {
    message: 'Provide influenceScore and/or qualityScore (null to clear)',
  });

/**
 * Editor JUDGMENTAL note (SPEC I4a §3) — the "cozy vibes, not gameplay" field.
 * Editor-entered ONLY; never auto-generated. Public-eligible (I5 "why"). `null`
 * clears it.
 */
export const biasNoteInput = z.object({ editorNote: z.string().max(2000).nullable() });

/**
 * INTERNAL-ONLY assessment (SPEC I4a §4; BLUEPRINT 2.2) — narrative push /
 * AI-likelihood for internal sorting. NEVER exposed publicly; structurally walled
 * off from the public bias payload. `null` clears it.
 */
export const biasInternalInput = z.object({
  internalAssessment: z.string().max(5000).nullable(),
});

// ── rating engine: settings + per-game editor controls (I4b) ─────────────────
/**
 * Tune the rating-engine params (SPEC I4b) — community-weighting credibility
 * curve, burst detection, disconnect bands. Deep-partial: send only what changes.
 * Unknown keys are ignored by the settings store; values are range-validated.
 */
export const ratingSettingsUpdate = z
  .object({
    credibility: z.record(z.string().max(40), z.number().min(0).max(1000)).optional(),
    burst: z.record(z.string().max(40), z.number().min(0).max(100_000)).optional(),
    disconnect: z.record(z.string().max(40), z.number().min(0).max(100)).optional(),
  })
  .refine(
    (o) => o.credibility !== undefined || o.burst !== undefined || o.disconnect !== undefined,
    { message: 'Provide credibility, burst and/or disconnect to update' },
  );

const overrideScoreNullable = z.union([score0to100, z.null()]);

/**
 * Editor override of a computed rating layer (SPEC I4b §6) — critics aggregate
 * and/or community score, with a reason; auto value retained underneath, never
 * clobbered by a re-tune. `null` clears an override.
 */
export const ratingOverrideInput = z
  .object({
    criticsScore: overrideScoreNullable.optional(),
    communityScore: overrideScoreNullable.optional(),
    reason: z.string().max(2000).optional(),
  })
  .refine((o) => o.criticsScore !== undefined || o.communityScore !== undefined, {
    message: 'Provide criticsScore and/or communityScore (null to clear)',
  });

/**
 * Force / clear the community "unusual activity" burst flag (SPEC I4b §6).
 * `null` reverts to the auto-detected value; true/false forces it. Audit-logged.
 */
export const burstFlagOverrideInput = z.object({
  flagged: z.union([z.boolean(), z.null()]),
  reason: z.string().max(2000).optional(),
});

/**
 * The editor-entered disconnect CONTEXT TAG (SPEC I4b §2; BLUEPRINT 2.3) — the
 * judgmental "why the gap exists" (monetization anger / review-bombing / niche
 * taste / critics overrated). EDITOR-ENTERED ONLY, never auto-inferred. `null` clears.
 */
export const disconnectTagInput = z.object({
  contextTag: z.string().max(200).nullable(),
});

/** Trigger the background ingest; `reset` re-clusters the whole feed from scratch. */
export const clusterIngestInput = z.object({
  reset: z.boolean().default(false),
});

/** Merge one topic's articles into another (the engine wrongly split them). */
export const topicMergeInput = z
  .object({ sourceTopicId: uuid, targetTopicId: uuid })
  .refine((o) => o.sourceTopicId !== o.targetTopicId, {
    message: 'Cannot merge a topic into itself',
    path: ['sourceTopicId'],
  });

/** Split selected articles out of a topic into a new topic (wrongly lumped). */
export const topicSplitInput = z.object({
  topicId: uuid,
  articleIds: z.array(uuid).min(1).max(500),
  newTitle: shortText.optional(),
});

/** Move an article to a different topic; optionally make it the primary. */
export const articleReassignInput = z.object({
  articleId: uuid,
  topicId: uuid,
  makePrimary: z.boolean().default(true),
});

// ── relation operations (link/unlink) ────────────────────────────────────────
export const topicSubjectLink = z.object({ topicId: uuid, subjectId: uuid });
export const articleTopicLink = z.object({
  articleId: uuid,
  topicId: uuid,
  isPrimary: z.boolean().default(false),
});
export const articleSubjectLink = z.object({ articleId: uuid, subjectId: uuid });
