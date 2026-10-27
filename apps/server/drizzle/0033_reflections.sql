CREATE TABLE "agent_reflections" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"beliefs" jsonb NOT NULL,
	"grudges" jsonb NOT NULL,
	"goals" jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_personas" ADD COLUMN "sheet" jsonb;--> statement-breakpoint
ALTER TABLE "agent_reflections" ADD CONSTRAINT "agent_reflections_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_reflections_agent_idx" ON "agent_reflections" USING btree ("agent_id","at");