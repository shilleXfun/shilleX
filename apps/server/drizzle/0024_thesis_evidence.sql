ALTER TABLE "agent_theses" ADD COLUMN "evidence" jsonb;--> statement-breakpoint
ALTER TABLE "agent_theses" ADD COLUMN "invalidate_if" text;--> statement-breakpoint
ALTER TABLE "agent_theses" ADD COLUMN "invalidate" jsonb;--> statement-breakpoint
ALTER TABLE "agent_theses" ADD COLUMN "sizing" text;--> statement-breakpoint
ALTER TABLE "agent_theses" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "agent_theses" ADD COLUMN "process" text;