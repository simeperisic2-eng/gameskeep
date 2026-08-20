CREATE TYPE "public"."newsletter_campaign_kind" AS ENUM('manual', 'digest');--> statement-breakpoint
CREATE TYPE "public"."newsletter_campaign_status" AS ENUM('draft', 'scheduled', 'sending', 'sent', 'canceled');--> statement-breakpoint
CREATE TABLE "newsletter_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" varchar(200) NOT NULL,
	"preheader" varchar(200),
	"body" text NOT NULL,
	"segment" varchar(40) DEFAULT 'all' NOT NULL,
	"kind" "newsletter_campaign_kind" DEFAULT 'manual' NOT NULL,
	"status" "newsletter_campaign_status" DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"opens" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "newsletter_campaign_status_idx" ON "newsletter_campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "newsletter_campaign_created_idx" ON "newsletter_campaigns" USING btree ("created_at");