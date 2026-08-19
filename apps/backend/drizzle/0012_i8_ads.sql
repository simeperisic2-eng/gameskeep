CREATE TYPE "public"."ad_placement_status" AS ENUM('draft', 'scheduled', 'active', 'ended');--> statement-breakpoint
CREATE TYPE "public"."ad_slot_fallback" AS ENUM('ad', 'organic', 'hide');--> statement-breakpoint
CREATE TABLE "ad_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slot_id" uuid NOT NULL,
	"advertiser_name" varchar(160) NOT NULL,
	"advertiser_contact" varchar(200),
	"headline" varchar(120) NOT NULL,
	"body" varchar(400),
	"cta_url" text,
	"cta_label" varchar(60),
	"promoted_subject_id" uuid,
	"status" "ad_placement_status" DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"price_cents" integer,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(80) NOT NULL,
	"label" varchar(160) NOT NULL,
	"page" varchar(60) NOT NULL,
	"format" varchar(40) DEFAULT 'card' NOT NULL,
	"fallback" "ad_slot_fallback" DEFAULT 'ad' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ad_slots_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_slot_id_ad_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."ad_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_promoted_subject_id_subjects_id_fk" FOREIGN KEY ("promoted_subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_placements_slot_idx" ON "ad_placements" USING btree ("slot_id");--> statement-breakpoint
CREATE INDEX "ad_placements_status_idx" ON "ad_placements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ad_placements_subject_idx" ON "ad_placements" USING btree ("promoted_subject_id");--> statement-breakpoint
CREATE INDEX "ad_slots_page_idx" ON "ad_slots" USING btree ("page");