CREATE TABLE "application_setting" (
	"key" text PRIMARY KEY NOT NULL,
	"boolean_value" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
ALTER TABLE "application_setting" ADD CONSTRAINT "application_setting_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "application_setting" ("key", "boolean_value") VALUES ('staff_mfa_required', true);
