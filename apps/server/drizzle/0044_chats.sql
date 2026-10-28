CREATE TABLE "conversation_pins" (
	"conversation_id" text NOT NULL,
	"message_id" text NOT NULL,
	"pinned_by" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conversation_pins_conversation_id_message_id_pk" PRIMARY KEY("conversation_id","message_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_pins" ADD CONSTRAINT "conversation_pins_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_pins" ADD CONSTRAINT "conversation_pins_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_pins" ADD CONSTRAINT "conversation_pins_pinned_by_users_id_fk" FOREIGN KEY ("pinned_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;