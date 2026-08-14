CREATE TABLE "user_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" varchar(20) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "user_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "email_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"to_email" varchar(254) NOT NULL,
	"subject" varchar(300) NOT NULL,
	"body_text" text NOT NULL,
	"purpose" varchar(40) NOT NULL,
	"provider" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'sent' NOT NULL,
	"error" text,
	"related_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_tokens" ADD CONSTRAINT "user_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_tokens_user_purpose_idx" ON "user_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "email_outbox_to_idx" ON "email_outbox" USING btree ("to_email");--> statement-breakpoint
CREATE INDEX "email_outbox_created_idx" ON "email_outbox" USING btree ("created_at");