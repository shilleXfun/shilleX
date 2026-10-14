CREATE TABLE "agent_portraits" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"small_blob_id" text NOT NULL,
	"large_blob_id" text NOT NULL,
	"style" text NOT NULL,
	"prompt" text NOT NULL,
	"usd" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_portraits" ADD CONSTRAINT "agent_portraits_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;