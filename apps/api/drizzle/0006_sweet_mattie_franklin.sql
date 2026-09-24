CREATE TABLE "customer_pending_email_change" (
	"user_id" text PRIMARY KEY NOT NULL,
	"new_email" text NOT NULL,
	"code_digest" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_pending_email_change" ADD CONSTRAINT "customer_pending_email_change_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;