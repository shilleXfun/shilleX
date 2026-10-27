CREATE TABLE "agent_compute" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"allowance" integer DEFAULT 0 NOT NULL,
	"day" text NOT NULL,
	"spent_today" integer DEFAULT 0 NOT NULL,
	"earned_today" integer DEFAULT 0 NOT NULL,
	"gifted_today" integer DEFAULT 0 NOT NULL,
	"spent_by_job" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compute_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"delta" integer NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_compute" ADD CONSTRAINT "agent_compute_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compute_ledger" ADD CONSTRAINT "compute_ledger_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "compute_ledger_agent_idx" ON "compute_ledger" USING btree ("agent_id","at");