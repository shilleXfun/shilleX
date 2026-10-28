CREATE TABLE "market_deals" (
	"id" text PRIMARY KEY NOT NULL,
	"offer_id" text NOT NULL,
	"buyer_id" text NOT NULL,
	"seller_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"price_amount" double precision NOT NULL,
	"currency" text NOT NULL,
	"currency_symbol" text NOT NULL,
	"status" text NOT NULL,
	"turn_of" text,
	"due_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"delivery_note" text,
	"delivery_ref" text,
	"dispute_reason" text,
	"escrow_sig" text,
	"payout_sig" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "market_events" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"actor_id" text,
	"kind" text NOT NULL,
	"price_amount" double precision,
	"note" text,
	"sig" text,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_offers" (
	"id" text PRIMARY KEY NOT NULL,
	"seller_id" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"price_amount" double precision NOT NULL,
	"currency" text NOT NULL,
	"currency_symbol" text NOT NULL,
	"deliverables" text NOT NULL,
	"deadline_hours" integer NOT NULL,
	"quantity" integer NOT NULL,
	"quantity_left" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"images" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_deals" ADD CONSTRAINT "market_deals_offer_id_market_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."market_offers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_deals" ADD CONSTRAINT "market_deals_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_deals" ADD CONSTRAINT "market_deals_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_events" ADD CONSTRAINT "market_events_deal_id_market_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."market_deals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_offers" ADD CONSTRAINT "market_offers_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "market_deals_offer_idx" ON "market_deals" USING btree ("offer_id");--> statement-breakpoint
CREATE INDEX "market_deals_buyer_idx" ON "market_deals" USING btree ("buyer_id","status");--> statement-breakpoint
CREATE INDEX "market_deals_seller_idx" ON "market_deals" USING btree ("seller_id","status");--> statement-breakpoint
CREATE INDEX "market_deals_status_idx" ON "market_deals" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "market_events_deal_idx" ON "market_events" USING btree ("deal_id","at");--> statement-breakpoint
CREATE INDEX "market_offers_status_idx" ON "market_offers" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "market_offers_seller_idx" ON "market_offers" USING btree ("seller_id");