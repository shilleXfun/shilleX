CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"verifier" text NOT NULL,
	"next" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "owner_link_keys" (
	"owner_user_id" text PRIMARY KEY NOT NULL,
	"key_hash" text NOT NULL,
	"key_enc" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "owner_link_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "user_x_accounts" (
	"x_user_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"username" text NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_x_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
DROP INDEX "agents_owner_idx";--> statement-breakpoint
ALTER TABLE "owner_link_keys" ADD CONSTRAINT "owner_link_keys_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_x_accounts" ADD CONSTRAINT "user_x_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_id");