CREATE TABLE "application_rate_limit" (
	"key_hash" text PRIMARY KEY NOT NULL,
	"namespace" text NOT NULL,
	"count" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"request_id" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_email_claim" (
	"normalized_email" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"user_id" text,
	"invitation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_email_claim_shape_check" CHECK ((
        "identity_email_claim"."state" in ('customer', 'staff')
        and "identity_email_claim"."user_id" is not null
        and "identity_email_claim"."invitation_id" is null
      ) or (
        "identity_email_claim"."state" = 'pending_staff'
        and "identity_email_claim"."user_id" is null
        and "identity_email_claim"."invitation_id" is not null
      ))
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "staff_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"normalized_email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"inviter_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_user_id" text,
	CONSTRAINT "staff_invitation_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "staff_invitation_role_check" CHECK ("staff_invitation"."role" in ('owner', 'admin', 'catalog_manager', 'fulfillment', 'support')),
	CONSTRAINT "staff_invitation_resolution_check" CHECK (not ("staff_invitation"."accepted_at" is not null and "staff_invitation"."revoked_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "two_factor" (
	"id" text PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" text NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp
);
--> statement-breakpoint
ALTER TABLE "account" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "session" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "created_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "verification" ALTER COLUMN "updated_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "last_activity_at" timestamp;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "absolute_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "two_factor_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "account_type" text DEFAULT 'customer' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "staff_activated_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "source_invitation_id" text;--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "user"
    GROUP BY lower(regexp_replace("email", E'^[\\t\\n\\f\\r ]+|[\\t\\n\\f\\r ]+$', '', 'g'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'legacy email normalization collision';
  END IF;
END $$;--> statement-breakpoint
UPDATE "user"
SET
  "email" = lower(regexp_replace("email", E'^[\\t\\n\\f\\r ]+|[\\t\\n\\f\\r ]+$', '', 'g')),
  "account_type" = 'customer',
  "role" = 'customer'
WHERE "account_type" IS NULL OR "role" IS NULL;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_account_type_role_check" CHECK (
  ("account_type" = 'customer' AND "role" = 'customer')
  OR
  ("account_type" = 'staff' AND "role" IN ('owner', 'admin', 'catalog_manager', 'fulfillment', 'support'))
);--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_email_claim" ADD CONSTRAINT "identity_email_claim_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_email_claim" ADD CONSTRAINT "identity_email_claim_invitation_id_staff_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."staff_invitation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitation" ADD CONSTRAINT "staff_invitation_inviter_user_id_user_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitation" ADD CONSTRAINT "staff_invitation_created_user_id_user_id_fk" FOREIGN KEY ("created_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "application_rate_limit_expiry_idx" ON "application_rate_limit" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_log_occurred_at_idx" ON "audit_log" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_email_claim_user_unique" ON "identity_email_claim" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identity_email_claim_invitation_unique" ON "identity_email_claim" USING btree ("invitation_id");--> statement-breakpoint
CREATE INDEX "staff_invitation_email_idx" ON "staff_invitation" USING btree ("normalized_email");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitation_pending_email_unique" ON "staff_invitation" USING btree ("normalized_email") WHERE "staff_invitation"."accepted_at" is null and "staff_invitation"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "twoFactor_secret_idx" ON "two_factor" USING btree ("secret");--> statement-breakpoint
CREATE INDEX "twoFactor_userId_idx" ON "two_factor" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_source_invitation_id_unique" UNIQUE("source_invitation_id");--> statement-breakpoint
INSERT INTO "identity_email_claim" ("normalized_email", "state", "user_id")
SELECT "email", 'customer', "id"
FROM "user"
ON CONFLICT ("normalized_email") DO NOTHING;
