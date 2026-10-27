CREATE TABLE "coin_logos" (
	"mint" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"prompt" text NOT NULL,
	"model" text NOT NULL,
	"cost_usd" double precision NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
