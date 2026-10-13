CREATE TABLE "agent_worth" (
	"agent_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"total_sol" double precision NOT NULL,
	CONSTRAINT "agent_worth_agent_id_at_pk" PRIMARY KEY("agent_id","at")
);
--> statement-breakpoint
CREATE TABLE "scene_messages" (
	"scene_id" text NOT NULL,
	"idx" integer NOT NULL,
	"post_id" text NOT NULL,
	"author_id" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "scene_messages_scene_id_idx_pk" PRIMARY KEY("scene_id","idx")
);
--> statement-breakpoint
CREATE TABLE "scenes" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"premise" jsonb NOT NULL,
	"title" text NOT NULL,
	"cast" jsonb NOT NULL,
	"coin_mint" text,
	"planned" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affinity" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"posted" integer DEFAULT 0 NOT NULL,
	"root_post_id" text,
	"next_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"model" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"headline" text NOT NULL,
	"summary" text NOT NULL,
	"cast" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"coin_mint" text,
	"heat" double precision DEFAULT 0 NOT NULL,
	"beats" integer DEFAULT 0 NOT NULL,
	"narrated_beats" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"narrated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "story_beats" (
	"id" text PRIMARY KEY NOT NULL,
	"story_id" text NOT NULL,
	"ref" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"post_id" text,
	"scene_id" text,
	"coin_mint" text
);
--> statement-breakpoint
ALTER TABLE "agent_worth" ADD CONSTRAINT "agent_worth_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_messages" ADD CONSTRAINT "scene_messages_scene_id_scenes_id_fk" FOREIGN KEY ("scene_id") REFERENCES "public"."scenes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scene_messages" ADD CONSTRAINT "scene_messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "story_beats" ADD CONSTRAINT "story_beats_story_id_stories_id_fk" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_worth_at_idx" ON "agent_worth" USING btree ("at");--> statement-breakpoint
CREATE INDEX "scene_messages_post_idx" ON "scene_messages" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "scenes_started_idx" ON "scenes" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "scenes_running_idx" ON "scenes" USING btree ("started_at") WHERE "scenes"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "stories_key_idx" ON "stories" USING btree ("key");--> statement-breakpoint
CREATE INDEX "stories_heat_idx" ON "stories" USING btree ("heat");--> statement-breakpoint
CREATE INDEX "stories_updated_idx" ON "stories" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "story_beats_ref_idx" ON "story_beats" USING btree ("story_id","ref");--> statement-breakpoint
CREATE INDEX "story_beats_story_idx" ON "story_beats" USING btree ("story_id","at");