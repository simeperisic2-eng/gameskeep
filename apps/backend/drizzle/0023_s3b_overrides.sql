CREATE TYPE "public"."badge_override_state" AS ENUM('granted', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."curation_list" AS ENUM('related-stories', 'related-games', 'coverage-rows', 'top-rated', 'most-discussed', 'coming-soon');--> statement-breakpoint
CREATE TYPE "public"."curation_page" AS ENUM('topic', 'game', 'discovery');--> statement-breakpoint
CREATE TABLE "curation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_kind" "curation_page" NOT NULL,
	"page_key" varchar(160) NOT NULL,
	"list_key" "curation_list" NOT NULL,
	"pins" text[] DEFAULT '{}'::text[] NOT NULL,
	"excludes" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topic_editorial_carryover" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(200) NOT NULL,
	"member_guids" text[] DEFAULT '{}'::text[] NOT NULL,
	"locked_fields" text[] DEFAULT '{}'::text[] NOT NULL,
	"fields" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_badge_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"badge_id" uuid NOT NULL,
	"state" "badge_override_state" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "reputation_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "locked_fields" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "noindex" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD COLUMN "disconnect_band_override" varchar(20);--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD COLUMN "disconnect_band_override_reason" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "noindex" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD COLUMN "show_delta" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD COLUMN "hide_delta_refs" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "game_tags" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_badge_overrides" ADD CONSTRAINT "user_badge_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_badge_overrides" ADD CONSTRAINT "user_badge_overrides_badge_id_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."badges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "curation_page_list_unique" ON "curation" USING btree ("page_kind","page_key","list_key");--> statement-breakpoint
CREATE UNIQUE INDEX "user_badge_overrides_unique" ON "user_badge_overrides" USING btree ("user_id","badge_id");--> statement-breakpoint
-- Phase P S3b (hand-written): Pay-to-win exists ONLY as the issue tag. Park the
-- legacy flags (the boot-time tags job turns them into Pay-to-win issue tags and
-- removes the parked list), then drop the column.
INSERT INTO "app_settings" ("key", "value")
SELECT 'legacy-predatory', jsonb_build_object('gameIds', jsonb_agg("game_id"), 'at', now())
FROM "game_content_flags" WHERE "predatory_monetization"
HAVING count(*) > 0
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
ALTER TABLE "game_content_flags" DROP COLUMN "predatory_monetization";--> statement-breakpoint
-- An editor's earlier removals start their pushback clock at the last change.
UPDATE "game_tags" SET "removed_at" = "updated_at" WHERE "state" = 'rejected' AND "removed_at" IS NULL;