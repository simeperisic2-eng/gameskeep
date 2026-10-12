ALTER TABLE "homepage_sections" DROP CONSTRAINT "homepage_sections_promoted_discovery_only";--> statement-breakpoint
ALTER TABLE "ad_placements" DROP CONSTRAINT "ad_placements_section_kind_discovery";--> statement-breakpoint
ALTER TABLE "ad_placements" DROP CONSTRAINT "ad_placements_section_pair";--> statement-breakpoint
ALTER TABLE "ad_placements" DROP CONSTRAINT "ad_placements_promoted_game";--> statement-breakpoint
ALTER TABLE "ad_placements" DROP CONSTRAINT "ad_placements_section_discovery_fk";
--> statement-breakpoint
ALTER TABLE "ad_placements" DROP CONSTRAINT "ad_placements_promoted_game_fk";
--> statement-breakpoint
DROP INDEX "subjects_id_type";--> statement-breakpoint
DROP INDEX "homepage_sections_id_kind";--> statement-breakpoint
DROP INDEX "ad_placements_one_active_per_section";--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD COLUMN "paid_positions" smallint[] DEFAULT '{}'::smallint[] NOT NULL;--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD COLUMN "min_items" smallint;--> statement-breakpoint
ALTER TABLE "ad_placements" ADD COLUMN "promoted_topic_slug" varchar(200);--> statement-breakpoint
ALTER TABLE "ad_slots" ADD COLUMN "list_position" smallint;--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_section_id_homepage_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."homepage_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD CONSTRAINT "homepage_sections_paid_positions" CHECK (cardinality(paid_positions) <= 24 AND 1 <= ALL (paid_positions) AND 24 >= ALL (paid_positions));--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD CONSTRAINT "homepage_sections_min_items" CHECK (min_items IS NULL OR min_items BETWEEN 1 AND 24);--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_one_promoted" CHECK (num_nonnulls(promoted_subject_id, promoted_topic_slug) <= 1);--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_section_item" CHECK (section_id IS NULL OR num_nonnulls(promoted_subject_id, promoted_topic_slug) = 1);--> statement-breakpoint
-- Backfills (hand-written): the one discovery position becomes the first paid
-- position; Trending hides below 3 qualifying stories (owner default).
UPDATE "homepage_sections" SET "paid_positions" = ARRAY["promoted_position"]::smallint[] WHERE "promoted_position" IS NOT NULL;--> statement-breakpoint
UPDATE "homepage_sections" SET "min_items" = 3 WHERE "key" = 'trending' AND "min_items" IS NULL;