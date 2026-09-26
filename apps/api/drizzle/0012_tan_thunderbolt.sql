ALTER TABLE "order_item_allocation" DROP CONSTRAINT "order_item_allocation_reservation_lot_quantity_fk";
--> statement-breakpoint
DROP INDEX "order_outbox_order_event_unique";
--> statement-breakpoint
ALTER TABLE "order_item_allocation" ADD COLUMN "order_id" uuid;
--> statement-breakpoint
ALTER TABLE "order_item_allocation" ADD COLUMN "reservation_id" uuid;
--> statement-breakpoint
UPDATE "order_item_allocation" AS allocation
SET "order_id" = item."order_id",
    "reservation_id" = reservation."reservation_id"
FROM "order_item" AS item, "inventory_reservation_allocation" AS reservation
WHERE item."id" = allocation."order_item_id"
  AND reservation."id" = allocation."reservation_allocation_id";
--> statement-breakpoint
ALTER TABLE "order_item_allocation" ALTER COLUMN "order_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "order_item_allocation" ALTER COLUMN "reservation_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_id_reservation_unique" UNIQUE("id","reservation_id");
--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_id_payment_method_total_unique" UNIQUE("id","payment_method","total_satang");
--> statement-breakpoint
ALTER TABLE "inventory_reservation_allocation" ADD CONSTRAINT "inventory_res_alloc_identity_unique" UNIQUE("reservation_id","id","lot_id","quantity");
--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_id_order_unique" UNIQUE("id","order_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "order_outbox_event_id_unique" ON "order_outbox" USING btree ("order_event_id");
--> statement-breakpoint
ALTER TABLE "order_item_allocation" ADD CONSTRAINT "order_item_allocation_item_order_fk" FOREIGN KEY ("order_item_id","order_id") REFERENCES "public"."order_item"("id","order_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_item_allocation" ADD CONSTRAINT "order_item_allocation_order_reservation_fk" FOREIGN KEY ("order_id","reservation_id") REFERENCES "public"."commerce_order"("id","reservation_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_item_allocation" ADD CONSTRAINT "order_item_allocation_reservation_lot_quantity_fk" FOREIGN KEY ("reservation_id","reservation_allocation_id","lot_id","quantity") REFERENCES "public"."inventory_reservation_allocation"("reservation_id","id","lot_id","quantity") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_method_amount_fk" FOREIGN KEY ("order_id","method","amount_satang") REFERENCES "public"."commerce_order"("id","payment_method","total_satang") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_status_values_check" CHECK (
    ("order_event"."from_status" is null or "order_event"."from_status" in ('pending_payment', 'placed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'))
    and ("order_event"."to_status" is null or "order_event"."to_status" in ('pending_payment', 'placed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled'))
  );
--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_cod_provider_check" CHECK ("payment"."method" <> 'cod' or "payment"."provider" = 'cod');
--> statement-breakpoint
-- Keep the additional allocation identity fields inside the snapshot immutability trigger as well.
CREATE OR REPLACE FUNCTION reject_order_item_allocation_snapshot_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'order item allocation snapshots cannot be deleted' USING ERRCODE = '23514';
	END IF;
	IF ROW(NEW.id, NEW.order_id, NEW.order_item_id, NEW.lot_id, NEW.reservation_id,
		NEW.reservation_allocation_id, NEW.quantity, NEW.created_at)
		IS DISTINCT FROM ROW(OLD.id, OLD.order_id, OLD.order_item_id, OLD.lot_id, OLD.reservation_id,
		OLD.reservation_allocation_id, OLD.quantity, OLD.created_at) THEN
		RAISE EXCEPTION 'order item allocation snapshots are immutable' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
