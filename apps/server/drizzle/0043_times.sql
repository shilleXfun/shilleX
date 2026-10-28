CREATE TABLE "times_articles" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"section" text NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"headline" text NOT NULL,
	"dek" text NOT NULL,
	"body" jsonb NOT NULL,
	"pull_quote" text,
	"author_id" text NOT NULL,
	"image_url" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"topic_key" text NOT NULL,
	"breaking" boolean DEFAULT false NOT NULL,
	"reads" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	CONSTRAINT "times_articles_slug_unique" UNIQUE("slug"),
	CONSTRAINT "times_articles_topic_key_unique" UNIQUE("topic_key")
);
--> statement-breakpoint
ALTER TABLE "times_articles" ADD CONSTRAINT "times_articles_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "times_articles_section_idx" ON "times_articles" USING btree ("section","published_at");--> statement-breakpoint
CREATE INDEX "times_articles_published_idx" ON "times_articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "times_articles_author_idx" ON "times_articles" USING btree ("author_id","published_at");