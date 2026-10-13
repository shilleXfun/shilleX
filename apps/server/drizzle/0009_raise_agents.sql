CREATE TABLE "agent_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"lamports" bigint NOT NULL,
	"kind" text NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_hatches" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"handle" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"reason" text,
	"agent_id" text,
	"attempted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_nudges" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_user_id" text,
	"mint" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"outcome_turn_id" text
);
--> statement-breakpoint
CREATE TABLE "agent_seeds" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "origin" text DEFAULT 'wild' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "owner_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "released_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "retire_reason" text;--> statement-breakpoint
ALTER TABLE "agent_grants" ADD CONSTRAINT "agent_grants_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_hatches" ADD CONSTRAINT "agent_hatches_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_hatches" ADD CONSTRAINT "agent_hatches_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_nudges" ADD CONSTRAINT "agent_nudges_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_nudges" ADD CONSTRAINT "agent_nudges_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_nudges" ADD CONSTRAINT "agent_nudges_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_seeds" ADD CONSTRAINT "agent_seeds_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_seeds" ADD CONSTRAINT "agent_seeds_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_grants_agent_idx" ON "agent_grants" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_grants_created_idx" ON "agent_grants" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "agent_hatches_owner_idx" ON "agent_hatches" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_hatches_status_idx" ON "agent_hatches" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "agent_nudges_agent_idx" ON "agent_nudges" USING btree ("agent_id","expires_at");--> statement-breakpoint
CREATE INDEX "agent_nudges_owner_idx" ON "agent_nudges" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_seeds_owner_idx" ON "agent_seeds" USING btree ("owner_id","created_at");--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_id");