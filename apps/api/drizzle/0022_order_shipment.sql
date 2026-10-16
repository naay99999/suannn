ALTER TABLE "commerce_order" ADD COLUMN "shipment_carrier" text;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "shipment_carrier_name" text;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "tracking_number" text;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD COLUMN "shipped_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_shipment_carrier_check" CHECK ("commerce_order"."shipment_carrier" is null or "commerce_order"."shipment_carrier" in ('thailand_post', 'kerry', 'flash', 'jt', 'other'));--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_shipment_shape_check" CHECK (
    ("commerce_order"."shipment_carrier" is null
      and "commerce_order"."shipment_carrier_name" is null
      and "commerce_order"."tracking_number" is null
      and "commerce_order"."shipped_at" is null)
    or ("commerce_order"."shipment_carrier" is not null
      and "commerce_order"."tracking_number" ~ '^[A-Za-z0-9-]{4,40}$'
      and "commerce_order"."shipped_at" is not null
      and (("commerce_order"."shipment_carrier" = 'other' and length(btrim("commerce_order"."shipment_carrier_name")) between 1 and 80)
        or ("commerce_order"."shipment_carrier" <> 'other' and "commerce_order"."shipment_carrier_name" is null)))
  );