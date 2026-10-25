CREATE TABLE "belief_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"from_value" text NOT NULL,
	"to_value" text NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"response" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_affinity" ADD COLUMN "respect" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "belief_changes" ADD CONSTRAINT "belief_changes_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "belief_changes_agent_idx" ON "belief_changes" USING btree ("agent_id","at");--> statement-breakpoint
CREATE INDEX "llm_cache_expires_idx" ON "llm_cache" USING btree ("expires_at");