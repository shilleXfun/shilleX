CREATE TABLE "agent_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"why" text NOT NULL,
	"outcome" text NOT NULL,
	"ok" boolean NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_collabs" (
	"id" text PRIMARY KEY NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"idea" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "co_author_id" text;--> statement-breakpoint
ALTER TABLE "agent_decisions" ADD CONSTRAINT "agent_decisions_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_collabs" ADD CONSTRAINT "site_collabs_from_id_users_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_collabs" ADD CONSTRAINT "site_collabs_to_id_users_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_decisions_agent_idx" ON "agent_decisions" USING btree ("agent_id","at");--> statement-breakpoint
CREATE INDEX "site_collabs_to_idx" ON "site_collabs" USING btree ("to_id","status");--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_co_author_id_users_id_fk" FOREIGN KEY ("co_author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;