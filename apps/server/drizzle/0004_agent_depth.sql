CREATE TABLE "agent_beliefs" (
	"agent_id" text NOT NULL,
	"mint" text NOT NULL,
	"expect" double precision DEFAULT 0 NOT NULL,
	"trust_creator" double precision DEFAULT 0.5 NOT NULL,
	"stance" double precision,
	"stance_at" timestamp with time zone,
	CONSTRAINT "agent_beliefs_agent_id_mint_pk" PRIMARY KEY("agent_id","mint")
);
--> statement-breakpoint
CREATE TABLE "debts" (
	"id" text PRIMARY KEY NOT NULL,
	"lender_id" text NOT NULL,
	"borrower_id" text NOT NULL,
	"lamports" bigint NOT NULL,
	"signature" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"repaid_at" timestamp with time zone,
	"defaulted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "faction_members" (
	"faction_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"joined_at" timestamp with time zone NOT NULL,
	"left_at" timestamp with time zone,
	CONSTRAINT "faction_members_faction_id_agent_id_pk" PRIMARY KEY("faction_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "factions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"banner" text DEFAULT '' NOT NULL,
	"colour" text NOT NULL,
	"community_id" text,
	"conversation_id" text,
	"coin_mint" text,
	"formed_at" timestamp with time zone NOT NULL,
	"split_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lineage" (
	"id" text PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"inventor_id" text NOT NULL,
	"kind" text NOT NULL,
	"situation" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"uses" integer DEFAULT 0 NOT NULL,
	"adopters" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "papers" (
	"day" text PRIMARY KEY NOT NULL,
	"headline" text NOT NULL,
	"body" jsonb NOT NULL,
	"meme_blob_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "said_vs_did" (
	"post_id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"mint" text NOT NULL,
	"stance" double precision NOT NULL,
	"signature" text NOT NULL,
	"side" text NOT NULL,
	"at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trait_history" (
	"agent_id" text NOT NULL,
	"day" text NOT NULL,
	"traits" jsonb NOT NULL,
	"drift" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "trait_history_agent_id_day_pk" PRIMARY KEY("agent_id","day")
);
--> statement-breakpoint
CREATE TABLE "weather" (
	"id" text PRIMARY KEY NOT NULL,
	"regime" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_beliefs" ADD CONSTRAINT "agent_beliefs_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_lender_id_users_id_fk" FOREIGN KEY ("lender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_borrower_id_users_id_fk" FOREIGN KEY ("borrower_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_members" ADD CONSTRAINT "faction_members_faction_id_factions_id_fk" FOREIGN KEY ("faction_id") REFERENCES "public"."factions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faction_members" ADD CONSTRAINT "faction_members_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineage" ADD CONSTRAINT "lineage_inventor_id_users_id_fk" FOREIGN KEY ("inventor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "said_vs_did" ADD CONSTRAINT "said_vs_did_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trait_history" ADD CONSTRAINT "trait_history_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "debts_borrower_idx" ON "debts" USING btree ("borrower_id");--> statement-breakpoint
CREATE INDEX "debts_lender_idx" ON "debts" USING btree ("lender_id");--> statement-breakpoint
CREATE INDEX "faction_members_agent_idx" ON "faction_members" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "said_vs_did_agent_idx" ON "said_vs_did" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "weather_ends_idx" ON "weather" USING btree ("ends_at");