import { eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { z } from 'zod';
import {
  AI_ASSET_FLAGS,
  ARTICLE_ORIGINS,
  ARTICLE_TYPES,
  AWARD_CATEGORY_KINDS,
  AWARD_OUTCOME_TYPES,
  AWARD_PHASES,
  EXTERNAL_RATING_KINDS,
  GAME_STATUSES,
  LAUNCH_STATE_FLAGS,
  SOURCE_STATUSES,
  SUBJECT_TYPES,
  TOPIC_STATUSES,
  UNMATCHED_STATUSES,
  USER_STATUSES,
  VIDEO_PROVIDERS,
} from '@gameskeep/shared/constants';
import {
  articleCreate,
  articleUpdate,
  awardCategoryCreate,
  awardEditionCategoryCreate,
  awardEditionCreate,
  awardNominationCreate,
  awardOutcomeCreate,
  badgeCreate,
  gameCreate,
  gameContentFlagsCreate,
  gameCriticReviewCreate,
  gameDlcCreate,
  gameExternalRatingCreate,
  gameFlagReportCreate,
  gamePlayerCountCreate,
  gamePriceCreate,
  gameReviewCreate,
  gameSystemRequirementCreate,
  gameUserRatingCreate,
  gameVideoCreate,
  roleCreate,
  sourceCreate,
  sourceTypeCreate,
  subjectCreate,
  topicCreate,
  topicTypeCreate,
  unmatchedGameCreate,
  userCreate,
  userLevelCreate,
} from '@gameskeep/shared/validation';
import * as schema from '../db/schema';
import { db } from '../db/client';
import { slugify } from '../lib/slug';
import { diffRows, writeAudit } from './audit';

export { slugify };
import { getRow, insertRow, slugTaken, type Row, updateRow } from './crud';

/** A form field descriptor — drives the generic admin UI (the `_meta` endpoint). */
export interface FieldSpec {
  name: string;
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'enum' | 'json' | 'date' | 'datetime' | 'ref';
  required?: boolean;
  options?: readonly string[];
  /** For `ref` fields: the resource name whose rows populate a dropdown. */
  ref?: string;
  help?: string;
}

const F = {
  text: (name: string, required = false): FieldSpec => ({ name, type: 'text', required }),
  area: (name: string): FieldSpec => ({ name, type: 'textarea' }),
  num: (name: string, required = false): FieldSpec => ({ name, type: 'number', required }),
  bool: (name: string): FieldSpec => ({ name, type: 'boolean' }),
  enum: (name: string, options: readonly string[], required = false): FieldSpec => ({
    name,
    type: 'enum',
    options,
    required,
  }),
  json: (name: string): FieldSpec => ({ name, type: 'json', help: 'JSON (array or object)' }),
  date: (name: string): FieldSpec => ({ name, type: 'date', help: 'YYYY-MM-DD' }),
  dt: (name: string): FieldSpec => ({ name, type: 'datetime', help: 'ISO date-time' }),
  ref: (name: string, ref: string, required = false): FieldSpec => ({
    name,
    type: 'ref',
    ref,
    required,
  }),
};

/** Custom per-operation overrides (used by the Game composite resource). */
export interface ResourceOps {
  list?: () => Promise<Row[]>;
  get?: (id: string) => Promise<Row | null>;
  create?: (input: Row, actor: { label: string }) => Promise<Row>;
  update?: (
    id: string,
    input: Row,
    rawKeys: string[],
    actor: { label: string },
  ) => Promise<Row | null>;
  remove?: (id: string, actor: { label: string }) => Promise<Row | null>;
}

export interface ResourceDef {
  name: string;
  label: string;
  table: PgTable;
  create: z.ZodType;
  update: z.ZodType;
  fields: FieldSpec[];
  labelColumn: string;
  hasSlug?: boolean;
  slugFrom?: string;
  ops?: ResourceOps;
  /**
   * I6 hardening (MED): secret columns stripped from every CRUD payload and
   * every audit snapshot (e.g. users.passwordHash). Values render as
   * '[REDACTED]' when set, null when null — never the stored secret.
   */
  redactFields?: string[];
  /**
   * I6 hardening (CRITICAL — broken access control, review #1): the minimum
   * staff rank allowed to CRUD this resource, enforced in the route handler on
   * the RESOLVED resource object — NOT via URL-string section classification
   * (which a percent-encoded section could evade). Owner-only (50) for the
   * identity/authority tables. The service token carries owner rank, so
   * automation is unaffected.
   */
  minRank?: number;
}

/** Generate a slug that isn't already taken in the table (base, base-2, …). */
export async function uniqueSlug(table: PgTable, base: string): Promise<string> {
  const root = slugify(base);
  let candidate = root;
  let n = 1;
  while (await slugTaken(table, candidate)) {
    n += 1;
    candidate = `${root}-${n}`;
    if (n > 50) {
      candidate = `${root}-${Date.now()}`;
      break;
    }
  }
  return candidate;
}

// ── Game: a composite resource (Subject + Game) ──────────────────────────────
// Identity (name/slug) lives on `subjects`; metadata on `games`. The admin
// presents one flat object; these ops keep the two rows in sync.

function flattenGame(game: Row, subject: Row): Row {
  return { ...game, name: subject.name, slug: subject.slug };
}

async function gameList(): Promise<Row[]> {
  const rows = await db
    .select()
    .from(schema.games)
    .innerJoin(schema.subjects, eq(schema.games.subjectId, schema.subjects.id));
  return rows.map((r) => flattenGame(r.games as Row, r.subjects as Row));
}

async function gameGet(id: string): Promise<Row | null> {
  const game = await getRow(schema.games, id);
  if (!game) return null;
  const subject = await getRow(schema.subjects, game.subjectId as string);
  if (!subject) return null;
  return flattenGame(game, subject);
}

async function gameCreateOp(input: Row, actor: { label: string }): Promise<Row> {
  const { name, slug, ...gameFields } = input;
  const finalSlug =
    (slug as string | undefined) ?? (await uniqueSlug(schema.subjects, String(name)));
  const subject = await insertRow(schema.subjects, {
    type: 'game',
    slug: finalSlug,
    name,
  });
  const game = await insertRow(schema.games, { ...gameFields, subjectId: subject.id });
  const flat = flattenGame(game, subject);
  await writeAudit({
    action: 'create',
    entityType: 'games',
    entityId: game.id as string,
    changes: { created: flat },
    actor,
  });
  return flat;
}

async function gameUpdateOp(
  id: string,
  input: Row,
  rawKeys: string[],
  actor: { label: string },
): Promise<Row | null> {
  const before = await gameGet(id);
  if (!before) return null;
  const game = await getRow(schema.games, id);
  if (!game) return null;
  const subjectId = game.subjectId as string;

  const subjectPatch: Row = {};
  if (rawKeys.includes('name')) subjectPatch.name = input.name;
  if (rawKeys.includes('slug')) subjectPatch.slug = input.slug;
  if (Object.keys(subjectPatch).length > 0)
    await updateRow(schema.subjects, subjectId, subjectPatch);

  const gamePatch: Row = {};
  for (const key of rawKeys) {
    if (key === 'name' || key === 'slug') continue;
    if (key in input) gamePatch[key] = input[key];
  }
  if (Object.keys(gamePatch).length > 0) await updateRow(schema.games, id, gamePatch);

  const after = await gameGet(id);
  if (after) {
    await writeAudit({
      action: 'update',
      entityType: 'games',
      entityId: id,
      changes: diffRows(before, after),
      actor,
    });
  }
  return after;
}

async function gameRemoveOp(id: string, actor: { label: string }): Promise<Row | null> {
  const flat = await gameGet(id);
  if (!flat) return null;
  // Deleting the parent Subject cascades to the game row and all its links.
  await db.delete(schema.subjects).where(eq(schema.subjects.id, flat.subjectId as string));
  await writeAudit({
    action: 'delete',
    entityType: 'games',
    entityId: id,
    changes: { deleted: flat },
    actor,
  });
  return flat;
}

// ── the resource table ───────────────────────────────────────────────────────
const lookupFields = (extra: FieldSpec[] = []): FieldSpec[] => [
  F.text('key', true),
  F.text('label', true),
  ...extra,
  F.num('sort'),
];

export const RESOURCES: ResourceDef[] = [
  // extensible content lists
  {
    name: 'roles',
    label: 'Roles',
    table: schema.roles,
    create: roleCreate,
    update: roleCreate.partial(),
    minRank: 50, // owner-only: editing the rank ladder is a privilege-escalation surface
    labelColumn: 'label',
    fields: [
      F.text('key', true),
      F.text('label', true),
      F.num('rank', true),
      F.bool('isStaff'),
      F.num('sort'),
    ],
  },
  {
    name: 'user-levels',
    label: 'User levels',
    table: schema.userLevels,
    create: userLevelCreate,
    update: userLevelCreate.partial(),
    labelColumn: 'label',
    fields: [F.text('key', true), F.text('label', true), F.num('rank', true), F.num('sort')],
  },
  {
    name: 'topic-types',
    label: 'Topic types',
    table: schema.topicTypes,
    create: topicTypeCreate,
    update: topicTypeCreate.partial(),
    labelColumn: 'label',
    fields: lookupFields([F.area('description'), F.bool('isActive')]),
  },
  {
    name: 'source-types',
    label: 'Source types',
    table: schema.sourceTypes,
    create: sourceTypeCreate,
    update: sourceTypeCreate.partial(),
    labelColumn: 'label',
    fields: lookupFields([F.bool('isActive')]),
  },
  {
    name: 'badges',
    label: 'Badges',
    table: schema.badges,
    create: badgeCreate,
    update: badgeCreate.partial(),
    labelColumn: 'label',
    fields: lookupFields([F.area('description'), F.text('iconUrl'), F.bool('isActive')]),
  },
  {
    name: 'award-categories',
    label: 'Award categories',
    table: schema.awardCategories,
    create: awardCategoryCreate,
    update: awardCategoryCreate.partial(),
    labelColumn: 'label',
    fields: lookupFields([
      F.area('description'),
      F.enum('kind', AWARD_CATEGORY_KINDS),
      F.bool('isActive'),
    ]),
  },

  // core models
  {
    name: 'subjects',
    label: 'Subjects',
    table: schema.subjects,
    create: subjectCreate,
    update: subjectCreate.partial(),
    labelColumn: 'name',
    hasSlug: true,
    slugFrom: 'name',
    fields: [
      F.enum('type', SUBJECT_TYPES, true),
      F.text('slug'),
      F.text('name', true),
      F.area('description'),
    ],
  },
  {
    name: 'games',
    label: 'Games',
    table: schema.games,
    create: gameCreate,
    update: gameCreate.partial(),
    labelColumn: 'name',
    ops: {
      list: gameList,
      get: gameGet,
      create: gameCreateOp,
      update: gameUpdateOp,
      remove: gameRemoveOp,
    },
    fields: [
      F.text('name', true),
      F.text('slug'),
      F.text('summary'),
      F.area('description'),
      F.enum('status', GAME_STATUSES),
      F.date('releaseDate'),
      F.text('developer'),
      F.text('publisher'),
      F.text('engine'),
      F.text('ageRatingSystem'),
      F.text('ageRatingValue'),
      F.text('series'),
      F.json('mode'),
      F.json('genres'),
      F.json('platforms'),
      F.json('tags'),
      F.json('screenshots'),
      F.text('coverUrl'),
      F.text('backgroundUrl'),
      F.json('socialLinks'),
      F.num('steamAppId'),
      F.num('hltbMainHours'),
      F.num('hltbCompletionistHours'),
      F.num('steamCompletionRate'),
      F.json('externalRefs'),
    ],
  },
  {
    name: 'sources',
    label: 'Sources',
    table: schema.sources,
    create: sourceCreate,
    update: sourceCreate.partial(),
    labelColumn: 'name',
    hasSlug: true,
    slugFrom: 'name',
    fields: [
      F.text('name', true),
      F.text('slug'),
      F.text('logoUrl'),
      F.text('websiteUrl'),
      F.text('rssUrl'),
      F.area('description'),
      F.ref('typeId', 'source-types'),
      F.text('parentCompany'),
      F.enum('status', SOURCE_STATUSES),
      F.text('adapterKey'),
      F.num('pullFrequencyMinutes'),
      F.num('pullDepth'),
      F.bool('pullEnabled'),
      F.num('reputationBaseline'),
      F.num('reputationCommercial'),
      F.num('reputationGeneral'),
    ],
  },
  {
    name: 'topics',
    label: 'Topics',
    table: schema.topics,
    create: topicCreate,
    update: topicCreate.partial(),
    labelColumn: 'title',
    hasSlug: true,
    slugFrom: 'title',
    fields: [
      F.text('title', true),
      F.text('slug'),
      F.text('tldr'),
      F.area('aiSummary'),
      F.enum('status', TOPIC_STATUSES),
      F.ref('typeId', 'topic-types'),
    ],
  },
  {
    name: 'articles',
    label: 'Articles',
    table: schema.articles,
    create: articleCreate,
    update: articleUpdate,
    labelColumn: 'title',
    hasSlug: true,
    slugFrom: 'title',
    fields: [
      F.text('title', true),
      F.text('slug'),
      F.enum('origin', ARTICLE_ORIGINS, true),
      F.enum('articleType', ARTICLE_TYPES, true),
      F.ref('sourceId', 'sources'),
      F.text('author'),
      F.text('url'),
      F.text('thumbnailUrl'),
      F.area('excerpt'),
      F.area('body'),
      F.area('aiSummary'),
      F.dt('publishDate'),
      F.bool('isPaywalled'),
      F.bool('hasAffiliateLinks'),
      F.bool('isSponsored'),
      F.bool('basedOnReviewCopy'),
      F.num('influenceScore'),
      F.num('qualityScore'),
      F.area('internalAssessment'),
    ],
  },
  {
    name: 'users',
    label: 'Users',
    table: schema.users,
    create: userCreate,
    update: userCreate.partial(),
    redactFields: ['passwordHash'],
    minRank: 50, // owner-only: editing a user can re-assign a role (privilege escalation)
    labelColumn: 'username',
    fields: [
      F.text('username', true),
      F.text('email', true),
      F.text('displayName'),
      F.text('avatarUrl'),
      F.area('bio'),
      F.ref('roleId', 'roles', true),
      F.ref('levelId', 'user-levels'),
      F.num('reputation'),
      F.bool('isEmailVerified'),
      F.enum('status', USER_STATUSES),
    ],
  },

  // awards
  {
    name: 'award-editions',
    label: 'Award editions',
    table: schema.awardEditions,
    create: awardEditionCreate,
    update: awardEditionCreate.partial(),
    labelColumn: 'name',
    fields: [
      F.num('year', true),
      F.text('name', true),
      F.enum('phase', AWARD_PHASES),
      F.area('description'),
      F.dt('votingOpensAt'),
      F.dt('votingClosesAt'),
      F.bool('isPublished'),
    ],
  },
  {
    name: 'award-edition-categories',
    label: 'Award edition categories',
    table: schema.awardEditionCategories,
    create: awardEditionCategoryCreate,
    update: awardEditionCategoryCreate.partial(),
    labelColumn: 'id',
    fields: [
      F.ref('editionId', 'award-editions', true),
      F.ref('categoryId', 'award-categories', true),
      F.text('sponsorSlotLabel'),
      F.bool('sponsorSold'),
      F.num('sort'),
    ],
  },
  {
    name: 'award-nominations',
    label: 'Award nominations',
    table: schema.awardNominations,
    create: awardNominationCreate,
    update: awardNominationCreate.partial(),
    labelColumn: 'id',
    fields: [
      F.ref('editionCategoryId', 'award-edition-categories', true),
      F.ref('subjectId', 'subjects', true),
      F.area('blurb'),
    ],
  },
  {
    name: 'award-outcomes',
    label: 'Award outcomes',
    table: schema.awardOutcomes,
    create: awardOutcomeCreate,
    update: awardOutcomeCreate.partial(),
    labelColumn: 'id',
    fields: [
      F.ref('editionCategoryId', 'award-edition-categories', true),
      F.enum('outcomeType', AWARD_OUTCOME_TYPES, true),
      F.ref('nominationId', 'award-nominations', true),
    ],
  },

  // game sub-resources (auto + manual override surfaces)
  {
    name: 'game-reviews',
    label: 'Our reviews',
    table: schema.gameReviews,
    create: gameReviewCreate,
    update: gameReviewCreate.partial(),
    labelColumn: 'verdict',
    fields: [
      F.ref('gameId', 'games', true),
      F.ref('authorUserId', 'users'),
      F.text('verdict'),
      F.json('pros'),
      F.json('cons'),
      F.text('platformTested'),
      F.num('hoursPlayed'),
      F.area('body'),
      F.num('ourScore'),
      F.dt('publishedAt'),
    ],
  },
  {
    name: 'game-critic-reviews',
    label: 'Critic reviews',
    table: schema.gameCriticReviews,
    create: gameCriticReviewCreate,
    update: gameCriticReviewCreate.partial(),
    labelColumn: 'outletName',
    fields: [
      F.ref('gameId', 'games', true),
      F.text('outletName', true),
      F.ref('sourceId', 'sources'),
      F.num('score', true),
      F.num('nativeScore'),
      F.num('nativeScaleMax'),
      F.area('excerpt'),
      F.text('url'),
      F.date('reviewDate'),
    ],
  },
  {
    name: 'game-external-ratings',
    label: 'External ratings',
    table: schema.gameExternalRatings,
    create: gameExternalRatingCreate,
    update: gameExternalRatingCreate.partial(),
    labelColumn: 'label',
    fields: [
      F.ref('gameId', 'games', true),
      F.enum('kind', EXTERNAL_RATING_KINDS, true),
      F.text('label', true),
      F.num('score'),
      F.num('sentimentPct'),
      F.num('sampleSize'),
      F.bool('isEstimate'),
      F.area('note'),
      F.text('url'),
    ],
  },
  {
    name: 'game-content-flags',
    label: 'Content flags',
    table: schema.gameContentFlags,
    create: gameContentFlagsCreate,
    update: gameContentFlagsCreate.partial(),
    labelColumn: 'id',
    fields: [
      F.ref('gameId', 'games', true),
      F.enum('aiAssets', AI_ASSET_FLAGS),
      F.enum('launchState', LAUNCH_STATE_FLAGS),
      F.bool('hasMicrotransactions'),
      F.bool('hasBattlePass'),
      F.bool('hasLootBoxesOrGacha'),
      F.bool('predatoryMonetization'),
      F.num('complexityRating'),
      F.area('notes'),
    ],
  },
  {
    name: 'game-dlc',
    label: 'DLC',
    table: schema.gameDlc,
    create: gameDlcCreate,
    update: gameDlcCreate.partial(),
    labelColumn: 'name',
    fields: [
      F.ref('gameId', 'games', true),
      F.text('name', true),
      F.num('priceCents'),
      F.text('currency'),
      F.date('releaseDate'),
      F.text('url'),
    ],
  },
  {
    name: 'game-flag-reports',
    label: 'Community flag reports',
    table: schema.gameFlagReports,
    create: gameFlagReportCreate,
    update: gameFlagReportCreate.partial(),
    labelColumn: 'flagKey',
    fields: [
      F.ref('gameId', 'games', true),
      F.text('flagKey', true),
      F.text('suggestedValue', true),
      F.ref('reporterUserId', 'users'),
      F.area('note'),
    ],
  },
  {
    name: 'game-videos',
    label: 'Videos & streams',
    table: schema.gameVideos,
    create: gameVideoCreate,
    update: gameVideoCreate.partial(),
    labelColumn: 'title',
    fields: [
      F.ref('gameId', 'games', true),
      F.enum('provider', VIDEO_PROVIDERS),
      F.text('videoUrl', true),
      F.text('title'),
      F.text('kind'),
      F.bool('isPinned'),
      F.bool('isLive'),
      F.num('sort'),
    ],
  },
  {
    name: 'game-prices',
    label: 'Prices',
    table: schema.gamePrices,
    create: gamePriceCreate,
    update: gamePriceCreate.partial(),
    labelColumn: 'store',
    fields: [
      F.ref('gameId', 'games', true),
      F.text('store'),
      F.text('platform'),
      F.text('currency'),
      F.num('priceCents', true),
      F.num('discountPct'),
      F.bool('isOnSale'),
      F.text('url'),
    ],
  },
  {
    name: 'game-system-requirements',
    label: 'System requirements',
    table: schema.gameSystemRequirements,
    create: gameSystemRequirementCreate,
    update: gameSystemRequirementCreate.partial(),
    labelColumn: 'kind',
    fields: [
      F.ref('gameId', 'games', true),
      F.text('platform'),
      F.enum('kind', ['minimum', 'recommended'], true),
      F.text('cpu'),
      F.text('gpu'),
      F.num('ramGb'),
      F.num('storageGb'),
      F.text('os'),
      F.area('notes'),
    ],
  },
  {
    name: 'game-player-counts',
    label: 'Player counts',
    table: schema.gamePlayerCounts,
    create: gamePlayerCountCreate,
    update: gamePlayerCountCreate.partial(),
    labelColumn: 'source',
    fields: [
      F.ref('gameId', 'games', true),
      F.text('source'),
      F.num('currentPlayers'),
      F.num('peakPlayers'),
      F.dt('capturedAt'),
    ],
  },
  {
    name: 'game-user-ratings',
    label: 'Community ratings',
    table: schema.gameUserRatings,
    create: gameUserRatingCreate,
    update: gameUserRatingCreate.partial(),
    labelColumn: 'id',
    fields: [
      F.ref('gameId', 'games', true),
      F.ref('userId', 'users', true),
      F.num('score', true),
      F.num('weight'),
      F.dt('ratedAt'),
      F.bool('hasVerifiedPlaytime'),
    ],
  },

  // catalog (I2): unmatched-game queue — generic browse/edit/delete; the
  // resolve workflow (link/create/dismiss/retry) lives in catalog-routes.ts.
  {
    name: 'unmatched-games',
    label: 'Unmatched games',
    table: schema.unmatchedGames,
    create: unmatchedGameCreate,
    update: unmatchedGameCreate.partial(),
    labelColumn: 'rawName',
    fields: [
      F.text('rawName', true),
      F.json('rawContext'),
      F.enum('status', UNMATCHED_STATUSES),
      F.ref('resolvedSubjectId', 'subjects'),
      F.area('resolutionNote'),
    ],
  },
];

export const RESOURCE_BY_NAME = new Map(RESOURCES.map((r) => [r.name, r]));

export function listResourceMeta() {
  return RESOURCES.map((r) => ({
    name: r.name,
    label: r.label,
    labelColumn: r.labelColumn,
    hasSlug: Boolean(r.hasSlug),
    fields: r.fields,
  }));
}
