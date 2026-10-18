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