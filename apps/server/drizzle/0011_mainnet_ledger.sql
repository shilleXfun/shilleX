CREATE TABLE "admin_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_id" text NOT NULL,
	"action" text NOT NULL,
	"payload" text NOT NULL,
	"prev_hash" text,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"public_key" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"lamports" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_chain_seen" (
	"signature" text PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"network" text,
	"deposit_id" text,
	"from_address" text,
	"lamports" bigint DEFAULT 0 NOT NULL,
	"refund_signature" text,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_deposits" (
	"id" text PRIMARY KEY NOT NULL,
	"season" text NOT NULL,
	"agent_id" text NOT NULL,
	"user_id" text NOT NULL,
	"sender" text NOT NULL,
	"lamports" bigint NOT NULL,
	"reference" text NOT NULL,
	"status" text NOT NULL,
	"signature" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_holdings" (
	"account" text NOT NULL,
	"mint" text NOT NULL,
	"raw" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "ledger_holdings_account_mint_pk" PRIMARY KEY("account","mint")
);
--> statement-breakpoint
CREATE TABLE "ledger_journal" (
	"id" text PRIMARY KEY NOT NULL,
	"season" text NOT NULL,
	"kind" text NOT NULL,
	"account" text NOT NULL,
	"counter" text NOT NULL,
	"mint" text,
	"lamports_delta" bigint DEFAULT 0 NOT NULL,
	"token_delta" bigint DEFAULT 0 NOT NULL,
	"ref" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_pools" (
	"mint" text PRIMARY KEY NOT NULL,
	"pool" text NOT NULL,
	"creator_id" text NOT NULL,
	"creator_account" text NOT NULL,
	"sol" bigint DEFAULT 0 NOT NULL,
	"sold" bigint DEFAULT 0 NOT NULL,
	"vested_raw" bigint DEFAULT 0 NOT NULL,
	"graduated" boolean DEFAULT false NOT NULL,
	"launched_at" timestamp with time zone NOT NULL,
	"paused_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ledger_prices" (
	"id" text PRIMARY KEY NOT NULL,
	"mint" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"price_lamports" double precision NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_reconciliations" (
	"id" text PRIMARY KEY NOT NULL,
	"season" text NOT NULL,
	"mode" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"ok" boolean,
	"ledger_total" bigint NOT NULL,
	"onchain_total" bigint,
	"details" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_seasons" (
	"id" text PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_vault" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_withdrawals" (
	"id" text PRIMARY KEY NOT NULL,
	"season" text NOT NULL,
	"agent_id" text,
	"user_id" text,
	"to_address" text NOT NULL,
	"lamports" bigint NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"approved_by" text,
	"signature" text,
	"requested_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mainnet_consents" (
	"user_id" text PRIMARY KEY NOT NULL,
	"notice_version" text NOT NULL,
	"adult" boolean NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mainnet_exclusions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "world_coins" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mainnet_consents" ADD CONSTRAINT "mainnet_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mainnet_exclusions" ADD CONSTRAINT "mainnet_exclusions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_audit_prev_hash_idx" ON "admin_audit" USING btree ("prev_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_deposits_reference_idx" ON "ledger_deposits" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "ledger_deposits_agent_idx" ON "ledger_deposits" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_deposits_user_idx" ON "ledger_deposits" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_journal_account_idx" ON "ledger_journal" USING btree ("season","account");--> statement-breakpoint
CREATE INDEX "ledger_journal_ref_idx" ON "ledger_journal" USING btree ("ref");--> statement-breakpoint
CREATE INDEX "ledger_prices_mint_at_idx" ON "ledger_prices" USING btree ("mint","at");--> statement-breakpoint
CREATE INDEX "ledger_reconciliations_at_idx" ON "ledger_reconciliations" USING btree ("mode","at");--> statement-breakpoint
CREATE INDEX "ledger_withdrawals_status_idx" ON "ledger_withdrawals" USING btree ("status","requested_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_withdrawals_signature_idx" ON "ledger_withdrawals" USING btree ("signature");--> statement-breakpoint
CREATE INDEX "mainnet_exclusions_user_idx" ON "mainnet_exclusions" USING btree ("user_id","until");