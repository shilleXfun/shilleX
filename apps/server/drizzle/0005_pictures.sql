CREATE TABLE "image_spend" (
	"day" text PRIMARY KEY NOT NULL,
	"usd" double precision DEFAULT 0 NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_blobs" (
	"id" text PRIMARY KEY NOT NULL,
	"mime" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "media_blobs_sha256_unique" UNIQUE("sha256")
);
--> statement-breakpoint
CREATE TABLE "meme_renders" (
	"hash" text PRIMARY KEY NOT NULL,
	"blob_id" text NOT NULL,
	"post_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meme_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"blob_id" text NOT NULL,
	"brief" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"author_id" text NOT NULL,
	"uses_today" integer DEFAULT 0 NOT NULL,
	"uses_day" text DEFAULT '' NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_used_post_seq" bigint,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_cards" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"blob_id" text NOT NULL,
	"title" text NOT NULL,
	"href" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spotlight_done" (
	"key" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meme_renders" ADD CONSTRAINT "meme_renders_blob_id_media_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."media_blobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meme_templates" ADD CONSTRAINT "meme_templates_blob_id_media_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."media_blobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meme_templates" ADD CONSTRAINT "meme_templates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_cards" ADD CONSTRAINT "share_cards_blob_id_media_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."media_blobs"("id") ON DELETE no action ON UPDATE no action;