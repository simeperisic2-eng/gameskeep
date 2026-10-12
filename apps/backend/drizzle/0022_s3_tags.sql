CREATE TYPE "public"."game_tag_source" AS ENUM('import', 'players', 'editors');--> statement-breakpoint
CREATE TYPE "public"."game_tag_state" AS ENUM('pending', 'published', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."tag_family" AS ENUM('content', 'issue');--> statement-breakpoint
CREATE TYPE "public"."tag_suggestion_source" AS ENUM('import', 'user');--> statement-breakpoint
CREATE TYPE "public"."tag_suggestion_status" AS ENUM('pending', 'accepted', 'merged', 'rejected');--> statement-breakpoint
CREATE TABLE "game_tag_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"game_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"state" "game_tag_state" DEFAULT 'pending' NOT NULL,
	"source" "game_tag_source" NOT NULL,
	"weighted_score" real DEFAULT 0 NOT NULL,
	"vote_count" integer DEFAULT 0 NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"flag_info" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_vote_at" timestamp with time zone,
	"last_confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" uuid,
	"confirmed_by_label" varchar(120),
	"resolved_at" timestamp with time zone,
	"patch_ref" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_tags_resolved_patch" CHECK ("game_tags"."resolved_at" IS NULL OR "game_tags"."patch_ref" IS NOT NULL),
	CONSTRAINT "game_tags_score_nonneg" CHECK ("game_tags"."weighted_score" >= 0 AND "game_tags"."vote_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tag_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_name" varchar(120) NOT NULL,
	"normalized" varchar(120) NOT NULL,
	"game_id" uuid,
	"source" "tag_suggestion_source" NOT NULL,
	"user_id" uuid,
	"status" "tag_suggestion_status" DEFAULT 'pending' NOT NULL,
	"merged_into_tag_id" uuid,
	"attempts" smallint DEFAULT 1 NOT NULL,
	"decided_by_label" varchar(120),
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family" "tag_family" NOT NULL,
	"slug" varchar(160) NOT NULL,
	"name" varchar(80) NOT NULL,
	"intro" text,
	"aliases" text[] DEFAULT '{}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_tag_votes" ADD CONSTRAINT "game_tag_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_tag_votes" ADD CONSTRAINT "game_tag_votes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_tag_votes" ADD CONSTRAINT "game_tag_votes_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_tags" ADD CONSTRAINT "game_tags_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_tags" ADD CONSTRAINT "game_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_tags" ADD CONSTRAINT "game_tags_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_suggestions" ADD CONSTRAINT "tag_suggestions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_suggestions" ADD CONSTRAINT "tag_suggestions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tag_suggestions" ADD CONSTRAINT "tag_suggestions_merged_into_tag_id_tags_id_fk" FOREIGN KEY ("merged_into_tag_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_tag_votes_unique" ON "game_tag_votes" USING btree ("user_id","game_id","tag_id");--> statement-breakpoint
CREATE INDEX "game_tag_votes_game_tag_idx" ON "game_tag_votes" USING btree ("game_id","tag_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_tags_game_tag_unique" ON "game_tags" USING btree ("game_id","tag_id");--> statement-breakpoint
CREATE INDEX "game_tags_tag_state_idx" ON "game_tags" USING btree ("tag_id","state");--> statement-breakpoint
CREATE INDEX "game_tags_state_idx" ON "game_tags" USING btree ("state");--> statement-breakpoint
CREATE INDEX "tag_suggestions_status_idx" ON "tag_suggestions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "tag_suggestions_pending_unique" ON "tag_suggestions" USING btree ("normalized","game_id") WHERE "tag_suggestions"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "tags_slug_unique" ON "tags" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tags_family_idx" ON "tags" USING btree ("family");