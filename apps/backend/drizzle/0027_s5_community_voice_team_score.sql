CREATE TABLE "critic_feed_decisions" (
	"article_guid" varchar(400) PRIMARY KEY NOT NULL,
	"decision" varchar(16) DEFAULT 'dismissed' NOT NULL,
	"note" text,
	"decided_by_label" varchar(120),
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_community_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"status" varchar(12) DEFAULT 'draft' NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"as_of" varchar(10),
	"published_text" text,
	"published_sources" jsonb,
	"published_as_of" varchar(10),
	"editor_user_id" uuid,
	"editor_label" varchar(120),
	"published_at" timestamp with time zone,
	"polish_original" text,
	"polish_candidate" text,
	"polish_ok" boolean,
	"polish_issues" jsonb,
	"polish_provider" varchar(40),
	"polished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_steam_review_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"positive_pct" real,
	"window_days" smallint DEFAULT 30 NOT NULL,
	"summary_text" text,
	"edited_text" text,
	"approved_by_label" varchar(120),
	"approved_at" timestamp with time zone,
	"hidden" boolean DEFAULT false NOT NULL,
	"provider" varchar(20),
	"computed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "tldr_approved_by_label" varchar(120);--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "tldr_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "ai_summary_approved_by_label" varchar(120);--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "ai_summary_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "game_critic_reviews" ADD COLUMN "source_article_guid" varchar(400);--> statement-breakpoint
ALTER TABLE "game_community_notes" ADD CONSTRAINT "game_community_notes_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_community_notes" ADD CONSTRAINT "game_community_notes_editor_user_id_users_id_fk" FOREIGN KEY ("editor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_steam_review_summaries" ADD CONSTRAINT "game_steam_review_summaries_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_community_notes_game_unique" ON "game_community_notes" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_steam_review_summaries_game_unique" ON "game_steam_review_summaries" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "game_critic_reviews_article_unique" ON "game_critic_reviews" USING btree ("source_article_guid");