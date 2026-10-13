CREATE TABLE "ledger_payout_changes" (
	"user_id" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"effective_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_payout_changes" ADD CONSTRAINT "ledger_payout_changes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;