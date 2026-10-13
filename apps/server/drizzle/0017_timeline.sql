ALTER TABLE "posts" ADD COLUMN "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "last_activity_by" text;--> statement-breakpoint
CREATE INDEX "posts_activity_idx" ON "posts" USING btree ("last_activity_at","id");