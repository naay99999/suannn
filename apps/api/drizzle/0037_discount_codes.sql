CREATE TABLE "discount_code" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"percent_off" integer,
	"amount_off_satang" bigint,
	"max_discount_satang" bigint,
	"min_subtotal_satang" bigint,
	"min_quantity" integer,
	"eligible_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"eligible_product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"usage_limit" integer,
	"per_customer_limit" integer,
	"allowed_emails" text[] DEFAULT '{}'::text[] NOT NULL,
	"first_order_only" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_code_code_unique" UNIQUE("code"),
	CONSTRAINT "discount_code_code_check" CHECK ("discount_code"."code" ~ '^[A-Z0-9-]{3,32}$'),
	CONSTRAINT "discount_code_name_check" CHECK (char_length("discount_code"."name") between 1 and 100),
	CONSTRAINT "discount_code_kind_check" CHECK ("discount_code"."kind" in ('percent', 'fixed', 'free_shipping')),
	CONSTRAINT "discount_code_shape_check" CHECK (
    ("discount_code"."kind" = 'percent' and "discount_code"."percent_off" is not null and "discount_code"."amount_off_satang" is null)
    or ("discount_code"."kind" = 'fixed' and "discount_code"."amount_off_satang" is not null
      and "discount_code"."percent_off" is null and "discount_code"."max_discount_satang" is null)
    or ("discount_code"."kind" = 'free_shipping' and "discount_code"."percent_off" is null
      and "discount_code"."amount_off_satang" is null and "discount_code"."max_discount_satang" is null)
  ),
	CONSTRAINT "discount_code_percent_off_check" CHECK ("discount_code"."percent_off" is null or "discount_code"."percent_off" between 1 and 100),
	CONSTRAINT "discount_code_amount_off_check" CHECK ("discount_code"."amount_off_satang" is null or "discount_code"."amount_off_satang" >= 1),
	CONSTRAINT "discount_code_max_discount_check" CHECK ("discount_code"."max_discount_satang" is null or "discount_code"."max_discount_satang" >= 1),
	CONSTRAINT "discount_code_min_subtotal_check" CHECK ("discount_code"."min_subtotal_satang" is null or "discount_code"."min_subtotal_satang" >= 1),
	CONSTRAINT "discount_code_min_quantity_check" CHECK ("discount_code"."min_quantity" is null or "discount_code"."min_quantity" >= 1),
	CONSTRAINT "discount_code_categories_check" CHECK ("discount_code"."eligible_categories" <@ array['fresh', 'processed']::text[]),
	CONSTRAINT "discount_code_window_check" CHECK ("discount_code"."starts_at" is null or "discount_code"."ends_at" is null or "discount_code"."ends_at" > "discount_code"."starts_at"),
	CONSTRAINT "discount_code_usage_limit_check" CHECK ("discount_code"."usage_limit" is null or "discount_code"."usage_limit" >= 1),
	CONSTRAINT "discount_code_per_customer_limit_check" CHECK ("discount_code"."per_customer_limit" is null or "discount_code"."per_customer_limit" >= 1),
	CONSTRAINT "discount_code_allowed_emails_check" CHECK (coalesce(cardinality("discount_code"."allowed_emails"), 0) <= 500),
	CONSTRAINT "discount_code_version_check" CHECK ("discount_code"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "commerce_order" DROP CONSTRAINT "commerce_order_total_matches_parts_check";--> statement-breakpoint
ALTER TABLE "cart" ADD COLUMN "discount_code_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "discount_code_id" uuid;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "discount_code" text;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "discount_kind" text;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "discount_satang" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "shipping_discount_satang" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "discount_email" text;--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "discount_satang" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cart" ADD CONSTRAINT "cart_discount_code_id_discount_code_id_fk" FOREIGN KEY ("discount_code_id") REFERENCES "public"."discount_code"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_discount_code_id_discount_code_id_fk" FOREIGN KEY ("discount_code_id") REFERENCES "public"."discount_code"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commerce_order_discount_code_email_idx" ON "commerce_order" USING btree ("discount_code_id","discount_email");--> statement-breakpoint
CREATE INDEX "commerce_order_contact_email_normalised_idx" ON "commerce_order" USING btree (lower(btrim("contact_email")));--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_discount_range_check" CHECK (
    "commerce_order"."discount_satang" between 0 and "commerce_order"."subtotal_satang"
    and "commerce_order"."shipping_discount_satang" >= 0
  );--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_discount_snapshot_shape_check" CHECK (
    ("commerce_order"."discount_code_id" is null and "commerce_order"."discount_code" is null
      and "commerce_order"."discount_kind" is null and "commerce_order"."discount_email" is null)
    or ("commerce_order"."discount_code_id" is not null and "commerce_order"."discount_code" is not null
      and "commerce_order"."discount_kind" is not null and "commerce_order"."discount_email" is not null)
  );--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_total_matches_parts_check" CHECK (
    "commerce_order"."subtotal_satang" - "commerce_order"."discount_satang" + "commerce_order"."shipping_satang" = "commerce_order"."total_satang"
    and "commerce_order"."subtotal_satang" + "commerce_order"."shipping_satang" <= 9007199254740991
  );--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_discount_range_check" CHECK ("order_item"."discount_satang" between 0 and "order_item"."line_total_satang");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_commerce_order_snapshot_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'commerce order snapshots cannot be deleted' USING ERRCODE = '23514';
	END IF;
	IF ROW(
		NEW.order_number, NEW.customer_id,
		NEW.contact_email, NEW.contact_phone, NEW.recipient_name,
		NEW.address_line_1, NEW.address_line_2, NEW.subdistrict, NEW.district,
		NEW.province, NEW.postal_code,
		NEW.billing_name, NEW.billing_phone, NEW.billing_address_line_1, NEW.billing_address_line_2,
		NEW.billing_subdistrict, NEW.billing_district, NEW.billing_province, NEW.billing_postal_code,
		NEW.subtotal_satang, NEW.shipping_satang,
		NEW.total_satang, NEW.currency, NEW.payment_method, NEW.reservation_id,
		NEW.quote_fingerprint, NEW.created_at,
		NEW.discount_code_id, NEW.discount_code, NEW.discount_kind,
		NEW.discount_satang, NEW.shipping_discount_satang, NEW.discount_email
	) IS DISTINCT FROM ROW(
		OLD.order_number, OLD.customer_id,
		OLD.contact_email, OLD.contact_phone, OLD.recipient_name,
		OLD.address_line_1, OLD.address_line_2, OLD.subdistrict, OLD.district,
		OLD.province, OLD.postal_code,
		OLD.billing_name, OLD.billing_phone, OLD.billing_address_line_1, OLD.billing_address_line_2,
		OLD.billing_subdistrict, OLD.billing_district, OLD.billing_province, OLD.billing_postal_code,
		OLD.subtotal_satang, OLD.shipping_satang,
		OLD.total_satang, OLD.currency, OLD.payment_method, OLD.reservation_id,
		OLD.quote_fingerprint, OLD.created_at,
		OLD.discount_code_id, OLD.discount_code, OLD.discount_kind,
		OLD.discount_satang, OLD.shipping_discount_satang, OLD.discount_email
	) THEN
		RAISE EXCEPTION 'commerce order purchase snapshots are immutable' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
