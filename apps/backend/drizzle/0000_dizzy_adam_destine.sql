CREATE TYPE "public"."ai_asset_flag" AS ENUM('unknown', 'no', 'partial', 'yes');--> statement-breakpoint
CREATE TYPE "public"."article_origin" AS ENUM('aggregated', 'ours');--> statement-breakpoint
CREATE TYPE "public"."article_type" AS ENUM('news', 'review', 'opinion', 'preview', 'guide');--> statement-breakpoint
CREATE TYPE "public"."audit_action" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "public"."award_category_kind" AS ENUM('general', 'genre');--> statement-breakpoint
CREATE TYPE "public"."award_outcome_type" AS ENUM('critics', 'community');--> statement-breakpoint
CREATE TYPE "public"."award_phase" AS ENUM('announce', 'nominations', 'voting', 'reveal', 'archive');--> statement-breakpoint
CREATE TYPE "public"."external_rating_kind" AS ENUM('steam', 'metacritic', 'opencritic', 'reddit', 'other');--> statement-breakpoint
CREATE TYPE "public"."game_status" AS ENUM('announced', 'in_development', 'early_access', 'released', 'delisted');--> statement-breakpoint
CREATE TYPE "public"."launch_state_flag" AS ENUM('unknown', 'polished', 'mixed', 'rough');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."subject_type" AS ENUM('game', 'studio', 'publisher', 'platform');--> statement-breakpoint
CREATE TYPE "public"."sys_req_kind" AS ENUM('minimum', 'recommended');--> statement-breakpoint
CREATE TYPE "public"."topic_status" AS ENUM('developing', 'ongoing', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'banned');--> statement-breakpoint
CREATE TYPE "public"."video_provider" AS ENUM('youtube', 'twitch', 'other');--> statement-breakpoint
CREATE TABLE "award_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(80) NOT NULL,
	"label" varchar(300) NOT NULL,
	"description" text,
	"kind" "award_category_kind" DEFAULT 'general' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "award_categories_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(80) NOT NULL,
	"label" varchar(300) NOT NULL,
	"description" text,
	"icon_url" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "badges_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(80) NOT NULL,
	"label" varchar(300) NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"is_staff" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "source_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(80) NOT NULL,
	"label" varchar(300) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_types_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "topic_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(80) NOT NULL,
	"label" varchar(300) NOT NULL,
	"description" text,
	"sort" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_types_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "user_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(80) NOT NULL,
	"label" varchar(300) NOT NULL,
	"rank" integer DEFAULT 0 NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_levels_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "subject_type" NOT NULL,
	"slug" varchar(160) NOT NULL,
	"name" varchar(300) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(160) NOT NULL,
	"name" varchar(300) NOT NULL,
	"logo_url" text,
	"website_url" text,
	"rss_url" text,
	"description" text,
	"type_id" uuid,
	"parent_company" varchar(200),
	"status" "source_status" DEFAULT 'active' NOT NULL,
	"adapter_key" varchar(80) DEFAULT 'rss-generic' NOT NULL,
	"pull_frequency_minutes" integer DEFAULT 60 NOT NULL,
	"pull_depth" integer DEFAULT 25 NOT NULL,
	"pull_enabled" boolean DEFAULT true NOT NULL,
	"reputation_baseline" real,
	"reputation_commercial" real,
	"reputation_general" real,
	"stat_article_count" integer,
	"stat_affiliate_pct" real,
	"stat_avg_trust" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sources_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_badges" (
	"user_id" uuid NOT NULL,
	"badge_id" uuid NOT NULL,
	"awarded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_badges_user_id_badge_id_pk" PRIMARY KEY("user_id","badge_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(32) NOT NULL,
	"email" varchar(254) NOT NULL,
	"display_name" varchar(80),
	"avatar_url" text,
	"bio" text,
	"role_id" uuid NOT NULL,
	"level_id" uuid,
	"reputation" integer DEFAULT 0 NOT NULL,
	"is_email_verified" boolean DEFAULT false NOT NULL,
	"password_hash" text,
	"vote_weight" real DEFAULT 0 NOT NULL,
	"level_points" integer DEFAULT 0 NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "related_topics" (
	"topic_id" uuid NOT NULL,
	"related_topic_id" uuid NOT NULL,
	CONSTRAINT "related_topics_topic_id_related_topic_id_pk" PRIMARY KEY("topic_id","related_topic_id"),
	CONSTRAINT "related_topics_not_self" CHECK ("related_topics"."topic_id" <> "related_topics"."related_topic_id")
);
--> statement-breakpoint
CREATE TABLE "topic_subjects" (
	"topic_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	CONSTRAINT "topic_subjects_topic_id_subject_id_pk" PRIMARY KEY("topic_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "topic_timeline_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"label" varchar(300) NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(160) NOT NULL,
	"title" varchar(300) NOT NULL,
	"tldr" varchar(400),
	"ai_summary" text,
	"status" "topic_status" DEFAULT 'developing' NOT NULL,
	"type_id" uuid,
	"embedding" vector(384),
	"derived_influence_pct" real,
	"derived_quality_pct" real,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topics_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "article_subjects" (
	"article_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	CONSTRAINT "article_subjects_article_id_subject_id_pk" PRIMARY KEY("article_id","subject_id")
);
--> statement-breakpoint
CREATE TABLE "article_topics" (
	"article_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "article_topics_article_id_topic_id_pk" PRIMARY KEY("article_id","topic_id")
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(200) NOT NULL,
	"source_id" uuid,
	"origin" "article_origin" DEFAULT 'aggregated' NOT NULL,
	"article_type" "article_type" DEFAULT 'news' NOT NULL,
	"title" varchar(300) NOT NULL,
	"author" varchar(200),
	"url" text,
	"thumbnail_url" text,
	"excerpt" text,
	"body" text,
	"ai_summary" text,
	"publish_date" timestamp with time zone,
	"is_paywalled" boolean DEFAULT false NOT NULL,
	"has_affiliate_links" boolean DEFAULT false NOT NULL,
	"is_sponsored" boolean DEFAULT false NOT NULL,
	"based_on_review_copy" boolean DEFAULT false NOT NULL,
	"influence_score" smallint,
	"quality_score" smallint,
	"internal_assessment" text,
	"embedding" vector(384),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "articles_body_only_ours" CHECK ("articles"."origin" = 'ours' OR "articles"."body" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "game_content_flags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"ai_assets" "ai_asset_flag" DEFAULT 'unknown' NOT NULL,
	"launch_state" "launch_state_flag" DEFAULT 'unknown' NOT NULL,
	"has_microtransactions" boolean DEFAULT false NOT NULL,
	"has_battle_pass" boolean DEFAULT false NOT NULL,
	"has_loot_boxes_or_gacha" boolean DEFAULT false NOT NULL,
	"predatory_monetization" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_content_flags_game_id_unique" UNIQUE("game_id")
);
--> statement-breakpoint
CREATE TABLE "game_critic_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"outlet_name" varchar(200) NOT NULL,
	"source_id" uuid,
	"score" smallint NOT NULL,
	"excerpt" text,
	"url" text,
	"review_date" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_external_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"kind" "external_rating_kind" NOT NULL,
	"label" varchar(300) NOT NULL,
	"score" smallint,
	"sentiment_pct" real,
	"sample_size" integer,
	"is_estimate" boolean DEFAULT true NOT NULL,
	"note" text,
	"url" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_player_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"source" varchar(40) DEFAULT 'steam' NOT NULL,
	"current_players" integer,
	"peak_players" integer,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"store" varchar(80) DEFAULT 'steam' NOT NULL,
	"platform" varchar(80),
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"price_cents" integer NOT NULL,
	"discount_pct" smallint DEFAULT 0 NOT NULL,
	"is_on_sale" boolean DEFAULT false NOT NULL,
	"url" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_rating_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"our_score" smallint,
	"critics_score" smallint,
	"critics_outlet_count" integer,
	"community_our_score" smallint,
	"community_our_count" integer,
	"community_web_score" smallint,
	"disconnect_value" smallint,
	"disconnect_context_tag" varchar(200),
	"computed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_rating_summaries_game_id_unique" UNIQUE("game_id")
);
--> statement-breakpoint
CREATE TABLE "game_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"author_user_id" uuid,
	"verdict" varchar(400),
	"pros" text[],
	"cons" text[],
	"platform_tested" varchar(120),
	"hours_played" real,
	"body" text,
	"our_score" smallint,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_reviews_game_id_unique" UNIQUE("game_id")
);
--> statement-breakpoint
CREATE TABLE "game_system_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"platform" varchar(80) DEFAULT 'pc' NOT NULL,
	"kind" "sys_req_kind" NOT NULL,
	"cpu" varchar(200),
	"gpu" varchar(200),
	"ram_gb" integer,
	"storage_gb" integer,
	"os" varchar(200),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_user_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"score" smallint NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_videos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"provider" "video_provider" DEFAULT 'youtube' NOT NULL,
	"video_url" text NOT NULL,
	"title" varchar(300),
	"kind" varchar(40) DEFAULT 'gameplay' NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_live" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" uuid NOT NULL,
	"cover_url" text,
	"background_url" text,
	"summary" varchar(600),
	"description" text,
	"status" "game_status" DEFAULT 'announced' NOT NULL,
	"release_date" text,
	"developer" varchar(200),
	"publisher" varchar(200),
	"engine" varchar(120),
	"age_rating_system" varchar(40),
	"age_rating_value" varchar(40),
	"series" varchar(200),
	"mode" text[],
	"genres" text[],
	"platforms" text[],
	"tags" text[],
	"screenshots" text[],
	"social_links" jsonb,
	"steam_app_id" integer,
	"hltb_main_hours" real,
	"hltb_completionist_hours" real,
	"steam_completion_rate" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_subject_id_unique" UNIQUE("subject_id")
);
--> statement-breakpoint
CREATE TABLE "award_edition_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"sponsor_slot_label" varchar(120),
	"sponsor_sold" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "award_editions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"name" varchar(300) NOT NULL,
	"phase" "award_phase" DEFAULT 'announce' NOT NULL,
	"description" text,
	"voting_opens_at" timestamp with time zone,
	"voting_closes_at" timestamp with time zone,
	"is_published" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "award_editions_year_unique" UNIQUE("year")
);
--> statement-breakpoint
CREATE TABLE "award_nominations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_category_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"blurb" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "award_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_category_id" uuid NOT NULL,
	"outcome_type" "award_outcome_type" NOT NULL,
	"nomination_id" uuid NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "award_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"edition_category_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"nomination_id" uuid NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "article_trust_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"value" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_id" uuid,
	"body" text NOT NULL,
	"is_removed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_bias_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"axis" varchar(20) NOT NULL,
	"value" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"actor_label" varchar(120) DEFAULT 'admin' NOT NULL,
	"action" "audit_action" NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" varchar(80) NOT NULL,
	"changes" jsonb,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_type_id_source_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."source_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badges" ADD CONSTRAINT "user_badges_badge_id_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_level_id_user_levels_id_fk" FOREIGN KEY ("level_id") REFERENCES "public"."user_levels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "related_topics" ADD CONSTRAINT "related_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "related_topics" ADD CONSTRAINT "related_topics_related_topic_id_topics_id_fk" FOREIGN KEY ("related_topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_subjects" ADD CONSTRAINT "topic_subjects_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_subjects" ADD CONSTRAINT "topic_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_timeline_events" ADD CONSTRAINT "topic_timeline_events_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topics" ADD CONSTRAINT "topics_type_id_topic_types_id_fk" FOREIGN KEY ("type_id") REFERENCES "public"."topic_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_subjects" ADD CONSTRAINT "article_subjects_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_subjects" ADD CONSTRAINT "article_subjects_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_topics" ADD CONSTRAINT "article_topics_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_topics" ADD CONSTRAINT "article_topics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_content_flags" ADD CONSTRAINT "game_content_flags_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_critic_reviews" ADD CONSTRAINT "game_critic_reviews_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_critic_reviews" ADD CONSTRAINT "game_critic_reviews_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_external_ratings" ADD CONSTRAINT "game_external_ratings_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_player_counts" ADD CONSTRAINT "game_player_counts_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_prices" ADD CONSTRAINT "game_prices_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD CONSTRAINT "game_rating_summaries_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_reviews" ADD CONSTRAINT "game_reviews_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_reviews" ADD CONSTRAINT "game_reviews_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_system_requirements" ADD CONSTRAINT "game_system_requirements_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_user_ratings" ADD CONSTRAINT "game_user_ratings_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_user_ratings" ADD CONSTRAINT "game_user_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_videos" ADD CONSTRAINT "game_videos_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_edition_categories" ADD CONSTRAINT "award_edition_categories_edition_id_award_editions_id_fk" FOREIGN KEY ("edition_id") REFERENCES "public"."award_editions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_edition_categories" ADD CONSTRAINT "award_edition_categories_category_id_award_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."award_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_nominations" ADD CONSTRAINT "award_nominations_edition_category_id_award_edition_categories_id_fk" FOREIGN KEY ("edition_category_id") REFERENCES "public"."award_edition_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_nominations" ADD CONSTRAINT "award_nominations_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_outcomes" ADD CONSTRAINT "award_outcomes_edition_category_id_award_edition_categories_id_fk" FOREIGN KEY ("edition_category_id") REFERENCES "public"."award_edition_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_outcomes" ADD CONSTRAINT "award_outcomes_nomination_id_award_nominations_id_fk" FOREIGN KEY ("nomination_id") REFERENCES "public"."award_nominations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_votes" ADD CONSTRAINT "award_votes_edition_category_id_award_edition_categories_id_fk" FOREIGN KEY ("edition_category_id") REFERENCES "public"."award_edition_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_votes" ADD CONSTRAINT "award_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "award_votes" ADD CONSTRAINT "award_votes_nomination_id_award_nominations_id_fk" FOREIGN KEY ("nomination_id") REFERENCES "public"."award_nominations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_trust_votes" ADD CONSTRAINT "article_trust_votes_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_trust_votes" ADD CONSTRAINT "article_trust_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_bias_votes" ADD CONSTRAINT "topic_bias_votes_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_bias_votes" ADD CONSTRAINT "topic_bias_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "subjects_type_idx" ON "subjects" USING btree ("type");--> statement-breakpoint
CREATE INDEX "topic_timeline_topic_idx" ON "topic_timeline_events" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "topics_status_idx" ON "topics" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "article_one_primary_topic" ON "article_topics" USING btree ("article_id") WHERE "article_topics"."is_primary";--> statement-breakpoint
CREATE INDEX "articles_source_idx" ON "articles" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "articles_publish_date_idx" ON "articles" USING btree ("publish_date");--> statement-breakpoint
CREATE INDEX "game_critic_reviews_game_idx" ON "game_critic_reviews" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_external_ratings_game_idx" ON "game_external_ratings" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_player_counts_game_idx" ON "game_player_counts" USING btree ("game_id","captured_at");--> statement-breakpoint
CREATE INDEX "game_prices_game_idx" ON "game_prices" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_sysreq_game_idx" ON "game_system_requirements" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_user_rating_unique" ON "game_user_ratings" USING btree ("game_id","user_id");--> statement-breakpoint
CREATE INDEX "game_videos_game_idx" ON "game_videos" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "games_status_idx" ON "games" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "award_edition_category_unique" ON "award_edition_categories" USING btree ("edition_id","category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "award_nomination_unique" ON "award_nominations" USING btree ("edition_category_id","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "award_outcome_unique" ON "award_outcomes" USING btree ("edition_category_id","outcome_type");--> statement-breakpoint
CREATE UNIQUE INDEX "award_vote_one_per_category" ON "award_votes" USING btree ("edition_category_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "article_trust_vote_unique" ON "article_trust_votes" USING btree ("article_id","user_id");--> statement-breakpoint
CREATE INDEX "comments_entity_idx" ON "comments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_unique" ON "reactions" USING btree ("entity_type","entity_id","user_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "topic_bias_vote_unique" ON "topic_bias_votes" USING btree ("topic_id","user_id","axis");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");