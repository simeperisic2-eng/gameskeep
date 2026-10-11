CREATE TABLE "article_editorial_carryover" (
	"external_guid" varchar(400) NOT NULL,
	"source_id" uuid,
	"influence_override" smallint,
	"quality_override" smallint,
	"influence_override_reason" text,
	"quality_override_reason" text,
	"editor_note" text,
	"internal_assessment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_integrity_signals" DROP CONSTRAINT "article_integrity_signals_article_id_articles_id_fk";
--> statement-breakpoint
ALTER TABLE "article_integrity_signals" ALTER COLUMN "article_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "article_integrity_signals" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "article_integrity_signals" ADD COLUMN "external_guid" varchar(400);--> statement-breakpoint
-- Backfill the stable identity (source + feed guid) of every existing signal.
UPDATE "article_integrity_signals" AS s SET "source_id" = a."source_id", "external_guid" = a."external_guid" FROM "articles" AS a WHERE a."id" = s."article_id";--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "status_locked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "article_editorial_carryover" ADD CONSTRAINT "article_editorial_carryover_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_editorial_carryover_guid" ON "article_editorial_carryover" USING btree ("external_guid");--> statement-breakpoint
ALTER TABLE "article_integrity_signals" ADD CONSTRAINT "article_integrity_signals_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_integrity_signals" ADD CONSTRAINT "article_integrity_signals_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_integrity_identity_kind" ON "article_integrity_signals" USING btree ("external_guid","kind") WHERE "article_integrity_signals"."external_guid" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "article_integrity_signals" ADD CONSTRAINT "article_integrity_has_identity" CHECK ("article_integrity_signals"."article_id" IS NOT NULL OR "article_integrity_signals"."external_guid" IS NOT NULL);