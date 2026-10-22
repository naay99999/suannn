CREATE TABLE "consent_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"visitor_id" text NOT NULL,
	"customer_id" text,
	"analytics" boolean NOT NULL,
	"marketing" boolean NOT NULL,
	"policy_version" text NOT NULL,
	"request_id" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consent_record_visitor_id_check" CHECK ("consent_record"."visitor_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
);
--> statement-breakpoint
CREATE TABLE "order_attribution" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"consent_record_id" uuid,
	"analytics_consent" boolean NOT NULL,
	"marketing_consent" boolean NOT NULL,
	"posthog_distinct_id" text,
	"utm_source" text,
	"utm_medium" text,
	"utm_campaign" text,
	"utm_content" text,
	"utm_term" text,
	"fbclid" text,
	"ttclid" text,
	"gclid" text,
	"gbraid" text,
	"wbraid" text,
	"referrer" text,
	"landing_path" text,
	"last_touch_at" timestamp with time zone,
	"first_touch" jsonb,
	"fbp" text,
	"fbc" text,
	"ttp" text,
	"client_ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_alert" (
	"destination" text PRIMARY KEY NOT NULL,
	"last_sent_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"destination" text NOT NULL,
	"event_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	"last_error_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_outbox_order_destination_event_unique" UNIQUE("order_id","destination","event_name"),
	CONSTRAINT "tracking_outbox_destination_check" CHECK ("tracking_outbox"."destination" in ('posthog', 'meta', 'tiktok', 'google_ads')),
	CONSTRAINT "tracking_outbox_event_name_check" CHECK ("tracking_outbox"."event_name" = 'purchase'),
	CONSTRAINT "tracking_outbox_status_check" CHECK ("tracking_outbox"."status" in ('pending', 'processing', 'sent', 'failed', 'expired', 'skipped'))
);
--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_attribution" ADD CONSTRAINT "order_attribution_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_attribution" ADD CONSTRAINT "order_attribution_consent_record_id_consent_record_id_fk" FOREIGN KEY ("consent_record_id") REFERENCES "public"."consent_record"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_outbox" ADD CONSTRAINT "tracking_outbox_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_record_visitor_created_idx" ON "consent_record" USING btree ("visitor_id","created_at");--> statement-breakpoint
CREATE INDEX "order_attribution_source_campaign_created_idx" ON "order_attribution" USING btree ("utm_source","utm_campaign","created_at");--> statement-breakpoint
CREATE INDEX "tracking_outbox_due_idx" ON "tracking_outbox" USING btree ("next_attempt_at") WHERE "tracking_outbox"."status" in ('pending', 'failed');