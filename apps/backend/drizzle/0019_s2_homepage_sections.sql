CREATE TYPE "public"."homepage_section_kind" AS ENUM('data', 'discovery', 'block');--> statement-breakpoint
CREATE TYPE "public"."homepage_section_mode" AS ENUM('auto', 'manual', 'pins_auto');--> statement-breakpoint
CREATE TABLE "homepage_section_pins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"topic_slug" varchar(200),
	"subject_id" uuid,
	"created_by_label" varchar(120),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homepage_pins_one_target" CHECK (num_nonnulls(topic_slug, subject_id) = 1),
	CONSTRAINT "homepage_pins_position_range" CHECK (position BETWEEN 1 AND 24)
);
--> statement-breakpoint
CREATE TABLE "homepage_section_snapshots" (
	"section_key" varchar(40) PRIMARY KEY NOT NULL,
	"payload" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homepage_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(40) NOT NULL,
	"kind" "homepage_section_kind" NOT NULL,
	"title" varchar(80) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"mode" "homepage_section_mode" DEFAULT 'auto' NOT NULL,
	"item_count" smallint DEFAULT 6 NOT NULL,
	"delta_window_hours" integer,
	"card_tag_families" text[] DEFAULT '{}'::text[] NOT NULL,
	"card_tag_count" smallint DEFAULT 0 NOT NULL,
	"rules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"promoted_position" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "homepage_sections_key_unique" UNIQUE("key"),
	CONSTRAINT "homepage_sections_kind_by_key" CHECK ((key IN ('trending', 'latest', 'by_players', 'our_picks', 'focus', 'top_rated') AND kind = 'data') OR (key IN ('featured', 'new', 'upcoming') AND kind = 'discovery') OR (key IN ('briefing', 'genres', 'community', 'newsletter') AND kind = 'block')),
	CONSTRAINT "homepage_sections_promoted_discovery_only" CHECK (promoted_position IS NULL OR (kind = 'discovery' AND promoted_position BETWEEN 1 AND 24)),
	CONSTRAINT "homepage_sections_item_count" CHECK (item_count BETWEEN 1 AND 24),
	CONSTRAINT "homepage_sections_delta_window" CHECK (delta_window_hours IS NULL OR (key IN ('trending', 'by_players') AND delta_window_hours BETWEEN 1 AND 2160)),
	CONSTRAINT "homepage_sections_card_tags" CHECK (card_tag_count BETWEEN 0 AND 10)
);
--> statement-breakpoint
ALTER TABLE "ad_placements" ALTER COLUMN "slot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "source_types" ADD COLUMN "role" varchar(40);--> statement-breakpoint
ALTER TABLE "game_player_counts" ADD COLUMN "demo_seed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_placements" ADD COLUMN "section_id" uuid;--> statement-breakpoint
ALTER TABLE "ad_placements" ADD COLUMN "section_kind" "homepage_section_kind";--> statement-breakpoint
ALTER TABLE "ad_placements" ADD COLUMN "promoted_subject_type" "subject_type" DEFAULT 'game';--> statement-breakpoint
ALTER TABLE "homepage_section_pins" ADD CONSTRAINT "homepage_section_pins_section_id_homepage_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."homepage_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homepage_section_pins" ADD CONSTRAINT "homepage_section_pins_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "homepage_pins_position" ON "homepage_section_pins" USING btree ("section_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "homepage_pins_topic" ON "homepage_section_pins" USING btree ("section_id","topic_slug") WHERE topic_slug IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "homepage_pins_subject" ON "homepage_section_pins" USING btree ("section_id","subject_id") WHERE subject_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "homepage_snapshots_computed_idx" ON "homepage_section_snapshots" USING btree ("computed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "homepage_sections_id_kind" ON "homepage_sections" USING btree ("id","kind");--> statement-breakpoint
-- (hand-ordered) the composite FK below needs this unique index to exist first
CREATE UNIQUE INDEX "subjects_id_type" ON "subjects" USING btree ("id","type");--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_section_discovery_fk" FOREIGN KEY ("section_id","section_kind") REFERENCES "public"."homepage_sections"("id","kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_promoted_game_fk" FOREIGN KEY ("promoted_subject_id","promoted_subject_type") REFERENCES "public"."subjects"("id","type") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_placements_section_idx" ON "ad_placements" USING btree ("section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_placements_one_active_per_section" ON "ad_placements" USING btree ("section_id") WHERE section_id IS NOT NULL AND status = 'active';--> statement-breakpoint
ALTER TABLE "source_types" ADD CONSTRAINT "source_types_role_unique" UNIQUE("role");--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_section_kind_discovery" CHECK (section_kind IS NULL OR section_kind = 'discovery');--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_section_pair" CHECK ((section_id IS NULL) = (section_kind IS NULL));--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_one_target" CHECK (num_nonnulls(slot_id, section_id) = 1);--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_promoted_game" CHECK (promoted_subject_type IS NULL OR promoted_subject_type = 'game');--> statement-breakpoint
-- Backfill (hand-written): the built-in Standalone type gets its stable role.
UPDATE "source_types" SET "role" = 'standalone' WHERE "key" = 'independent' AND "role" IS NULL;