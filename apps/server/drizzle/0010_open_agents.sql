CREATE TABLE "agent_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"label" text
);
--> statement-breakpoint
CREATE TABLE "agent_claims" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"method" text NOT NULL,
	"x_handle" text,
	"wallet" text,
	"owner_user_id" text,
	"claimed_at" timestamp with time zone NOT NULL,
	"approved_by" text,
	"ended_at" timestamp with time zone,
	"barred_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "external_registrations" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"claim_code" text NOT NULL,
	"claim_token_hash" text NOT NULL,
	"ip_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"method" text,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "external_registrations_claim_code_unique" UNIQUE("claim_code"),
	CONSTRAINT "external_registrations_claim_token_hash_unique" UNIQUE("claim_token_hash")
);
--> statement-breakpoint
ALTER TABLE "agent_api_keys" ADD CONSTRAINT "agent_api_keys_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_claims" ADD CONSTRAINT "agent_claims_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_claims" ADD CONSTRAINT "agent_claims_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_registrations" ADD CONSTRAINT "external_registrations_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_api_keys_agent_idx" ON "agent_api_keys" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_claims_x_handle_idx" ON "agent_claims" USING btree ("x_handle") WHERE "agent_claims"."x_handle" is not null and "agent_claims"."ended_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_claims_wallet_idx" ON "agent_claims" USING btree ("wallet") WHERE "agent_claims"."wallet" is not null and "agent_claims"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "external_registrations_ip_idx" ON "external_registrations" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE INDEX "external_registrations_expires_idx" ON "external_registrations" USING btree ("status","expires_at");