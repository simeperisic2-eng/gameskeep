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

/**
 * Phase P S1 — where the public bias display renders. `reviews_and_sponsored`
 * (default): the full panel only on review articles and articles carrying a
 * sponsored signal; compact surfaces show at most a Sponsored chip. `all`: the
 * panel everywhere. The engine computes on every article either way.
 */
export const BIAS_DISPLAY_SCOPES = ['reviews_and_sponsored', 'all'] as const;
export type BiasDisplayScope = (typeof BIAS_DISPLAY_SCOPES)[number];

/**
 * Review-integrity signals (Phase P S1) — evidence-backed rows on review
 * articles: publisher review copy, embargo, sponsored event / press trip. A row is
 * public only with evidence (source snippet or editor note + date). `auto` rows
 * come from the lexicon scan; `editor` rows are added by a moderator+.
 */
export const INTEGRITY_SIGNAL_KINDS = ['review_copy', 'embargo', 'sponsored_event'] as const;
export type IntegritySignalKind = (typeof INTEGRITY_SIGNAL_KINDS)[number];
export const INTEGRITY_SIGNAL_ORIGINS = ['auto', 'editor'] as const;
export type IntegritySignalOrigin = (typeof INTEGRITY_SIGNAL_ORIGINS)[number];
/** `detected` = auto-found, awaiting a moderator (public only when autoPublish is on). */
export const INTEGRITY_SIGNAL_STATUSES = ['detected', 'confirmed', 'dismissed'] as const;
export type IntegritySignalStatus = (typeof INTEGRITY_SIGNAL_STATUSES)[number];

/** Evidence snippets stay short (Phase P S1 owner rule). */
export const INTEGRITY_SNIPPET_MAX = 200;

/**
 * Seed lexicon for the integrity scan (admin-editable in `app_settings.integrity`).
 * Case-insensitive substring match per CLAUSE; a clause that also contains a
 * negation phrase is not a signal ("no review code was provided").
 */
export const INTEGRITY_LEXICON_DEFAULTS = {
  reviewCopy: [
    'review code',
    'review copy',
    'code provided by',
    'copy provided by',
    'provided by the publisher',
    'early access code',
  ],
  embargo: ['embargo'],
  sponsoredEvent: [
    'press trip',
    'travel and accommodation',
    'travel and lodging',
    'flights and accommodation',
    'covered our travel',
    'paid for our travel',
    'preview event hosted by',
    'flown out by',
  ],
  negations: [
    'not provided',
    'no review code',
    'no review copy',
    'did not receive',
    "didn't receive",
    'bought it ourselves',
    'bought our own',
    'purchased our own',
    'paid for it ourselves',
    'no embargo',
    'not under embargo',
    'not embargoed',
    'at our own expense',
    'paid our own way',
    'without a review code',
    'no press trip',
  ],
} as const;

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

// ── Homepage sections (Phase P S2) ────────────────────────────────────────────
/**
 * Section kinds — an INFORMATIONAL label since the owner decision that any list
 * may carry paid placements (data = ranked from our data; discovery = curated
 * discovery; block = no items). What stays fixed in code: every paid item carries
 * the render-forced label ("Promoted" game / "Sponsored" story), and payment
 * never changes data (paid items are inserted; the organic list is untouched).
 */
export const HOMEPAGE_SECTION_KINDS = ['data', 'discovery', 'block'] as const;
export type HomepageSectionKind = (typeof HOMEPAGE_SECTION_KINDS)[number];

/** auto = the section's rule only; manual = pins only; pins_auto = pins + auto fill. */
export const HOMEPAGE_SECTION_MODES = ['auto', 'manual', 'pins_auto'] as const;
export type HomepageSectionMode = (typeof HOMEPAGE_SECTION_MODES)[number];

/** What a section lists: stories, games, both (Featured), or nothing (blocks). */
export type HomepageItemType = 'topic' | 'game' | 'mixed' | 'none';

export interface HomepageSectionDef {
  kind: HomepageSectionKind;
  items: HomepageItemType;
  /** Shows a Δ vs the previous window of equal length (admin-set window). */
  delta: boolean;
  title: string;
  /** Default config for a fresh install (the admin edits everything after). */
  defaults: {
    position: number;
    enabled: boolean;
    mode: HomepageSectionMode;
    itemCount: number;
    deltaWindowHours: number | null;
    /**
     * Demo mode only: the Δ window a fresh demo starts with (the bundled feed is
     * too quiet for the production window). Production uses `deltaWindowHours`.
     */
    demoDeltaWindowHours?: number;
    /** Positions of paid items (owner decision: any list; the count is the length). */
    paidPositions: readonly number[];
    /** Below this many qualifying items the section is hidden (null = never). */
    minItems: number | null;
  };
}

/**
 * The fixed section catalogue: the KEY is the stable identity (its kind label is
 * mirrored by a DB CHECK). Titles, order, counts, modes, rules, pins and paid
 * positions are admin data.
 */
export const HOMEPAGE_SECTIONS = {
  briefing: {
    kind: 'block',
    items: 'none',
    delta: false,
    title: 'Today’s briefing',
    defaults: {
      position: 1,
      enabled: true,
      mode: 'auto',
      itemCount: 1,
      deltaWindowHours: null,
      paidPositions: [],
      minItems: null,
    },
  },
  trending: {
    kind: 'data',
    items: 'topic',
    delta: true,
    title: 'Trending now',
    defaults: {
      position: 2,
      enabled: true,
      mode: 'pins_auto',
      itemCount: 8,
      deltaWindowHours: 48,
      demoDeltaWindowHours: 168,
      paidPositions: [],
      minItems: 3,
    },
  },
  latest: {
    kind: 'data',
    items: 'topic',
    delta: false,
    title: 'The latest stories',
    defaults: {
      position: 3,
      enabled: true,
      mode: 'pins_auto',
      itemCount: 18,
      deltaWindowHours: null,
      paidPositions: [],
      minItems: null,
    },
  },
  featured: {
    kind: 'discovery',
    items: 'mixed',
    delta: false,
    title: 'Featured',
    defaults: {
      position: 4,
      enabled: true,
      mode: 'manual',
      itemCount: 3,
      deltaWindowHours: null,
      paidPositions: [2],
      minItems: null,
    },
  },
  by_players: {
    kind: 'data',
    items: 'game',
    delta: true,
    title: 'By players',
    defaults: {
      position: 5,
      enabled: true,
      mode: 'auto',
      itemCount: 6,
      deltaWindowHours: 168,
      paidPositions: [],
      minItems: null,
    },
  },
  new: {
    kind: 'discovery',
    items: 'game',
    delta: false,
    title: 'New releases',
    defaults: {
      position: 6,
      enabled: true,
      mode: 'pins_auto',
      itemCount: 6,
      deltaWindowHours: null,
      paidPositions: [],
      minItems: null,
    },
  },
  our_picks: {
    kind: 'data',
    items: 'game',
    delta: false,
    title: 'Our picks',
    defaults: {
      position: 7,
      enabled: true,
      mode: 'manual',
      itemCount: 6,
      deltaWindowHours: null,
      paidPositions: [],
      minItems: null,
    },
  },
  focus: {
    kind: 'data',
    items: 'game',
    delta: false,
    title: 'Games in focus',
    defaults: {
      position: 8,
      enabled: true,
      mode: 'auto',
      itemCount: 3,
      deltaWindowHours: null,
      paidPositions: [],
      minItems: null,
    },
  },
  top_rated: {
    kind: 'data',
    items: 'game',
    delta: false,
    title: 'Top rated right now',
    defaults: {
      position: 9,
      enabled: true,
      mode: 'pins_auto',
      itemCount: 6,
      deltaWindowHours: null,
      paidPositions: [],
      minItems: null,
    },
  },
  upcoming: {
    kind: 'discovery',
    items: 'game',
    delta: false,
    title: 'Upcoming',
    defaults: {
      position: 10,
      enabled: true,
      mode: 'pins_auto',
      itemCount: 6,
      deltaWindowHours: null,
      paidPositions: [],
      minItems: null,
    },
  },
  genres: {
    kind: 'block',
    items: 'none',
    delta: false,
    title: 'Browse by genre',
    defaults: {
      position: 11,
      enabled: true,
      mode: 'auto',
      itemCount: 12,
      deltaWindowHours: null,
      paidPositions: [],
      minItems: null,
    },
  },
  // Phase P S4: stories in "low" news categories (deals, guides…) — never in
  // Trending / Latest / the briefing counts; only here.
  more: {
    kind: 'data',
    items: 'topic',
    delta: false,
    title: 'More from the feed',
    defaults: {
      position: 14,
      enabled: true,
      mode: 'auto',
      itemCount: 6,
      deltaWindowHours: null,
      paidPositions: [],
      minItems: null,
    },
  },
  community: {
    kind: 'block',
    items: 'none',
    delta: false,
    title: 'Your voice, with weight',
    defaults: {
      position: 12,
      enabled: true,
      mode: 'auto',
      itemCount: 1,
      deltaWindowHours: null,
      paidPositions: [],
      minItems: null,
    },
  },
  newsletter: {
    kind: 'block',
    items: 'none',
    delta: false,
    title: 'The briefing, by email',
    defaults: {
      position: 13,
      enabled: true,
      mode: 'auto',
      itemCount: 1,
      deltaWindowHours: null,
      paidPositions: [],
      minItems: null,
    },
  },
} as const satisfies Record<string, HomepageSectionDef>;
export type HomepageSectionKey = keyof typeof HOMEPAGE_SECTIONS;
export const HOMEPAGE_SECTION_KEYS = Object.keys(HOMEPAGE_SECTIONS) as HomepageSectionKey[];

/** Max items any section may list (and the highest pin / promoted position). */
export const HOMEPAGE_MAX_ITEMS = 24;

/** Rule dimensions a section can filter on (include / exclude lists). */
export const HOMEPAGE_RULE_DIMENSIONS = ['categories', 'tags', 'genres', 'sources'] as const;
export type HomepageRuleDimension = (typeof HOMEPAGE_RULE_DIMENSIONS)[number];

/** Built-in source-type ROLES — the stable identity a rule keys on (S2). */
export const SOURCE_TYPE_ROLES = ['standalone'] as const;
export type SourceTypeRole = (typeof SOURCE_TYPE_ROLES)[number];

// ── Phase P S3: tags ───────────────────────────────────────────────────────────
/**
 * Tag FAMILIES are structural (they behave differently): CONTENT describes the
 * game (no provenance line, never expires); ISSUE reports a problem (provenance,
 * first-seen / last-confirmed dates, expiry for vote-driven ones, resolve with a
 * patch reference). The taxonomy inside each family is whatever editors create.
 */
export const TAG_FAMILIES = ['content', 'issue'] as const;
export type TagFamily = (typeof TAG_FAMILIES)[number];

/** A game↔tag instance: waiting in the queue, public, or removed (a tombstone). */
export const GAME_TAG_STATES = ['pending', 'published', 'rejected'] as const;
export type GameTagState = (typeof GAME_TAG_STATES)[number];

/** Where an instance came from — drives the truthful provenance line. */
export const GAME_TAG_SOURCES = ['import', 'players', 'editors'] as const;
export type GameTagSource = (typeof GAME_TAG_SOURCES)[number];

export const TAG_SUGGESTION_STATUSES = ['pending', 'accepted', 'merged', 'rejected'] as const;
export const TAG_SUGGESTION_SOURCES = ['import', 'user'] as const;

/**
 * The fresh-install taxonomy (the spec's seed). DATA, not a rule: editors add,
 * rename, retire or delete any of it; nothing is restricted.
 */
export const TAG_SEED: readonly {
  family: TagFamily;
  slug: string;
  name: string;
  aliases: readonly string[];
}[] = [
  { family: 'content', slug: 'co-op', name: 'Co-op', aliases: ['coop', 'co op', 'cooperative'] },
  { family: 'content', slug: 'local-co-op', name: 'Local co-op', aliases: ['couch co-op'] },
  { family: 'content', slug: 'pvp', name: 'PvP', aliases: ['player vs player'] },
  {
    family: 'content',
    slug: 'single-player',
    name: 'Single-player',
    aliases: ['singleplayer', 'single player'],
  },
  { family: 'content', slug: 'story-rich', name: 'Story-rich', aliases: ['story rich'] },
  { family: 'content', slug: 'open-world', name: 'Open world', aliases: ['open-world'] },
  { family: 'content', slug: 'roguelike', name: 'Roguelike', aliases: ['rogue-like'] },
  { family: 'content', slug: 'horror', name: 'Horror', aliases: [] },
  { family: 'content', slug: 'mature-themes', name: 'Mature themes', aliases: [] },
  { family: 'content', slug: 'lgbtq-content', name: 'LGBTQ+ content', aliases: ['lgbtq'] },
  { family: 'content', slug: 'religious-themes', name: 'Religious themes', aliases: [] },
  { family: 'issue', slug: 'bugs', name: 'Bugs', aliases: ['buggy'] },
  { family: 'issue', slug: 'server-problems', name: 'Server problems', aliases: [] },
  { family: 'issue', slug: 'cheaters', name: 'Cheaters', aliases: [] },
  { family: 'issue', slug: 'pay-to-win', name: 'Pay-to-win', aliases: ['p2w'] },
  { family: 'issue', slug: 'always-online-drm', name: 'Always-online DRM', aliases: [] },
  {
    family: 'issue',
    slug: 'aggressive-monetization',
    name: 'Aggressive monetization',
    aliases: [],
  },
];

/** The issue tag the legacy "predatory monetization" content flag became (owner, S3). */
export const PAY_TO_WIN_TAG_SLUG = 'pay-to-win';

// ── Phase P S3b: overrides that stick, curation, import-error reasons ─────────
/**
 * Third-party data (owner rule): editors may correct it only to fix an import
 * error — every such update or delete carries one of these reasons (audited).
 */
export const IMPORT_FIX_REASONS = [
  'import-error-wrong-value',
  'import-error-wrong-game-match',
] as const;
export type ImportFixReason = (typeof IMPORT_FIX_REASONS)[number];
export const IMPORT_FIX_REASON_LABELS: Record<ImportFixReason, string> = {
  'import-error-wrong-value': 'Import error — wrong value',
  'import-error-wrong-game-match': 'Import error — wrong game match',
};

/** Story fields an editor's edit LOCKS against the automatic passes (and a re-cluster). */
export const TOPIC_LOCKABLE_FIELDS = [
  'title',
  'tldr',
  'aiSummary',
  'status',
  'typeId',
  // Phase P S4: an editor's story category sticks (the automatic category pass skips it).
  'category',
] as const;
export type TopicLockableField = (typeof TOPIC_LOCKABLE_FIELDS)[number];

/** Editor pin / exclude lists for the computed lists on a page (owner: every list curatable). */
export const CURATION_PAGES = [
  'topic',
  'game',
  'discovery',
  // Phase P S4: search results per query; editorial-list consensus per year:category.
  'search',
  'lists',
] as const;
export const CURATION_LISTS = [
  'related-stories',
  'related-games',
  'coverage-rows',
  'top-rated',
  'most-discussed',
  'coming-soon',
  // Phase P S4
  'results', // search: keys "game:slug" | "topic:slug" | "source:slug"
  'consensus', // lists (page key "year:category"): game slugs
  'comparison-lines', // lists: "game-slug|lineKey" (excludes only)
  'editorial-lists', // game page: editorial list ids (excludes only)
] as const;
/** Which lists exist on which page kind (the curation admin validates against this). */
export const CURATION_LISTS_BY_PAGE: Record<(typeof CURATION_PAGES)[number], readonly string[]> = {
  topic: ['related-stories', 'coverage-rows'],
  game: ['related-stories', 'related-games', 'editorial-lists'],
  discovery: ['top-rated', 'most-discussed', 'coming-soon'],
  search: ['results'],
  lists: ['consensus', 'comparison-lines'],
};
export type CurationPage = (typeof CURATION_PAGES)[number];
export type CurationList = (typeof CURATION_LISTS)[number];

/** A badge an editor granted (shown although not earned) or revoked (hidden although earned). */
export const BADGE_OVERRIDE_STATES = ['granted', 'revoked'] as const;

/** The disconnect bands (an editor may override the computed band, with a reason). */
export const DISCONNECT_BANDS = ['agree', 'mild', 'notable', 'large'] as const;

/**
 * Phase P S3b — the product rules that used to be hardcoded, now ONE admin
 * setting (app_settings `rules`, Control Panel → Rules & limits). Defaults are
 * exactly the previous behaviour. [min, max] bounds live in RULE_BOUNDS.
 */
export const RULES_DEFAULTS = {
  homepage: {
    /** Top rated skips the first N Games in focus (0 = off). */
    topRatedExcludeFocus: 3,
    /** Latest skips stories already in Trending. */
    latestExcludesTrending: true,
    /** Which Trending story is highlighted first rotates every N minutes (0 = never). */
    heroRotateMinutes: 5,
    /** Stacked story cards under the spotlight. */
    heroSecondaryCount: 3,
    /** Latest shows N cards before "load more". */
    latestInitial: 9,
    /** Outlet headlines per Trending story ("How it's being covered"). */
    coverageRows: 3,
    /** Our picks takes editors' pins only. */
    ourPicksManualOnly: true,
  },
  clustering: {
    /** A story reads "ongoing" from this many articles. */
    ongoingAt: 3,
  },
  display: {
    /** "Top quality only" filter: quality at or above this. */
    qualityFilterMin: 50,
    /** Review-integrity evidence snippets are clipped to this many characters. */
    integritySnippetMax: 200,
    /** Excerpt lengths (characters) per surface. */
    excerpt: {
      coverageRow: 240,
      spotlight: 220,
      gameArticle: 220,
      sourcePage: 200,
      feed: 180,
      latest: 110,
      topicSummary: 600,
      metaDescription: 180,
    },
  },
  sources: {
    /** A source with a parent company can't be typed "Standalone". */
    parentBlocksStandalone: true,
  },
  community: {
    /** Items in a reader's feed. */
    feedLimit: 30,
  },
  upcoming: {
    /** Editor-featured games float to the front of /upcoming. */
    featuredFirst: true,
    /** Paid positions on /upcoming (1-based); empty = paid games at the front. */
    paidPositions: [] as number[],
  },
  lists: {
    topicRelatedStories: 5,
    gameRelatedStories: 6,
    gameRelatedGames: 6,
    gameVideos: 3,
    sourceRecentCoverage: 10,
    sourceTopGames: 6,
    discoveryTopRated: 6,
    discoveryMostDiscussed: 6,
    discoveryComingSoon: 4,
    /** Named reasons shown under "Why these signals?". */
    whyReasons: 3,
  },
  // ── Phase P S4 ──
  search: {
    /** The typeahead answers from this many characters. */
    minChars: 2,
    /** Typeahead results per group (games / stories / sources). */
    suggestPerGroup: 5,
    /** Results per page on /search. */
    pageSize: 20,
    /** Typeahead requests per client per window (behind the proxy: see TRUST_PROXY). */
    rateLimitPerClient: 60,
    /** Typeahead requests across everyone per window (a ceiling). */
    rateLimitGlobal: 1200,
    rateLimitWindowSeconds: 60,
    /** Typo-tolerant matching when the exact words find nothing. */
    fuzzy: true,
    /** Fuzzy similarity threshold (percent). */
    fuzzyThresholdPct: 30,
    /** Ranking weights. */
    weightExact: 30,
    weightPrefix: 10,
    weightText: 10,
    /** Results are cached this many seconds per query. */
    cacheSeconds: 60,
    /** Longer queries are cut to this many characters. */
    maxQueryChars: 100,
  },
  seo: {
    /** A story is indexable from this many sources … */
    topicMinSources: 2,
    /** … or when it has an AI summary AND a linked game. */
    indexIfSummaryAndGame: true,
    /** Stories in a category set to "hide" are never indexed (automatic mode). */
    noindexHiddenCategories: true,
  },
  news: {
    /** A story takes a category when at least this share (percent) of its articles carry it. */
    topicCategorySharePct: 50,
    /** The classifier also reads the excerpt (default: title only). */
    classifyExcerpt: false,
    /** Stories in "low" categories are searchable. */
    lowSearchable: true,
    /** Stories in "hide" categories are searchable. */
    hideSearchable: false,
  },
  editorialLists: {
    /** A game enters a consensus from this many lists (never 1 — no outlet's list is republished). */
    minAppearances: 2,
    /** Rows on a consensus page. */
    maxRows: 25,
    /** "Absent from every other outlet's top N". */
    deviationTopN: 10,
    /** A consensus page is public + indexable from this many confirmed lists. */
    indexMinLists: 3,
    /** Lists shown on a game page. */
    gamePageMax: 10,
    /** Comparison lines (each on / off). */
    lineSoloTop: true,
    lineCoverage: true,
    lineSpread: true,
    /** "Lists" in the header navigation. */
    showInNav: true,
  },
};
export type RulesSettings = typeof RULES_DEFAULTS;

/** [min, max] for every numeric rule (integers unless noted). */
export const RULE_BOUNDS: Record<string, readonly [number, number]> = {
  'homepage.topRatedExcludeFocus': [0, 24],
  'homepage.heroRotateMinutes': [0, 1440],
  'homepage.heroSecondaryCount': [0, 6],
  'homepage.latestInitial': [1, 48],
  'homepage.coverageRows': [0, 6],
  'clustering.ongoingAt': [2, 100],
  'display.qualityFilterMin': [0, 100],
  // Capped at the evidence column (varchar 240) — a longer clip could not be stored.
  'display.integritySnippetMax': [40, 240],
  'display.excerpt.coverageRow': [40, 2000],
  'display.excerpt.spotlight': [40, 2000],
  'display.excerpt.gameArticle': [40, 2000],
  'display.excerpt.sourcePage': [40, 2000],
  'display.excerpt.feed': [40, 2000],
  'display.excerpt.latest': [40, 2000],
  'display.excerpt.topicSummary': [40, 4000],
  'display.excerpt.metaDescription': [60, 320],
  'community.feedLimit': [1, 200],
  'lists.topicRelatedStories': [0, 24],
  'lists.gameRelatedStories': [0, 24],
  'lists.gameRelatedGames': [0, 24],
  'lists.gameVideos': [0, 24],
  'lists.sourceRecentCoverage': [1, 100],
  'lists.sourceTopGames': [0, 24],
  'lists.discoveryTopRated': [0, 24],
  'lists.discoveryMostDiscussed': [0, 24],
  'lists.discoveryComingSoon': [0, 24],
  'lists.whyReasons': [0, 10],
  // Phase P S4
  'search.minChars': [2, 10],
  'search.suggestPerGroup': [1, 20],
  'search.pageSize': [5, 50],
  'search.rateLimitPerClient': [1, 10000],
  'search.rateLimitGlobal': [1, 100000],
  'search.rateLimitWindowSeconds': [1, 3600],
  'search.fuzzyThresholdPct': [10, 90],
  'search.weightExact': [0, 100],
  'search.weightPrefix': [0, 100],
  'search.weightText': [0, 100],
  'search.cacheSeconds': [0, 3600],
  'search.maxQueryChars': [10, 200],
  'seo.topicMinSources': [1, 20],
  'news.topicCategorySharePct': [1, 100],
  // Floor 2 (owner): a consensus never shows a game that is on one list only,
  // so no outlet's list is republished as a page of ours.
  'editorialLists.minAppearances': [2, 20],
  'editorialLists.maxRows': [1, 100],
  'editorialLists.deviationTopN': [3, 100],
  'editorialLists.indexMinLists': [1, 50],
  'editorialLists.gamePageMax': [0, 50],
};

// ── Phase P S4: news categories, indexing, editorial lists, search ──────────
/** How a news category shows: everywhere / only in "More from the feed" / nowhere in feeds. */
export const NEWS_CATEGORY_MODES = ['show', 'low', 'hide'] as const;
export type NewsCategoryMode = (typeof NEWS_CATEGORY_MODES)[number];

/** The fallback category (built in; it can be relabelled but not removed). */
export const NEWS_FALLBACK_CATEGORY = 'news';

/**
 * The seeded categories (fresh installs; editors own them after). A feed-given
 * article type (review / opinion / preview / guide) wins; otherwise the keyword
 * phrases decide (highest priority first, title only by default); else news.
 * Owner defaults (S4): deals → low, guides → low, listicles → hide.
 */
export const NEWS_CATEGORY_SEED: readonly {
  key: string;
  label: string;
  mode: NewsCategoryMode;
  keywords: readonly string[];
  priority: number;
}[] = [
  { key: 'news', label: 'News', mode: 'show', keywords: [], priority: 0 },
  { key: 'review', label: 'Review', mode: 'show', keywords: [], priority: 0 },
  { key: 'opinion', label: 'Opinion', mode: 'show', keywords: [], priority: 0 },
  { key: 'preview', label: 'Preview', mode: 'show', keywords: [], priority: 0 },
  {
    key: 'guide',
    label: 'Guide',
    mode: 'low',
    keywords: [
      'guide',
      'how to',
      'walkthrough',
      'tips and tricks',
      'best settings',
      'where to find',
      'all locations',
    ],
    priority: 30,
  },
  {
    key: 'deals',
    label: 'Deals',
    mode: 'low',
    keywords: [
      '% off',
      'deals',
      'deal alert',
      'discounted',
      'on sale',
      'price drop',
      'lowest price',
      'cheapest',
    ],
    priority: 40,
  },
  {
    key: 'listicle',
    label: 'Listicle',
    mode: 'hide',
    keywords: [
      'games like',
      ', ranked',
      'best games of',
      'best games to play',
      'top 5',
      'top 10',
      'top 15',
      'top 20',
      'top 25',
      'reasons why',
      'things you need to know',
    ],
    priority: 35,
  },
];

/** A story's indexing: the automatic rule, or an editor's index / noindex. */
export const SEO_INDEX_MODES = ['auto', 'index', 'noindex'] as const;
export type SeoIndexMode = (typeof SEO_INDEX_MODES)[number];

/** Editorial lists: only CONFIRMED ones are ever public. */
export const LIST_STATUSES = ['candidate', 'confirmed', 'rejected'] as const;
export type ListStatus = (typeof LIST_STATUSES)[number];
export const LIST_ENTRY_MATCHES = ['auto', 'editor', 'unmatched'] as const;
export type ListEntryMatch = (typeof LIST_ENTRY_MATCHES)[number];
/** Comparison line templates (data only, no adjectives). */
export const LIST_LINE_KEYS = ['soloTop', 'coverage', 'spread'] as const;
export type ListLineKey = (typeof LIST_LINE_KEYS)[number];

/** Seeded editorial-list categories (owner, S4; admin-editable after). */
export const LIST_CATEGORY_SEED: readonly { key: string; label: string; sort: number }[] = [
  { key: 'goty', label: 'Game of the Year', sort: 1 },
  { key: 'best-of-year', label: 'Best games of the year', sort: 2 },
];

/** Title phrases that make an article a LIST CANDIDATE (editor queue; admin-editable). */
export const LIST_DETECT_DEFAULTS: { patterns: string[]; gotyPatterns: string[] } = {
  patterns: [
    'best games of',
    'game of the year',
    'games of the year',
    'goty',
    'top 10 games of',
    'top 20 games of',
    'top 25 games of',
    'top 50 games of',
    'top 100 games of',
  ],
  gotyPatterns: ['game of the year', 'goty'],
};

/** Search result groups (studios arrive with S6). */
export const SEARCH_GROUPS = ['games', 'stories', 'sources'] as const;
export type SearchGroup = (typeof SEARCH_GROUPS)[number];
