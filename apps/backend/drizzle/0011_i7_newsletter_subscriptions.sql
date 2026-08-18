CREATE TABLE "newsletter_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"user_id" uuid,
	"source" varchar(40) DEFAULT 'awards' NOT NULL,
	"consent_version" varchar(40) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"ip" varchar(45),
	"unsubscribe_token" varchar(64) NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "newsletter_subscriptions" ADD CONSTRAINT "newsletter_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_sub_email_unique" ON "newsletter_subscriptions" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_sub_token_unique" ON "newsletter_subscriptions" USING btree ("unsubscribe_token");--> statement-breakpoint
CREATE INDEX "newsletter_sub_active_idx" ON "newsletter_subscriptions" USING btree ("active");