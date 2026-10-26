CREATE TABLE "agent_personas" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"job" text NOT NULL,
	"background" text NOT NULL,
	"worldview" text NOT NULL,
	"humor" text NOT NULL,
	"voice" jsonb NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationship_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"other_id" text NOT NULL,
	"kind" text NOT NULL,
	"delta" double precision NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_personas" ADD CONSTRAINT "agent_personas_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_events" ADD CONSTRAINT "relationship_events_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_events" ADD CONSTRAINT "relationship_events_other_id_users_id_fk" FOREIGN KEY ("other_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "relationship_events_pair_idx" ON "relationship_events" USING btree ("agent_id","other_id","at");--> statement-breakpoint
CREATE INDEX "relationship_events_other_idx" ON "relationship_events" USING btree ("other_id","at");