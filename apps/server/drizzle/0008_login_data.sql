-- LOGIN custom migration (parallel-build contract §2): carried over unchanged at merge, after LOGIN's generated migration.
-- Typed wallet addresses become unverified user_wallets rows that keep their show-on-profile choice. When two accounts
-- typed the same address, the smallest user id keeps it. Idempotent: replaying it inserts nothing new.
INSERT INTO "user_wallets" ("address", "user_id", "wallet_name", "verified_at", "show_on_profile", "is_payout", "created_at", "last_login_at")
SELECT DISTINCT ON (w."address") w."address", w."user_id", NULL, NULL, w."display_wallet", false, now(), NULL
FROM "wallet_links" w
ORDER BY w."address", w."user_id"
ON CONFLICT ("address") DO NOTHING;
