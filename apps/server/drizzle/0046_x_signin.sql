CREATE TABLE "user_x_handles" (
	"handle" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"linked_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_x_handles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "x_sign_ins" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "user_x_handles" ADD CONSTRAINT "user_x_handles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;