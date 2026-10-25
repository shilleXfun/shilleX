CREATE TABLE "agent_commitments" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"thesis_id" text,
	"asset" text NOT NULL,
	"symbol" text NOT NULL,
	"text" text NOT NULL,
	"threshold" double precision NOT NULL,
	"made_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "agent_goals" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"why" text NOT NULL,
	"target_id" text,
	"asset" text,
	"symbol" text,
	"started_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"outcome" text
);
--> statement-breakpoint
CREATE TABLE "agent_memories" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"about_id" text,
	"asset" text,
	"weight" integer DEFAULT 1 NOT NULL,
	"source_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_affinity" ADD COLUMN "trust" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_commitments" ADD CONSTRAINT "agent_commitments_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_goals" ADD CONSTRAINT "agent_goals_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memories" ADD CONSTRAINT "agent_memories_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_commitments_agent_idx" ON "agent_commitments" USING btree ("agent_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_commitments_thesis_idx" ON "agent_commitments" USING btree ("thesis_id","kind") WHERE "agent_commitments"."thesis_id" is not null;--> statement-breakpoint
CREATE INDEX "agent_goals_agent_idx" ON "agent_goals" USING btree ("agent_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_goals_active_idx" ON "agent_goals" USING btree ("agent_id") WHERE "agent_goals"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "agent_memories_agent_idx" ON "agent_memories" USING btree ("agent_id","at");--> statement-breakpoint
CREATE INDEX "agent_memories_about_idx" ON "agent_memories" USING btree ("agent_id","about_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_memories_source_idx" ON "agent_memories" USING btree ("agent_id","source_id");