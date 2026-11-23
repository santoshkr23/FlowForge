ALTER TABLE "media" ALTER COLUMN "data" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "path" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "options" jsonb;