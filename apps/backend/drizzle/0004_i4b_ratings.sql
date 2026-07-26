CREATE TABLE "game_dlc" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"price_cents" integer,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"release_date" text,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_flag_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"flag_key" varchar(40) NOT NULL,
	"suggested_value" varchar(80) NOT NULL,
	"reporter_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_content_flags" ADD COLUMN "complexity_rating" smallint;--> statement-breakpoint
ALTER TABLE "game_critic_reviews" ADD COLUMN "native_score" real;--> statement-breakpoint
ALTER TABLE "game_critic_reviews" ADD COLUMN "native_scale_max" smallint;--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD COLUMN "community_our_naive_score" smallint;--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD COLUMN "community_burst_flag" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD COLUMN "community_burst_info" jsonb;--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD COLUMN "disconnect_band" varchar(20);--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD COLUMN "disconnect_detail" jsonb;--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD COLUMN "critics_override" smallint;--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD COLUMN "critics_override_reason" text;--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD COLUMN "community_override" smallint;--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD COLUMN "community_override_reason" text;--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD COLUMN "burst_flag_override" boolean;--> statement-breakpoint
ALTER TABLE "game_rating_summaries" ADD COLUMN "burst_flag_override_reason" text;--> statement-breakpoint
ALTER TABLE "game_user_ratings" ADD COLUMN "rated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "game_user_ratings" ADD COLUMN "has_verified_playtime" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "game_dlc" ADD CONSTRAINT "game_dlc_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_flag_reports" ADD CONSTRAINT "game_flag_reports_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_flag_reports" ADD CONSTRAINT "game_flag_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "game_dlc_game_idx" ON "game_dlc" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_flag_reports_game_idx" ON "game_flag_reports" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_user_rating_game_rated_idx" ON "game_user_ratings" USING btree ("game_id","rated_at");