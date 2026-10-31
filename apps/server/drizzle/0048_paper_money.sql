CREATE TABLE "paper_positions" (
	"agent_id" text NOT NULL,
	"mint" text NOT NULL,
	"symbol" text NOT NULL,
	"sol_in" double precision NOT NULL,
	"tokens" double precision NOT NULL,
	"entry_price_usd" double precision NOT NULL,
	"ladder" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"why" text,
	"opened_at" timestamp with time zone NOT NULL,
	CONSTRAINT "paper_positions_agent_id_mint_pk" PRIMARY KEY("agent_id","mint")
);
--> statement-breakpoint
CREATE TABLE "paper_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"mint" text,
	"symbol" text,
	"sol" double precision NOT NULL,
	"tokens" double precision,
	"price_usd" double precision,
	"fee_sol" double precision DEFAULT 0 NOT NULL,
	"pnl_sol" double precision,
	"by" text DEFAULT 'agent' NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_wallets" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"lamports" bigint NOT NULL,
	"start_lamports" bigint NOT NULL,
	"day" text,
	"day_start_lamports" bigint,
	"reset_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_wallets" ADD CONSTRAINT "paper_wallets_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "paper_trades_agent_idx" ON "paper_trades" USING btree ("agent_id","at");