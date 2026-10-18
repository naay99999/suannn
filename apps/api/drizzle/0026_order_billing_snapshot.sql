ALTER TABLE "commerce_order" ADD COLUMN "billing_name" text;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "billing_phone" text;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "billing_address_line_1" text;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "billing_address_line_2" text;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "billing_subdistrict" text;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "billing_district" text;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "billing_province" text;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "billing_postal_code" text;--> statement-breakpoint
ALTER TABLE "order_item" ADD COLUMN "vat_treatment" text;--> statement-breakpoint
UPDATE "commerce_order" SET "billing_name" = "recipient_name", "billing_phone" = "contact_phone", "billing_address_line_1" = "address_line_1", "billing_address_line_2" = "address_line_2", "billing_subdistrict" = "subdistrict", "billing_district" = "district", "billing_province" = "province", "billing_postal_code" = "postal_code";--> statement-breakpoint
ALTER TABLE "order_item" DISABLE TRIGGER "order_item_snapshot_immutable";--> statement-breakpoint
UPDATE "order_item" SET "vat_treatment" = "product"."vat_treatment" FROM "product" WHERE "product"."id" = "order_item"."product_id";--> statement-breakpoint
ALTER TABLE "order_item" ENABLE TRIGGER "order_item_snapshot_immutable";--> statement-breakpoint
ALTER TABLE "commerce_order" ALTER COLUMN "billing_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_order" ALTER COLUMN "billing_phone" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_order" ALTER COLUMN "billing_address_line_1" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_order" ALTER COLUMN "billing_subdistrict" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_order" ALTER COLUMN "billing_district" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_order" ALTER COLUMN "billing_province" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_order" ALTER COLUMN "billing_postal_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "order_item" ALTER COLUMN "vat_treatment" SET NOT NULL;--> statement-breakpoint
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
		NEW.quote_fingerprint, NEW.created_at
	) IS DISTINCT FROM ROW(
		OLD.order_number, OLD.customer_id,
		OLD.contact_email, OLD.contact_phone, OLD.recipient_name,
		OLD.address_line_1, OLD.address_line_2, OLD.subdistrict, OLD.district,
		OLD.province, OLD.postal_code,
		OLD.billing_name, OLD.billing_phone, OLD.billing_address_line_1, OLD.billing_address_line_2,
		OLD.billing_subdistrict, OLD.billing_district, OLD.billing_province, OLD.billing_postal_code,
		OLD.subtotal_satang, OLD.shipping_satang,
		OLD.total_satang, OLD.currency, OLD.payment_method, OLD.reservation_id,
		OLD.quote_fingerprint, OLD.created_at
	) THEN
		RAISE EXCEPTION 'commerce order purchase snapshots are immutable' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_billing_name_check" CHECK (length(btrim("commerce_order"."billing_name")) between 1 and 200);--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_billing_phone_check" CHECK (
    "commerce_order"."billing_phone" ~ '^[+0-9][+0-9 ()-]{6,39}$'
  );--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_billing_address_line_1_check" CHECK (length(btrim("commerce_order"."billing_address_line_1")) between 1 and 300);--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_billing_address_line_2_check" CHECK ("commerce_order"."billing_address_line_2" is null or length(btrim("commerce_order"."billing_address_line_2")) between 1 and 300);--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_billing_subdistrict_check" CHECK (length(btrim("commerce_order"."billing_subdistrict")) between 1 and 200);--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_billing_district_check" CHECK (length(btrim("commerce_order"."billing_district")) between 1 and 200);--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_billing_province_check" CHECK (length(btrim("commerce_order"."billing_province")) between 1 and 200);--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_billing_postal_code_check" CHECK ("commerce_order"."billing_postal_code" ~ '^[0-9]{5}$');--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_vat_treatment_check" CHECK ("order_item"."vat_treatment" in ('standard', 'exempt'));