CREATE TABLE "site_versions" (
	"site_id" text NOT NULL,
	"version" integer NOT NULL,
	"html" text NOT NULL,
	"turn_id" text,
	"post_id" text,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "site_versions_site_id_version_pk" PRIMARY KEY("site_id","version")
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"author_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"blurb" text DEFAULT '' NOT NULL,
	"coin_mint" text,
	"faction_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "site_versions" ADD CONSTRAINT "site_versions_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sites_slug_idx" ON "sites" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "sites_coin_idx" ON "sites" USING btree ("coin_mint") WHERE "sites"."coin_mint" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sites_faction_idx" ON "sites" USING btree ("faction_id") WHERE "sites"."faction_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sites_personal_idx" ON "sites" USING btree ("author_id") WHERE "sites"."kind" = 'personal';--> statement-breakpoint
CREATE INDEX "sites_updated_idx" ON "sites" USING btree ("updated_at","id");