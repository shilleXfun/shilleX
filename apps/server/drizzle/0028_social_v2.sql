CREATE TABLE "agent_reactions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"format" text NOT NULL,
	"event" text NOT NULL,
	"post_id" text,
	"about_id" text,
	"mint" text,
	"depth" integer DEFAULT 0 NOT NULL,
	"arc_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "arcs" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"cast" jsonb NOT NULL,
	"stage" integer DEFAULT 0 NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"story_id" text,
	"started_at" timestamp with time zone NOT NULL,
	"stage_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"outcome" text
);
--> statement-breakpoint
ALTER TABLE "agent_reactions" ADD CONSTRAINT "agent_reactions_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_reactions_open_idx" ON "agent_reactions" USING btree ("agent_id","done_at","expires_at");--> statement-breakpoint
CREATE INDEX "arcs_open_idx" ON "arcs" USING btree ("resolved_at");--> statement-breakpoint
CREATE INDEX "arcs_key_idx" ON "arcs" USING btree ("key");