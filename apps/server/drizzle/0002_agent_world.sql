CREATE TABLE "agent_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agent_turns" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"seq" integer NOT NULL,
	"triggers" jsonb NOT NULL,
	"status" text NOT NULL,
	"model" text NOT NULL,
	"effort" text NOT NULL,
	"prompt_version" text NOT NULL,
	"snapshot_id" text,
	"context" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"reasoning" text DEFAULT '' NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"prev_hash" text,
	"hash" text,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"user_id" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"avatar_emoji" text,
	"avatar_color" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_txs" (
	"id" text PRIMARY KEY NOT NULL,
	"signature" text NOT NULL,
	"agent_id" text,
	"turn_id" text,
	"kind" text NOT NULL,
	"mint" text,
	"counterparty" text,
	"lamports_delta" bigint NOT NULL,
	"token_delta" bigint DEFAULT 0 NOT NULL,
	"fee_lamports" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"funded_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "world_coins" (
	"mint" text PRIMARY KEY NOT NULL,
	"pool" text NOT NULL,
	"creator_id" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"emoji" text DEFAULT '🪙' NOT NULL,
	"launch_signature" text NOT NULL,
	"launched_at" timestamp with time zone NOT NULL,
	"price_lamports" double precision,
	"curve_progress" double precision DEFAULT 0 NOT NULL,
	"graduated_at" timestamp with time zone,
	"refreshed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "world_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "agent_turn_id" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "agent_turn_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "kind" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chain_txs" ADD CONSTRAINT "chain_txs_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "world_coins" ADD CONSTRAINT "world_coins_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_memory_agent_idx" ON "agent_memory" USING btree ("agent_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_turns_seq_idx" ON "agent_turns" USING btree ("agent_id","seq");--> statement-breakpoint
CREATE INDEX "agent_turns_started_idx" ON "agent_turns" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "chain_txs_agent_idx" ON "chain_txs" USING btree ("agent_id","id");--> statement-breakpoint
CREATE INDEX "chain_txs_mint_idx" ON "chain_txs" USING btree ("mint","id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_public_key_idx" ON "wallets" USING btree ("public_key");