CREATE TABLE "agent_day_marks" (
	"agent_id" text NOT NULL,
	"day" text NOT NULL,
	"start_lamports" bigint NOT NULL,
	CONSTRAINT "agent_day_marks_agent_id_day_pk" PRIMARY KEY("agent_id","day")
);
--> statement-breakpoint
CREATE TABLE "agent_mind_nudges" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"trait" text NOT NULL,
	"delta" double precision NOT NULL,
	"reason" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_minds" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"set" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_day_marks" ADD CONSTRAINT "agent_day_marks_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_mind_nudges" ADD CONSTRAINT "agent_mind_nudges_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_minds" ADD CONSTRAINT "agent_minds_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_mind_nudges_agent_idx" ON "agent_mind_nudges" USING btree ("agent_id","at");