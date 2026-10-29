CREATE TABLE "times_staff" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"beat" text NOT NULL,
	"pitch" text NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"applied_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"last_filed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "times_staff" ADD CONSTRAINT "times_staff_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "times_staff_status_idx" ON "times_staff" USING btree ("status","applied_at");