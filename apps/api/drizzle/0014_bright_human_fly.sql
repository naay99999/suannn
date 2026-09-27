CREATE TABLE "stripe_checkout_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"stripe_session_id" text,
	"checkout_url" text,
	"expires_at" timestamp with time zone,
	"stripe_idempotency_key" text NOT NULL,
	"status" text DEFAULT 'creating' NOT NULL,
	"last_create_call_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_checkout_attempt_session_shape_check" CHECK (
    ("stripe_checkout_attempt"."stripe_session_id" is null and "stripe_checkout_attempt"."checkout_url" is null)
    or ("stripe_checkout_attempt"."stripe_session_id" is not null and "stripe_checkout_attempt"."checkout_url" is not null and "stripe_checkout_attempt"."expires_at" is not null)
  ),
	CONSTRAINT "stripe_checkout_attempt_url_check" CHECK ("stripe_checkout_attempt"."checkout_url" is null or "stripe_checkout_attempt"."checkout_url" ~ '^https://[^[:space:]]+$'),
	CONSTRAINT "stripe_checkout_attempt_idempotency_key_check" CHECK (length(btrim("stripe_checkout_attempt"."stripe_idempotency_key")) between 1 and 255),
	CONSTRAINT "stripe_checkout_attempt_status_check" CHECK ("stripe_checkout_attempt"."status" in ('creating', 'open', 'completed', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "stripe_event" (
	"stripe_event_id" text PRIMARY KEY NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_event_id_check" CHECK ("stripe_event"."stripe_event_id" ~ '^evt_[A-Za-z0-9]+$'),
	CONSTRAINT "stripe_event_type_check" CHECK (length(btrim("stripe_event"."event_type")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "stripe_refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payment_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"request_actor_type" text DEFAULT 'staff' NOT NULL,
	"request_actor_id" text,
	"idempotency_key" text NOT NULL,
	"stripe_idempotency_key" text NOT NULL,
	"stripe_refund_id" text,
	"amount_satang" bigint NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_refund_amount_safe_range_check" CHECK ("stripe_refund"."amount_satang" between 1 and 9007199254740991),
	CONSTRAINT "stripe_refund_actor_shape_check" CHECK (
    ("stripe_refund"."request_actor_type" = 'staff' and "stripe_refund"."request_actor_id" is not null and length(btrim("stripe_refund"."request_actor_id")) between 1 and 200)
    or ("stripe_refund"."request_actor_type" = 'system' and "stripe_refund"."request_actor_id" is null)
  ),
	CONSTRAINT "stripe_refund_idempotency_key_check" CHECK (length(btrim("stripe_refund"."idempotency_key")) between 1 and 128),
	CONSTRAINT "stripe_refund_stripe_idempotency_key_check" CHECK (length(btrim("stripe_refund"."stripe_idempotency_key")) between 1 and 255),
	CONSTRAINT "stripe_refund_stripe_id_check" CHECK ("stripe_refund"."stripe_refund_id" is null or "stripe_refund"."stripe_refund_id" ~ '^re_[A-Za-z0-9]+$'),
	CONSTRAINT "stripe_refund_status_check" CHECK ("stripe_refund"."status" in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled'))
);
--> statement-breakpoint
ALTER TABLE "stripe_checkout_attempt" ADD CONSTRAINT "stripe_checkout_attempt_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_refund" ADD CONSTRAINT "stripe_refund_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_refund" ADD CONSTRAINT "stripe_refund_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_checkout_attempt_order_unique" ON "stripe_checkout_attempt" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_checkout_attempt_session_unique" ON "stripe_checkout_attempt" USING btree ("stripe_session_id") WHERE "stripe_checkout_attempt"."stripe_session_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_checkout_attempt_idempotency_unique" ON "stripe_checkout_attempt" USING btree ("stripe_idempotency_key");--> statement-breakpoint
CREATE INDEX "stripe_checkout_attempt_unresolved_idx" ON "stripe_checkout_attempt" USING btree ("last_create_call_at","created_at") WHERE "stripe_checkout_attempt"."status" in ('creating', 'open');--> statement-breakpoint
CREATE INDEX "stripe_event_created_idx" ON "stripe_event" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_refund_payment_idempotency_unique" ON "stripe_refund" USING btree ("payment_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_refund_stripe_idempotency_unique" ON "stripe_refund" USING btree ("stripe_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_refund_stripe_id_unique" ON "stripe_refund" USING btree ("stripe_refund_id") WHERE "stripe_refund"."stripe_refund_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_refund_one_live_full_per_payment_unique" ON "stripe_refund" USING btree ("payment_id") WHERE "stripe_refund"."status" in ('pending', 'requires_action', 'succeeded');--> statement-breakpoint
CREATE INDEX "stripe_refund_unresolved_idx" ON "stripe_refund" USING btree ("updated_at","created_at") WHERE "stripe_refund"."status" in ('pending', 'requires_action');