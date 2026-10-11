CREATE TYPE "public"."integrity_signal_kind" AS ENUM('review_copy', 'embargo', 'sponsored_event');--> statement-breakpoint
CREATE TYPE "public"."integrity_signal_origin" AS ENUM('auto', 'editor');--> statement-breakpoint
CREATE TYPE "public"."integrity_signal_status" AS ENUM('detected', 'confirmed', 'dismissed');--> statement-breakpoint
CREATE TABLE "article_integrity_signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"kind" "integrity_signal_kind" NOT NULL,
	"origin" "integrity_signal_origin" NOT NULL,
	"status" "integrity_signal_status" DEFAULT 'detected' NOT NULL,
	"evidence_snippet" varchar(240),
	"editor_note" varchar(500),
	"evidence_date" timestamp with time zone,
	"decided_by_user_id" uuid,
	"decided_by_label" varchar(120),
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_integrity_has_evidence" CHECK ("article_integrity_signals"."evidence_snippet" IS NOT NULL OR "article_integrity_signals"."editor_note" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "article_integrity_signals" ADD CONSTRAINT "article_integrity_signals_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_integrity_signals" ADD CONSTRAINT "article_integrity_signals_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "article_integrity_one_per_kind" ON "article_integrity_signals" USING btree ("article_id","kind");--> statement-breakpoint
CREATE INDEX "article_integrity_status_idx" ON "article_integrity_signals" USING btree ("status");