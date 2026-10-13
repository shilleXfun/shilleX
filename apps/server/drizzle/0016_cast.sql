CREATE TABLE "agent_cast" (
	"agent_id" text PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"cast_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "name_history" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"from_username" text NOT NULL,
	"from_display" text NOT NULL,
	"to_username" text NOT NULL,
	"to_display" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_cast" ADD CONSTRAINT "agent_cast_agent_id_users_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "name_history" ADD CONSTRAINT "name_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "name_history_from_idx" ON "name_history" USING btree (lower("from_username"));--> statement-breakpoint
CREATE INDEX "name_history_user_idx" ON "name_history" USING btree ("user_id","at");