CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "external_guid" varchar(400);--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_external_guid_unique" UNIQUE("external_guid");