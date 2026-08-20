import { pgEnum } from 'drizzle-orm/pg-core';
import {
  AD_PLACEMENT_STATUSES,
  AD_SLOT_FALLBACKS,
  AI_ASSET_FLAGS,
  ARTICLE_ORIGINS,
  ARTICLE_TYPES,
  AUDIT_ACTIONS,
  AWARD_CATEGORY_KINDS,
  AWARD_OUTCOME_TYPES,
  AWARD_PHASES,
  EXTERNAL_RATING_KINDS,
  GAME_STATUSES,
  LAUNCH_STATE_FLAGS,
  NEWSLETTER_CAMPAIGN_KINDS,
  NEWSLETTER_CAMPAIGN_STATUSES,
  SOURCE_STATUSES,
  SUBJECT_TYPES,
  TOPIC_STATUSES,
  UNMATCHED_STATUSES,
  UPCOMING_OVERRIDES,
  USER_STATUSES,
  VIDEO_PROVIDERS,
} from '@gameskeep/shared/constants';

/**
 * Postgres enums for the FIXED structural domains. The user-extensible content
 * lists (topic types, source types, badges, award categories, roles, levels)
 * are lookup TABLES instead (see lookups.ts) so admins can add values without a
 * migration. Enum value arrays come from @gameskeep/shared so the DB and the
 * Zod validators can never drift.
 */
export const subjectTypeEnum = pgEnum('subject_type', SUBJECT_TYPES);
export const articleOriginEnum = pgEnum('article_origin', ARTICLE_ORIGINS);
export const articleTypeEnum = pgEnum('article_type', ARTICLE_TYPES);
export const topicStatusEnum = pgEnum('topic_status', TOPIC_STATUSES);
export const gameStatusEnum = pgEnum('game_status', GAME_STATUSES);
export const awardPhaseEnum = pgEnum('award_phase', AWARD_PHASES);
export const awardCategoryKindEnum = pgEnum('award_category_kind', AWARD_CATEGORY_KINDS);
export const awardOutcomeTypeEnum = pgEnum('award_outcome_type', AWARD_OUTCOME_TYPES);
export const adPlacementStatusEnum = pgEnum('ad_placement_status', AD_PLACEMENT_STATUSES);
export const adSlotFallbackEnum = pgEnum('ad_slot_fallback', AD_SLOT_FALLBACKS);
export const newsletterCampaignStatusEnum = pgEnum(
  'newsletter_campaign_status',
  NEWSLETTER_CAMPAIGN_STATUSES,
);
export const newsletterCampaignKindEnum = pgEnum(
  'newsletter_campaign_kind',
  NEWSLETTER_CAMPAIGN_KINDS,
);
export const userStatusEnum = pgEnum('user_status', USER_STATUSES);
export const auditActionEnum = pgEnum('audit_action', AUDIT_ACTIONS);
export const aiAssetFlagEnum = pgEnum('ai_asset_flag', AI_ASSET_FLAGS);
export const launchStateFlagEnum = pgEnum('launch_state_flag', LAUNCH_STATE_FLAGS);
export const sourceStatusEnum = pgEnum('source_status', SOURCE_STATUSES);
export const videoProviderEnum = pgEnum('video_provider', VIDEO_PROVIDERS);
export const externalRatingKindEnum = pgEnum('external_rating_kind', EXTERNAL_RATING_KINDS);
export const sysReqKindEnum = pgEnum('sys_req_kind', ['minimum', 'recommended']);
export const unmatchedStatusEnum = pgEnum('unmatched_status', UNMATCHED_STATUSES);
export const upcomingOverrideEnum = pgEnum('upcoming_override', UPCOMING_OVERRIDES);
