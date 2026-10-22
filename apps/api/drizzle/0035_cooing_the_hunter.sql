CREATE TABLE "ad_spend_daily" (
	"platform" text NOT NULL,
	"account_id" text NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text,
	"date" date NOT NULL,
	"spend_satang" bigint NOT NULL,
	"currency" text NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"synced_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ad_spend_daily_pk" PRIMARY KEY("platform","account_id","campaign_id","date"),
	CONSTRAINT "ad_spend_daily_platform_check" CHECK ("ad_spend_daily"."platform" in ('meta', 'tiktok', 'google')),
	CONSTRAINT "ad_spend_daily_spend_check" CHECK ("ad_spend_daily"."spend_satang" >= 0)
);
--> statement-breakpoint
CREATE TABLE "marketing_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"margin_percent" numeric(4, 1) DEFAULT '35.0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "marketing_settings_singleton_check" CHECK ("marketing_settings"."id" = 1),
	CONSTRAINT "marketing_settings_margin_check" CHECK ("marketing_settings"."margin_percent" between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "marketing_sync_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"error_code" text,
	"range_from" date NOT NULL,
	"range_to" date NOT NULL,
	"rows_upserted" integer DEFAULT 0 NOT NULL,
	"account_timezone" text,
	CONSTRAINT "marketing_sync_run_platform_check" CHECK ("marketing_sync_run"."platform" in ('meta', 'tiktok', 'google')),
	CONSTRAINT "marketing_sync_run_status_check" CHECK ("marketing_sync_run"."status" in ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
ALTER TABLE "marketing_settings" ADD CONSTRAINT "marketing_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_spend_daily_date_platform_idx" ON "ad_spend_daily" USING btree ("date","platform");--> statement-breakpoint
CREATE INDEX "marketing_sync_run_platform_started_idx" ON "marketing_sync_run" USING btree ("platform","started_at" desc);
--> statement-breakpoint
INSERT INTO "marketing_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING;
