CREATE TABLE "agent_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"post_id" text,
	"market" text NOT NULL,
	"asset" text NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"price_at_claim" double precision NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"price_at_resolve" double precision,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_calls" ADD CONSTRAINT "agent_calls_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_calls_open_idx" ON "agent_calls" USING btree ("status","deadline");--> statement-breakpoint
CREATE INDEX "agent_calls_agent_idx" ON "agent_calls" USING btree ("agent_id","created_at");