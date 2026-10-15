-- Phase P S4: site search needs trigram matching + accent-free text.
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS unaccent;--> statement-breakpoint
ALTER TYPE "public"."curation_list" ADD VALUE 'results';--> statement-breakpoint
ALTER TYPE "public"."curation_list" ADD VALUE 'consensus';--> statement-breakpoint
ALTER TYPE "public"."curation_list" ADD VALUE 'comparison-lines';--> statement-breakpoint
ALTER TYPE "public"."curation_list" ADD VALUE 'editorial-lists';--> statement-breakpoint
ALTER TYPE "public"."curation_page" ADD VALUE 'search';--> statement-breakpoint
ALTER TYPE "public"."curation_page" ADD VALUE 'lists';--> statement-breakpoint
CREATE TABLE "news_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(40) NOT NULL,
	"label" varchar(60) NOT NULL,
	"mode" varchar(8) DEFAULT 'show' NOT NULL,
	"keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"priority" integer DEFAULT 10 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_categories_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "search_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_type" varchar(12) NOT NULL,
	"entity_id" uuid NOT NULL,
	"slug" varchar(160) NOT NULL,
	"title" varchar(300) NOT NULL,
	"title_norm" text NOT NULL,
	"subtitle" varchar(300),
	"tsv" "tsvector" NOT NULL,
	"category" varchar(40),
	"hidden" boolean DEFAULT false NOT NULL,
	"sort_date" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_list_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar(40) NOT NULL,
	"label" varchar(80) NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "editorial_list_categories_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "editorial_list_consensus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" integer NOT NULL,
	"category_key" varchar(40) NOT NULL,
	"game_id" uuid NOT NULL,
	"appearances" integer NOT NULL,
	"avg_rank" numeric(6, 2) NOT NULL,
	"best_rank" integer NOT NULL,
	"worst_rank" integer NOT NULL,
	"position" integer,
	"in_consensus" boolean DEFAULT false NOT NULL,
	"positions" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_list_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"raw_name" varchar(300) NOT NULL,
	"game_id" uuid,
	"match" varchar(12) DEFAULT 'unmatched' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" varchar(12) DEFAULT 'candidate' NOT NULL,
	"article_id" uuid,
	"external_guid" varchar(400),
	"source_id" uuid,
	"outlet_name" varchar(200) NOT NULL,
	"title" varchar(300) NOT NULL,
	"url" text,
	"year" integer,
	"category_key" varchar(40),
	"published_at" timestamp with time zone,
	"detected_by" varchar(10) DEFAULT 'auto' NOT NULL,
	"decided_by_label" varchar(120),
	"decided_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "search_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "seo_index" varchar(8) DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "category" varchar(40);--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "search_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "category" varchar(40);--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "category_override" varchar(40);--> statement-breakpoint
ALTER TABLE "article_editorial_carryover" ADD COLUMN "category_override" varchar(40);--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "alternate_names" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "search_hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "editorial_list_consensus" ADD CONSTRAINT "editorial_list_consensus_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_list_entries" ADD CONSTRAINT "editorial_list_entries_list_id_editorial_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."editorial_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_list_entries" ADD CONSTRAINT "editorial_list_entries_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_lists" ADD CONSTRAINT "editorial_lists_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_lists" ADD CONSTRAINT "editorial_lists_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "search_index_entity" ON "search_index" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "search_index_tsv" ON "search_index" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "search_index_trgm" ON "search_index" USING gin ("title_norm" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_list_consensus_key" ON "editorial_list_consensus" USING btree ("year","category_key","game_id");--> statement-breakpoint
CREATE INDEX "editorial_list_consensus_game" ON "editorial_list_consensus" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "editorial_list_entries_list" ON "editorial_list_entries" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "editorial_list_entries_game" ON "editorial_list_entries" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_lists_guid" ON "editorial_lists" USING btree ("external_guid");--> statement-breakpoint
CREATE INDEX "editorial_lists_status" ON "editorial_lists" USING btree ("status");--> statement-breakpoint
CREATE INDEX "editorial_lists_year_category" ON "editorial_lists" USING btree ("year","category_key");--> statement-breakpoint
-- Phase P S4: S3b's per-story noindex becomes the three-way indexing setting
-- (stories already set to noindex stay noindex — owner, S4 plan); the old column
-- is dropped in 0025.
UPDATE "topics" SET "seo_index" = 'noindex' WHERE "noindex";
