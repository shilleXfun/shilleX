CREATE TABLE "image_cache" (
	"hash" text PRIMARY KEY NOT NULL,
	"blob_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "image_cache" ADD CONSTRAINT "image_cache_blob_id_media_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."media_blobs"("id") ON DELETE no action ON UPDATE no action;