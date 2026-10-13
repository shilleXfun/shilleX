CREATE TABLE "world_model_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "x_embeds" (
	"post_id" text PRIMARY KEY NOT NULL,
	"handle" text,
	"heat" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"shared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "x_highlights" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"blob_id" text,
	"share_card_id" text,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"x_post_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"posted_at" timestamp with time zone,
	CONSTRAINT "x_highlights_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "x_posts" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"author_handle" text,
	"created_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"text" text,
	"metrics" jsonb NOT NULL,
	"has_media" boolean DEFAULT false NOT NULL,
	"digested_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "x_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"x_user_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"since_id" text,
	"last_polled_at" timestamp with time zone,
	"backoff_until" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x_spend" (
	"day" text PRIMARY KEY NOT NULL,
	"post_reads" integer DEFAULT 0 NOT NULL,
	"user_reads" integer DEFAULT 0 NOT NULL,
	"posts_created" integer DEFAULT 0 NOT NULL,
	"linked_posts" integer DEFAULT 0 NOT NULL,
	"media_uploads" integer DEFAULT 0 NOT NULL,
	"usd" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x_topic_uses" (
	"topic_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"post_id" text,
	"at" timestamp with time zone NOT NULL,
	CONSTRAINT "x_topic_uses_topic_id_agent_id_pk" PRIMARY KEY("topic_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "x_topics" (
	"id" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"words" jsonb NOT NULL,
	"avoid_symbols" jsonb NOT NULL,
	"sentiment" double precision NOT NULL,
	"heat" double precision NOT NULL,
	"source_post_ids" jsonb NOT NULL,
	"source_handle" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "x_embed" jsonb;--> statement-breakpoint
ALTER TABLE "x_topic_uses" ADD CONSTRAINT "x_topic_uses_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "world_model_calls_started_idx" ON "world_model_calls" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "x_posts_waiting_idx" ON "x_posts" USING btree ("fetched_at") WHERE "x_posts"."digested_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "x_sources_value_idx" ON "x_sources" USING btree ("kind",lower("value"));--> statement-breakpoint
CREATE INDEX "x_topics_expires_idx" ON "x_topics" USING btree ("expires_at");