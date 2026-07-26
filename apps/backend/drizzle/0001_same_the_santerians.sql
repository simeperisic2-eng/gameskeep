CREATE TYPE "public"."unmatched_status" AS ENUM('pending', 'resolved', 'dismissed');--> statement-breakpoint
CREATE TABLE "unmatched_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_name" varchar(300) NOT NULL,
	"raw_context" jsonb,
	"status" "unmatched_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_tried_at" timestamp with time zone,
	"resolved_subject_id" uuid,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "external_refs" jsonb;--> statement-breakpoint
ALTER TABLE "unmatched_games" ADD CONSTRAINT "unmatched_games_resolved_subject_id_subjects_id_fk" FOREIGN KEY ("resolved_subject_id") REFERENCES "public"."subjects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "unmatched_games_status_idx" ON "unmatched_games" USING btree ("status");