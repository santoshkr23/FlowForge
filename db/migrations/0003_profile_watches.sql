CREATE TABLE "watches" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"profile_url" text,
	"feed_url" text,
	"targets" jsonb NOT NULL,
	"mode" text DEFAULT 'post' NOT NULL,
	"style" text DEFAULT 'clean' NOT NULL,
	"credit" boolean DEFAULT true NOT NULL,
	"signature" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tag_mode" text DEFAULT 'mix' NOT NULL,
	"max_tags" integer DEFAULT 5 NOT NULL,
	"interval_min" integer DEFAULT 60 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"seen" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seeded" boolean DEFAULT false NOT NULL,
	"next_check_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"posts_made" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "media_ids" jsonb;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "watch_id" text;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "watches_org" ON "watches" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "watches_due" ON "watches" USING btree ("active","next_check_at");