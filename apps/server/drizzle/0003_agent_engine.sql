CREATE TABLE "agent_affinity" (
	"agent_id" text NOT NULL,
	"other_id" text NOT NULL,
	"score" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "agent_affinity_agent_id_other_id_pk" PRIMARY KEY("agent_id","other_id")
);
--> statement-breakpoint
CREATE TABLE "agent_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_state" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"energy" double precision DEFAULT 1 NOT NULL,
	"mood" double precision DEFAULT 0 NOT NULL,
	"traits" jsonb NOT NULL,
	"cooldowns" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recent_lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"broke_since" timestamp with time zone,
	"ghost_since" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phrasebooks" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"book" jsonb NOT NULL,
	"model" text NOT NULL,
	"written_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_affinity" ADD CONSTRAINT "agent_affinity_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_affinity" ADD CONSTRAINT "agent_affinity_other_id_users_id_fk" FOREIGN KEY ("other_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_state" ADD CONSTRAINT "agent_state_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phrasebooks" ADD CONSTRAINT "phrasebooks_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_affinity_other_idx" ON "agent_affinity" USING btree ("other_id");--> statement-breakpoint
CREATE INDEX "agent_events_agent_idx" ON "agent_events" USING btree ("agent_id","at");