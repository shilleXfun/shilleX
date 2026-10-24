CREATE TABLE "agent_desks" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"style" text NOT NULL,
	"risk" double precision NOT NULL,
	"watch" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lessons" text DEFAULT '' NOT NULL,
	"model" text NOT NULL,
	"written_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_theses" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"market" text NOT NULL,
	"asset" text NOT NULL,
	"symbol" text NOT NULL,
	"entry_price" double precision NOT NULL,
	"target_pct" double precision NOT NULL,
	"stop_pct" double precision NOT NULL,
	"horizon_at" timestamp with time zone NOT NULL,
	"conviction" double precision NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"exit_price" double precision,
	"pnl_pct" double precision,
	"post_id" text
);
--> statement-breakpoint
CREATE TABLE "real_books" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"cash_usd" double precision NOT NULL,
	"start_usd" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "real_market" (
	"address" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"pair_address" text NOT NULL,
	"dex_id" text NOT NULL,
	"url" text NOT NULL,
	"price_usd" double precision NOT NULL,
	"liquidity_usd" double precision NOT NULL,
	"fdv_usd" double precision,
	"volume_h1" double precision NOT NULL,
	"volume_h24" double precision NOT NULL,
	"change_m5" double precision NOT NULL,
	"change_h1" double precision NOT NULL,
	"change_h24" double precision NOT NULL,
	"buys_h1" integer NOT NULL,
	"sells_h1" integer NOT NULL,
	"pair_created_at" timestamp with time zone,
	"source" text NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "real_positions" (
	"agent_id" text NOT NULL,
	"address" text NOT NULL,
	"symbol" text NOT NULL,
	"qty" double precision NOT NULL,
	"cost_usd" double precision NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "real_positions_agent_id_address_pk" PRIMARY KEY("agent_id","address")
);
--> statement-breakpoint
CREATE TABLE "real_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"address" text NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"qty" double precision NOT NULL,
	"price_usd" double precision NOT NULL,
	"usd" double precision NOT NULL,
	"fee_usd" double precision NOT NULL,
	"thesis_id" text,
	"turn_id" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_desks" ADD CONSTRAINT "agent_desks_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_theses" ADD CONSTRAINT "agent_theses_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_books" ADD CONSTRAINT "real_books_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_positions" ADD CONSTRAINT "real_positions_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_trades" ADD CONSTRAINT "real_trades_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_theses_agent_idx" ON "agent_theses" USING btree ("agent_id","status");--> statement-breakpoint
CREATE INDEX "agent_theses_asset_idx" ON "agent_theses" USING btree ("asset","status");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_theses_open_idx" ON "agent_theses" USING btree ("agent_id","market","asset") WHERE "agent_theses"."status" = 'open';--> statement-breakpoint
CREATE INDEX "real_market_refreshed_idx" ON "real_market" USING btree ("refreshed_at");--> statement-breakpoint
CREATE INDEX "real_trades_agent_idx" ON "real_trades" USING btree ("agent_id","at");--> statement-breakpoint
CREATE INDEX "real_trades_address_idx" ON "real_trades" USING btree ("address","at");