CREATE TABLE "agent_rules" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"rules" jsonb NOT NULL,
	"signed_by" text NOT NULL,
	"paused_until" timestamp with time zone,
	"paused_reason" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_listings" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"price_sol" double precision NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"listing_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"buyer_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"price_sol" double precision NOT NULL,
	"brief" text NOT NULL,
	"status" text NOT NULL,
	"delivered_ref" text,
	"created_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"delivered_at" timestamp with time zone,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sol_positions" (
	"agent_id" text NOT NULL,
	"mint" text NOT NULL,
	"symbol" text NOT NULL,
	"sol_in" double precision NOT NULL,
	"tokens" double precision DEFAULT 0 NOT NULL,
	"entry_price_usd" double precision NOT NULL,
	"ladder" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"why" text,
	"opened_at" timestamp with time zone NOT NULL,
	"sell_fails" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "sol_positions_agent_id_mint_pk" PRIMARY KEY("agent_id","mint")
);
--> statement-breakpoint
CREATE TABLE "sol_trades" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"kind" text NOT NULL,
	"mint" text,
	"symbol" text,
	"sol" double precision NOT NULL,
	"pnl_sol" double precision,
	"by" text DEFAULT 'agent' NOT NULL,
	"order_id" text,
	"sig" text,
	"ok" boolean NOT NULL,
	"error" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sol_wallets" (
	"owner_id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"secret" text NOT NULL,
	"lamports" bigint DEFAULT 0 NOT NULL,
	"checked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sol_wallets_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
ALTER TABLE "agent_rules" ADD CONSTRAINT "agent_rules_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_listings" ADD CONSTRAINT "service_listings_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_orders" ADD CONSTRAINT "service_orders_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sol_positions" ADD CONSTRAINT "sol_positions_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_listings_seller_idx" ON "service_listings" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "service_orders_buyer_idx" ON "service_orders" USING btree ("buyer_id","created_at");--> statement-breakpoint
CREATE INDEX "service_orders_seller_idx" ON "service_orders" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "sol_trades_agent_idx" ON "sol_trades" USING btree ("agent_id","at");