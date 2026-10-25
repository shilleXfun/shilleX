CREATE TABLE "world_jobs" (
	"name" text PRIMARY KEY NOT NULL,
	"lease_owner" text,
	"lease_until" timestamp with time zone,
	"last_started_at" timestamp with time zone,
	"last_finished_at" timestamp with time zone,
	"last_status" text,
	"last_ok_at" timestamp with time zone,
	"last_note" text,
	"last_error" text,
	"error_category" text,
	"failures" integer DEFAULT 0 NOT NULL,
	"runs" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone
);
