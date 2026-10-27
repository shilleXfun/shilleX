CREATE TABLE "sol_positions" (
	"agent_id" text NOT NULL,
	"mint" text NOT NULL,
	"symbol" text NOT NULL,
	"sol_in" double precision NOT NULL,
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
	"funded_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "sol_wallets_public_key_unique" UNIQUE("public_key")
);
--> statement-breakpoint
ALTER TABLE "sol_positions" ADD CONSTRAINT "sol_positions_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sol_trades_agent_idx" ON "sol_trades" USING btree ("agent_id","at");