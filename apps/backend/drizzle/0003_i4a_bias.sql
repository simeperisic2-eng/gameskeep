ALTER TABLE "topics" ADD COLUMN "bias_distribution" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "seed_game_ref" varchar(200);--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "seed_event_kind" varchar(40);--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "influence_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "quality_breakdown" jsonb;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "influence_override" smallint;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "quality_override" smallint;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "influence_override_reason" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "quality_override_reason" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "editor_note" text;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "event_kind" varchar(40);