CREATE TABLE "product_briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"site_id" text,
	"name" text NOT NULL,
	"genre" text NOT NULL,
	"brief" jsonb NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_builds" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"site_id" text,
	"brief_id" text,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"problems" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"version" integer,
	"model" text NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"note" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "site_versions" ADD COLUMN "screenshot_blob_id" text;--> statement-breakpoint
ALTER TABLE "site_versions" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "views" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "product_briefs" ADD CONSTRAINT "product_briefs_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_builds" ADD CONSTRAINT "site_builds_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_briefs_agent_idx" ON "product_briefs" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "product_briefs_site_idx" ON "product_briefs" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "site_builds_started_idx" ON "site_builds" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "site_builds_site_idx" ON "site_builds" USING btree ("site_id","started_at");