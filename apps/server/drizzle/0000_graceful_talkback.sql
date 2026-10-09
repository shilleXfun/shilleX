CREATE TABLE "blocks" (
	"user_id" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "blocks_user_id_target_id_pk" PRIMARY KEY("user_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"user_id" text NOT NULL,
	"post_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "bookmarks_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "call_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"author_id" text NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"self_reported" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channels" (
	"id" text PRIMARY KEY NOT NULL,
	"community_id" text NOT NULL,
	"name" text NOT NULL,
	"topic" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"slow_mode_seconds" integer DEFAULT 0 NOT NULL,
	"hold_new_member_posts" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communities" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"avatar_url" text,
	"banner_url" text,
	"visibility" text NOT NULL,
	"owner_id" text NOT NULL,
	"rules" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	CONSTRAINT "communities_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "community_members" (
	"community_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	CONSTRAINT "community_members_community_id_user_id_pk" PRIMARY KEY("community_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversation_members" (
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	CONSTRAINT "conversation_members_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"name" text,
	"dm_key" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conversations_dm_key_unique" UNIQUE("dm_key")
);
--> statement-breakpoint
CREATE TABLE "follows" (
	"follower_id" text NOT NULL,
	"followee_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "follows_follower_id_followee_id_pk" PRIMARY KEY("follower_id","followee_id")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"code" text PRIMARY KEY NOT NULL,
	"community_id" text NOT NULL,
	"created_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"max_uses" integer,
	"uses" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text,
	"conversation_id" text,
	"author_id" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"reply_to_id" text,
	"attachments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mutes" (
	"user_id" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mutes_user_id_target_id_pk" PRIMARY KEY("user_id","target_id")
);
--> statement-breakpoint
CREATE TABLE "notification_prefs" (
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean NOT NULL,
	CONSTRAINT "notification_prefs_user_id_type_pk" PRIMARY KEY("user_id","type")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pins" (
	"id" text PRIMARY KEY NOT NULL,
	"community_id" text NOT NULL,
	"channel_id" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"pinned_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"kind" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"parent_id" text,
	"root_id" text,
	"quote_of_id" text,
	"repost_of_id" text,
	"community_id" text,
	"visibility" text NOT NULL,
	"media" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"is_demo" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"user_id" text NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reactions_target_type_target_id_user_id_emoji_pk" PRIMARY KEY("target_type","target_id","user_id","emoji")
);
--> statement-breakpoint
CREATE TABLE "read_markers" (
	"user_id" text NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" text NOT NULL,
	"last_read_message_id" text NOT NULL,
	CONSTRAINT "read_markers_user_id_scope_type_scope_id_pk" PRIMARY KEY("user_id","scope_type","scope_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" text PRIMARY KEY NOT NULL,
	"reporter_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"community_id" text,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"user_id" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "subscriptions_user_id_target_type_target_id_pk" PRIMARY KEY("user_id","target_type","target_id")
);
--> statement-breakpoint
CREATE TABLE "token_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"author_id" text NOT NULL,
	"community_id" text,
	"channel_id" text,
	"is_public" boolean NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"mint" text PRIMARY KEY NOT NULL,
	"source" text,
	"status" text NOT NULL,
	"name" text,
	"symbol" text,
	"image_url" text,
	"decimals" integer,
	"liquidity_usd" double precision,
	"market_cap_usd" double precision,
	"fdv_usd" double precision,
	"pair_address" text,
	"dex_id" text,
	"pair_created_at" timestamp with time zone,
	"promoted" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone,
	"meta_fetched_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" text PRIMARY KEY NOT NULL,
	"uploader_id" text NOT NULL,
	"url" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text,
	"avatar_url" text,
	"banner_url" text,
	"bio" text DEFAULT '' NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_links" (
	"user_id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"display_wallet" boolean DEFAULT false NOT NULL,
	"display_holdings" boolean DEFAULT false NOT NULL,
	"verified" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_updates" ADD CONSTRAINT "call_updates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channels" ADD CONSTRAINT "channels_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communities" ADD CONSTRAINT "communities_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followee_id_users_id_fk" FOREIGN KEY ("followee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mutes" ADD CONSTRAINT "mutes_target_id_users_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_prefs" ADD CONSTRAINT "notification_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_community_id_communities_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."communities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pins" ADD CONSTRAINT "pins_pinned_by_users_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "read_markers" ADD CONSTRAINT "read_markers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_links" ADD CONSTRAINT "wallet_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_target_idx" ON "blocks" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "call_updates_post_idx" ON "call_updates" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "channels_community_idx" ON "channels" USING btree ("community_id");--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "community_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "conv_members_user_idx" ON "conversation_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "follows_followee_idx" ON "follows" USING btree ("followee_id");--> statement-breakpoint
CREATE INDEX "messages_channel_idx" ON "messages" USING btree ("channel_id","id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","id");--> statement-breakpoint
CREATE INDEX "messages_author_idx" ON "messages" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","id");--> statement-breakpoint
CREATE INDEX "posts_author_idx" ON "posts" USING btree ("author_id","id");--> statement-breakpoint
CREATE INDEX "posts_parent_idx" ON "posts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "posts_root_idx" ON "posts" USING btree ("root_id");--> statement-breakpoint
CREATE INDEX "posts_community_idx" ON "posts" USING btree ("community_id","id");--> statement-breakpoint
CREATE INDEX "posts_quote_idx" ON "posts" USING btree ("quote_of_id");--> statement-breakpoint
CREATE INDEX "posts_repost_idx" ON "posts" USING btree ("repost_of_id");--> statement-breakpoint
CREATE INDEX "reactions_target_idx" ON "reactions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "reports_community_idx" ON "reports" USING btree ("community_id","status");--> statement-breakpoint
CREATE INDEX "subs_target_idx" ON "subscriptions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mentions_source_mint_idx" ON "token_mentions" USING btree ("source_type","source_id","mint");--> statement-breakpoint
CREATE INDEX "mentions_mint_public_idx" ON "token_mentions" USING btree ("mint","is_public","created_at");--> statement-breakpoint
CREATE INDEX "mentions_public_created_idx" ON "token_mentions" USING btree ("is_public","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_lower_idx" ON "users" USING btree (lower("username"));