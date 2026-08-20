/**
 * Structural domain constants shared across the platform.
 *
 * These are the FIXED structural domains (origin, status, type-of-thing) that
 * map to Postgres enums in the DB schema. They are deliberately NOT the
 * user-extensible "content" lists (topic types, source types, badges, award
 * categories, roles, levels) — those live in lookup tables so admins can add
 * values without a code change (CLAUDE.md: "everything configurable").
 *
 * The value arrays here are the single source of truth: the DB enums
 * (apps/backend) and the Zod validators (./validation) are both built from them.
 */

/**
 * Dimension of the clustering embedding vectors stored on Topic/Article.
 * The column is created in I1 (empty); generation happens in I3. Kept as one
 * constant so the model dimension is changed in exactly one place.
 */
export const EMBEDDING_DIM = 384;

/**
 * Default clustering knobs (SPEC I3 §3). Stored in `app_settings` and tunable
 * from admin — these are only the seed defaults, never hardcoded behaviour.
 *
 * `similarityThreshold` is cosine similarity (0..1) on the all-MiniLM-L6-v2
 * embeddings: an article joins the most-similar open topic only if it scores at
 * or above this. 0.50 sits in the empirically-measured gap between same-event
 * paraphrases (~0.6–0.85) and same-game-but-different-event articles (~0.35) —
 * directly guarding the owner's "too many / too few topics" fear.
 *
 * `timeWindowDays` bounds how old a topic's last activity can be and still
 * absorb a new article — beyond it, a similar article is treated as a new event.
 */
export const CLUSTERING_DEFAULTS = {
  similarityThreshold: 0.5,
  timeWindowDays: 14,
} as const;

/**
 * Clustering SECONDARY GATE (SPEC I4a §7) — a guard rail on top of the cosine
 * merge decision. A single global cosine threshold structurally over-merges
 * same-game / same-register events (the I3 adversarial finding). When the engine
 * would auto-attach an article to a candidate topic, the gate RESISTS the merge
 * (keeps them as separate topics) iff: same primary game AND a different event
 * kind AND the candidate topic is at least `minEventGapDays` older than the new
 * article. The time gap protects a live news cycle from being split by event-kind
 * misclassification. All params are admin-tunable in `app_settings` (never
 * hardcoded); the gate only resists merges — it never forces one — and an editor
 * merge/split still overrides it.
 *
 * `minEventGapDays = 2` is a starting default and is expected to be the first
 * knob tuned once real clustering is observed.
 */
export const CLUSTER_GATE_DEFAULTS = {
  enabled: true,
  minEventGapDays: 2,
  requireDifferentEventKind: true,
} as const;

/**
 * Event KINDS the secondary gate distinguishes (SPEC I4a §7). Mechanical, factual
 * categories derived from a tunable keyword lexicon — NOT a content-NLP judgment.
 * `other` is the fallback when no keyword matches; the gate never fires when
 * either side is `other` (conservative: we don't resist on missing information).
 */
export const EVENT_KINDS = [
  'delay',
  'release',
  'trailer',
  'leak',
  'sales',
  'update',
  'legal',
  'business',
  'review',
  'other',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/**
 * Priority order for event-kind classification: the first kind (most distinctive
 * first) whose keywords match wins. This ordering is STRUCTURAL (it decides ties)
 * and lives in code; the KEYWORDS themselves are the tunable knob and live in
 * `app_settings` (see EVENT_KIND_LEXICON_DEFAULTS). `other` is not listed — it is
 * the fallback when nothing matches.
 */
export const EVENT_KIND_PRIORITY: EventKind[] = [
  'legal',
  'leak',
  'delay',
  'sales',
  'trailer',
  'update',
  'release',
  'business',
  'review',
];

/**
 * Default keyword lexicon for event-kind classification (SPEC I4a §7; owner
 * directive: the lexicon is admin-tunable, not a code change). Stored in
 * `app_settings` under `event-kind-lexicon`; matching is case-insensitive
 * substring over title + excerpt. Keep keywords distinctive per kind to avoid
 * cross-contamination (e.g. a sales "milestone" vs a business "full production").
 */
export const EVENT_KIND_LEXICON_DEFAULTS: Record<string, string[]> = {
  legal: [
    'lawsuit',
    'sued',
    'court',
    'settlement',
    'ruling',
    'legal action',
    'copyright claim',
    'ftc',
    'antitrust',
    'class action',
  ],
  leak: [
    'leak',
    'leaked',
    'rumor',
    'rumour',
    'reportedly',
    'allegedly',
    'datamine',
    'datamined',
    'insider claims',
  ],
  delay: [
    'delay',
    'delayed',
    'pushed back',
    'pushes back',
    'slips',
    'slipped',
    'postponed',
    'new release window',
  ],
  sales: [
    'copies sold',
    'million copies',
    'million players',
    'units sold',
    'best-selling',
    'passes',
    'passed',
    'surpasses',
    'surpassed',
    'revenue record',
    'sales milestone',
  ],
  trailer: [
    'trailer',
    'teaser',
    'gameplay reveal',
    'revealed',
    'showcase',
    'first look',
    'announce trailer',
  ],
  update: [
    'update',
    'patch',
    'hotfix',
    'new season',
    'dlc',
    'expansion',
    'content drop',
    'new vehicles',
  ],
  release: [
    'launch',
    'launches',
    'launched',
    'released',
    'out now',
    'release date',
    'available now',
    'leaves early access',
  ],
  business: [
    'earnings',
    'acquisition',
    'acquires',
    'merger',
    'layoffs',
    'studio closure',
    'shares',
    'stock',
    'investment',
    'funding',
    'full production',
    'enters production',
    'expands its team',
  ],
  review: ['review', 'verdict', 'scored', 'review roundup'],
};

/**
 * Transparent additive BIAS WEIGHTS (SPEC I4a §1/§2). Every point on each axis
 * comes from a NAMED signal with one of these weights — no black box. These are
 * SEED defaults the owner tunes from admin (`app_settings` → `bias-weights`); the
 * scores stored on articles are recomputed whenever a weight changes.
 *
 * Axis 1 (influence): 0 = Independent → 100 = Influenced. Factual signals only.
 *   `paywall = 0` is a deliberate, KNOWN-SOFT default: paywalls are ambiguous
 *   (subscriber-funded ⇒ less ad/affiliate pressure, but the reader can't verify
 *   the source) — left neutral pending real-data tuning.
 * Axis 2 (quality): 0 = Slop → 100 = Top. Consciously humbler/narrower — weak
 *   auto signals only; an editor override is expected to matter more here.
 */
export const BIAS_WEIGHT_DEFAULTS = {
  influence: {
    sourceBaselineMax: 15, // × source commercial reputation (0..1)
    sponsored: 90, // self-disclosed sponsored ⇒ ~99% influenced (dominant)
    sourceConflict: 40, // source's parent publishes the covered game (COI)
    affiliate: 25, // "best deals" monetization (milder)
    opinionFraming: 20, // opinion = editorial angle (folded into "influenced")
    reviewCopy: 15, // publisher-provided access (mild, normal practice)
    paywall: 0, // KNOWN-SOFT default (see note above)
  },
  quality: {
    baselineMid: 35, // base + reputationGeneral×max ⇒ ~50 at rep 0.5
    sourceReputationMax: 30, // × source general reputation (0..1)
    neutralDefault: 50, // used when source reputation is unknown
    typeReview: 10, // a review is substantive work
    typeOpinion: 5, // analysis/opinion is effortful
    typePreview: -5, // previews skew thin/promotional
    typeGuide: 0,
    typeNews: 0,
    sponsored: -15, // PR-rewrite ⇒ low-effort, toward Slop
    affiliate: -5, // deals content typically lower-effort
  },
  buckets: {
    // Midpoints that split per-article scores into the topic-level distribution
    // counts (BLUEPRINT 1.3: "9 independent, 6 influenced; 12 quality, 3 low-effort").
    influenceMidpoint: 50,
    qualityMidpoint: 50,
  },
} as const;

/** One named contribution to an additive bias score (SPEC I4a §3 — the stored "why"). */
export interface BiasContribution {
  signal: string;
  label: string;
  points: number;
}

/**
 * The stored per-axis breakdown (SPEC I4a §3). This object IS the data I5 renders
 * publicly ("Influenced because: sponsored, affiliate links"). `score` = clamped
 * sum; every point traces to one `contributions` entry, so nothing is unexplained.
 */
export interface BiasBreakdown {
  baseline: number;
  rawSum: number;
  score: number;
  contributions: BiasContribution[];
}

/**
 * Topic-level bias distribution (SPEC I4a §5; BLUEPRINT 1.3). Stored on the topic
 * so I5 renders the "bias bar" without computing on the request path. Built from
 * the EFFECTIVE per-article scores (editor override ?? auto).
 */
export interface TopicBiasDistribution {
  articleCount: number;
  influence: { independent: number; influenced: number; avg: number | null };
  quality: { top: number; slop: number; avg: number | null };
  computedAt: string;
}

/**
 * The four FACTUAL influence FLAGS surfaced publicly (SPEC I5a display posture).
 * Derived in the public composition layer from the stored influence breakdown
 * signals (`sponsored`, `affiliate`, `reviewCopy`, `opinionFraming`) — they are
 * LABELS (what an article carries), NEVER a verdict. The influence axis is mostly
 * binary facts (has affiliate or not, sponsored or not), so the public UI shows
 * the actual signals present as chips rather than a fake smooth "% influenced"
 * bar. Rendered in a NEUTRAL/amber "attention" colour — never red (red is
 * reserved for the critic↔community disconnect, the one signal that flags a
 * genuine problem). The bias ENGINE is unchanged; this is purely how it reads.
 */
export const INFLUENCE_FLAGS = ['sponsored', 'affiliate', 'reviewCopy', 'opinion'] as const;
export type InfluenceFlag = (typeof INFLUENCE_FLAGS)[number];

/**
 * Topic-level distribution of the influence flags across a cluster's articles —
 * COUNTS, not an averaged score (e.g. "5 independent · 1 sponsored"). `total` is
 * the articles considered; `independent` is those carrying none of the flags.
 * Flags can co-occur on one article, so the per-flag counts need not sum to
 * `total`. Computed from the already-stored per-article breakdowns.
 */
export interface TopicFlagTally {
  total: number;
  independent: number;
  sponsored: number;
  affiliate: number;
  reviewCopy: number;
  opinion: number;
}

/**
 * Rating-engine defaults (SPEC I4b). The COMMUNITY WEIGHTING model (BLUEPRINT
 * 2.6, owner-confirmed): a per-vote credibility weight 0→1.0 (never above —
 * unproven votes are pushed toward 0, engagement never inflates a vote), plus a
 * burst/anomaly detector that raises a VISIBLE flag and applies credibility-aware
 * damping (a proven voter caught in a flagged burst stays ~undamped). CREDIBILITY
 * is the primary defense against a large-volume attack; damping is the secondary,
 * visible layer. All values are seed defaults — admin-tunable in `app_settings`
 * (`ratings` key), never hardcoded behaviour.
 */
export const RATING_WEIGHT_DEFAULTS = {
  // Per-vote credibility curve: weight = clamp(Σ named terms, 0, 1).
  credibility: {
    email: 0.45, // verified email — cheapest strong "not a throwaway" proof
    activity: 0.35, // reputation/tenure — the anti-farm signal
    age: 0.2, // account age — gentle bonus
    playtime: 0.0, // verified-playtime SLOT — 0 in demo (wired to Steam later)
    activityFullRep: 50, // reputation at which the activity term saturates
    ageFullDays: 30, // account age (days) at which the age term saturates
  },
  // Burst/review-bomb detection. FLAG fires iff isBurst AND extremeFraction met —
  // two independent conditions (volume spike AND one-sided extremes).
  burst: {
    windowHours: 48, // detection window
    minBurstVotes: 15, // absolute floor — below this a "burst" isn't meaningful
    burstMultiplier: 5, // window volume ≥ this × the game's historical rate
    extremeLow: 15, // a vote ≤ this is "extreme"
    extremeHigh: 85, // a vote ≥ this is "extreme"
    // ⚠️ FIRST KNOB TO TIGHTEN: 0.60 catches blunt 99%-0/10 bombs; a sophisticated
    // bomber mixing in some 3s/4s could dodge it. Tune down on real data.
    extremeFraction: 0.6, // ≥ this fraction of the window at the extremes ⇒ flag
    dampingFactor: 0.3, // floor weight for a ZERO-credibility flagged-burst vote
  },
  // Critics ↔ Community gap bands (by magnitude, 0..100).
  disconnect: {
    agreeMax: 10, // ≤ → agree (green)
    mildMax: 25, // ≤ → mild
    notableMax: 40, // ≤ → notable; > → large (red)
    tagMinValue: 26, // editor context tag surfaced only when value ≥ this (notable+)
  },
} as const;

export type DisconnectBand = 'agree' | 'mild' | 'notable' | 'large';

/** Per-vote credibility breakdown (SPEC I4b — the transparent "why" of a weight). */
export interface CredibilityBreakdown {
  email: number;
  activity: number;
  age: number;
  playtime: number;
  total: number; // 0..1, the stored per-vote weight
}

/**
 * Stored community burst/anomaly info (SPEC I4b §3) — public-facing "unusual
 * activity" data, never silent. `isBurst` (volume) and `flagged` (volume AND
 * one-sided extremes) are stored SEPARATELY so a legitimate moderate-low surge
 * shows up as a burst that was NOT flagged (the counter-case proof).
 */
export interface CommunityBurstInfo {
  isBurst: boolean;
  flagged: boolean;
  windowHours: number;
  windowCount: number;
  historicalRate: number;
  extremeFraction: number;
  naive: number | null; // unweighted mean (for the naive-vs-weighted comparison)
  weighted: number | null; // credibility+damping weighted mean
  dampedVoteCount: number;
}

export const SUBJECT_TYPES = ['game', 'studio', 'publisher', 'platform'] as const;
export type SubjectType = (typeof SUBJECT_TYPES)[number];

export const ARTICLE_ORIGINS = ['aggregated', 'ours'] as const;
export type ArticleOrigin = (typeof ARTICLE_ORIGINS)[number];

export const ARTICLE_TYPES = ['news', 'review', 'opinion', 'preview', 'guide'] as const;
export type ArticleType = (typeof ARTICLE_TYPES)[number];

export const TOPIC_STATUSES = ['developing', 'ongoing', 'resolved'] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export const GAME_STATUSES = [
  'announced',
  'in_development',
  'early_access',
  'released',
  'delisted',
] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const AWARD_PHASES = ['announce', 'nominations', 'voting', 'reveal', 'archive'] as const;
export type AwardPhase = (typeof AWARD_PHASES)[number];

export const AWARD_CATEGORY_KINDS = ['general', 'genre'] as const;
export type AwardCategoryKind = (typeof AWARD_CATEGORY_KINDS)[number];

export const AWARD_OUTCOME_TYPES = ['critics', 'community'] as const;
export type AwardOutcomeType = (typeof AWARD_OUTCOME_TYPES)[number];

// Ad / promotion placements (I8 §2.10). Status is ADMIN-SET after off-site
// payment — there is no payment gateway (owner decision). `active` = live +
// labeled Promoted.
export const AD_PLACEMENT_STATUSES = ['draft', 'scheduled', 'active', 'ended'] as const;
export type AdPlacementStatus = (typeof AD_PLACEMENT_STATUSES)[number];

// A slot's unsold-fallback: show the demo "AD" box, render page-native organic
// content, or hide entirely (never an empty "ad here" box — blueprint slot rule).
export const AD_SLOT_FALLBACKS = ['ad', 'organic', 'hide'] as const;
export type AdSlotFallback = (typeof AD_SLOT_FALLBACKS)[number];

// Newsletter campaigns (I8 §2.8). Lifecycle is staff-driven: draft → (scheduled)
// → sent, or canceled. `sending` is the brief in-flight state a send moves
// through. There is no real dispatch in demo — a send fans out to the Mock
// EmailSender (writes to `email_outbox`, ZERO network).
export const NEWSLETTER_CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'sending',
  'sent',
  'canceled',
] as const;
export type NewsletterCampaignStatus = (typeof NEWSLETTER_CAMPAIGN_STATUSES)[number];

// How a campaign body was authored: `manual` (staff-written) or `digest`
// (assembled from the EXISTING topic summaries — no new AI is generated).
export const NEWSLETTER_CAMPAIGN_KINDS = ['manual', 'digest'] as const;
export type NewsletterCampaignKind = (typeof NEWSLETTER_CAMPAIGN_KINDS)[number];

// The reserved audience segment that targets every consented subscriber. Any
// other value targets subscribers whose `source` matches it (e.g. 'awards').
// Segmentation is GDPR-gated in the resolver: withdrawn/inactive are excluded.
export const NEWSLETTER_SEGMENT_ALL = 'all';

// Upcoming manual override (Upcoming enrichment, decision 1). A game appears in
// Upcoming automatically by pre-release STATUS; an admin can explicitly override
// that: `show` force-includes regardless of status, `hide` force-excludes. Null
// (unset) = auto-by-status. The override always wins, and auto vs manually-placed
// stays distinguishable. Editorial `upcomingFeatured` (an UNLABELED curatorial
// pin) is separate from the PAID Promoted flag (the I8 placement, always labeled).
export const UPCOMING_OVERRIDES = ['show', 'hide'] as const;
export type UpcomingOverride = (typeof UPCOMING_OVERRIDES)[number];

// `deleted` = an anonymize-and-tombstone account (I6 Slice 7, GDPR decision 7):
// PII scrubbed, credibility fields frozen so aggregates stay honest, cannot log in.
export const USER_STATUSES = ['active', 'suspended', 'banned', 'deleted'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Versioned consent types captured with a coarsened IP (I6 Slice 7, GDPR). */
export const CONSENT_TYPES = ['terms', 'privacy', 'analytics', 'marketing'] as const;
export type ConsentType = (typeof CONSENT_TYPES)[number];

export const AUDIT_ACTIONS = ['create', 'update', 'delete'] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Game-level Content Flags (factual, non-ideological — see BLUEPRINT 2.3). */
export const AI_ASSET_FLAGS = ['unknown', 'no', 'partial', 'yes'] as const;
export type AiAssetFlag = (typeof AI_ASSET_FLAGS)[number];

export const LAUNCH_STATE_FLAGS = ['unknown', 'polished', 'mixed', 'rough'] as const;
export type LaunchStateFlag = (typeof LAUNCH_STATE_FLAGS)[number];

export const SOURCE_STATUSES = ['active', 'paused'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];

/** Provider for game videos/streams. */
export const VIDEO_PROVIDERS = ['youtube', 'twitch', 'other'] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

/** Where an external "across the web" rating/sentiment comes from. */
export const EXTERNAL_RATING_KINDS = [
  'steam',
  'metacritic',
  'opencritic',
  'reddit',
  'other',
] as const;
export type ExternalRatingKind = (typeof EXTERNAL_RATING_KINDS)[number];

/**
 * Game-data providers behind the demo↔production seam (I2). `mock` reads the
 * bundled local dataset (demo default, no network); `live` is IGDB→RAWG and is
 * only reachable with real keys + APP_MODE=production. See BLUEPRINT 1.6 and the
 * data-source reality notes.
 */
export const GAME_DATA_PROVIDERS = ['mock', 'live'] as const;
export type GameDataProviderName = (typeof GAME_DATA_PROVIDERS)[number];

/**
 * Lifecycle of an "unmatched game" reference (I2 coverage safety net). A
 * reference that can't be auto-resolved (DB → provider) is filed `pending` for
 * an editor to `resolved` (link/create) or `dismissed`.
 */
export const UNMATCHED_STATUSES = ['pending', 'resolved', 'dismissed'] as const;
export type UnmatchedStatus = (typeof UNMATCHED_STATUSES)[number];
