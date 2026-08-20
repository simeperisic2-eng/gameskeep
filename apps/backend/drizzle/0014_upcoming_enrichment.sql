CREATE TYPE "public"."upcoming_override" AS ENUM('show', 'hide');--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "upcoming_override" "upcoming_override";--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "upcoming_featured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "is_indie" boolean DEFAULT false NOT NULL;