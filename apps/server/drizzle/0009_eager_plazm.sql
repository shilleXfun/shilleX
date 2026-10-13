ALTER TABLE "ledger_chain_seen" ADD COLUMN "network" text;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_audit_prev_hash_idx" ON "admin_audit" USING btree ("prev_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_withdrawals_signature_idx" ON "ledger_withdrawals" USING btree ("signature");