CREATE TABLE "commerce_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"customer_id" text,
	"guest_access_token_hash" text,
	"guest_access_token_nonce" text,
	"guest_access_token_version" integer,
	"contact_email" text NOT NULL,
	"contact_phone" text NOT NULL,
	"recipient_name" text NOT NULL,
	"address_line_1" text NOT NULL,
	"address_line_2" text,
	"subdistrict" text NOT NULL,
	"district" text NOT NULL,
	"province" text NOT NULL,
	"postal_code" text NOT NULL,
	"subtotal_satang" bigint NOT NULL,
	"shipping_satang" bigint NOT NULL,
	"total_satang" bigint NOT NULL,
	"currency" text DEFAULT 'THB' NOT NULL,
	"payment_method" text DEFAULT 'cod' NOT NULL,
	"status" text DEFAULT 'placed' NOT NULL,
	"reservation_id" uuid NOT NULL,
	"quote_fingerprint" text NOT NULL,
	"terminal_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_order_number_nonblank_check" CHECK (length(btrim("commerce_order"."order_number")) between 1 and 80),
	CONSTRAINT "commerce_order_owner_shape_check" CHECK (
    ("commerce_order"."customer_id" is not null
      and "commerce_order"."guest_access_token_hash" is null
      and "commerce_order"."guest_access_token_nonce" is null
      and "commerce_order"."guest_access_token_version" is null)
    or ("commerce_order"."customer_id" is null
      and "commerce_order"."guest_access_token_hash" is not null
      and "commerce_order"."guest_access_token_hash" ~ '^[0-9a-f]{64}$'
      and "commerce_order"."guest_access_token_nonce" is not null
      and length(btrim("commerce_order"."guest_access_token_nonce")) between 1 and 200
      and "commerce_order"."guest_access_token_version" is not null
      and "commerce_order"."guest_access_token_version" > 0)
  ),
	CONSTRAINT "commerce_order_contact_email_check" CHECK (
    length(btrim("commerce_order"."contact_email")) between 3 and 320
    and "commerce_order"."contact_email" ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
	CONSTRAINT "commerce_order_contact_phone_check" CHECK (
    "commerce_order"."contact_phone" ~ '^[+0-9][+0-9 ()-]{6,39}$'
  ),
	CONSTRAINT "commerce_order_recipient_name_check" CHECK (length(btrim("commerce_order"."recipient_name")) between 1 and 200),
	CONSTRAINT "commerce_order_address_line_1_check" CHECK (length(btrim("commerce_order"."address_line_1")) between 1 and 300),
	CONSTRAINT "commerce_order_address_line_2_check" CHECK ("commerce_order"."address_line_2" is null or length(btrim("commerce_order"."address_line_2")) between 1 and 300),
	CONSTRAINT "commerce_order_subdistrict_check" CHECK (length(btrim("commerce_order"."subdistrict")) between 1 and 200),
	CONSTRAINT "commerce_order_district_check" CHECK (length(btrim("commerce_order"."district")) between 1 and 200),
	CONSTRAINT "commerce_order_province_check" CHECK (length(btrim("commerce_order"."province")) between 1 and 200),
	CONSTRAINT "commerce_order_postal_code_check" CHECK ("commerce_order"."postal_code" ~ '^[0-9]{5}$'),
	CONSTRAINT "commerce_order_money_safe_range_check" CHECK (
    "commerce_order"."subtotal_satang" between 0 and 9007199254740991
    and "commerce_order"."shipping_satang" between 0 and 9007199254740991
    and "commerce_order"."total_satang" between 0 and 9007199254740991
  ),
	CONSTRAINT "commerce_order_total_matches_parts_check" CHECK (
    "commerce_order"."subtotal_satang" + "commerce_order"."shipping_satang" = "commerce_order"."total_satang"
    and "commerce_order"."subtotal_satang" + "commerce_order"."shipping_satang" <= 9007199254740991
  ),
	CONSTRAINT "commerce_order_currency_check" CHECK ("commerce_order"."currency" = 'THB'),
	CONSTRAINT "commerce_order_payment_method_nonblank_check" CHECK (length(btrim("commerce_order"."payment_method")) between 1 and 80),
	CONSTRAINT "commerce_order_status_check" CHECK ("commerce_order"."status" in ('pending_payment', 'placed', 'processing', 'packed', 'shipped', 'delivered', 'cancelled')),
	CONSTRAINT "commerce_order_quote_fingerprint_check" CHECK ("commerce_order"."quote_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "order_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"payment_id" uuid,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"reason_code" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_event_id_order_type_unique" UNIQUE("id","order_id","event_type"),
	CONSTRAINT "order_event_type_nonblank_check" CHECK (length(btrim("order_event"."event_type")) between 1 and 100),
	CONSTRAINT "order_event_actor_type_check" CHECK ("order_event"."actor_type" in ('customer', 'guest', 'staff', 'system')),
	CONSTRAINT "order_event_actor_identity_check" CHECK (
    ("order_event"."actor_type" = 'system' and "order_event"."actor_id" is null)
    or ("order_event"."actor_type" in ('customer', 'guest', 'staff')
      and "order_event"."actor_id" is not null
      and length(btrim("order_event"."actor_id")) between 1 and 200)
  ),
	CONSTRAINT "order_event_reason_code_check" CHECK ("order_event"."reason_code" is null or length(btrim("order_event"."reason_code")) between 1 and 100),
	CONSTRAINT "order_event_metadata_object_check" CHECK (jsonb_typeof("order_event"."metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "order_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"product_name" text NOT NULL,
	"variant_name" text NOT NULL,
	"unit" text NOT NULL,
	"unit_price_satang" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_satang" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_item_snapshot_text_check" CHECK (
    length(btrim("order_item"."sku")) between 1 and 120
    and length(btrim("order_item"."product_name")) between 1 and 300
    and length(btrim("order_item"."variant_name")) between 1 and 200
    and length(btrim("order_item"."unit")) between 1 and 80
  ),
	CONSTRAINT "order_item_quantity_range_check" CHECK ("order_item"."quantity" between 1 and 99),
	CONSTRAINT "order_item_unit_price_safe_range_check" CHECK ("order_item"."unit_price_satang" between 1 and 9007199254740991),
	CONSTRAINT "order_item_line_total_safe_range_check" CHECK ("order_item"."line_total_satang" between 1 and 9007199254740991),
	CONSTRAINT "order_item_line_total_matches_quantity_check" CHECK (
    "order_item"."unit_price_satang" <= 9007199254740991 / greatest("order_item"."quantity", 1)
    and "order_item"."unit_price_satang" * "order_item"."quantity" = "order_item"."line_total_satang"
  )
);
--> statement-breakpoint
CREATE TABLE "order_item_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_item_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"reservation_allocation_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"restoration_status" text DEFAULT 'reversible' NOT NULL,
	"restored_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_item_allocation_quantity_range_check" CHECK ("order_item_allocation"."quantity" between 1 and 1000000),
	CONSTRAINT "order_item_allocation_restoration_state_check" CHECK (
    ("order_item_allocation"."restoration_status" = 'restored' and "order_item_allocation"."restored_at" is not null)
    or ("order_item_allocation"."restoration_status" in ('reversible', 'released') and "order_item_allocation"."restored_at" is null)
  )
);
--> statement-breakpoint
CREATE TABLE "order_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"command" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"http_status" integer NOT NULL,
	"result_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_operation_scope_check" CHECK (length(btrim("order_operation"."scope")) between 1 and 200),
	CONSTRAINT "order_operation_command_check" CHECK (length(btrim("order_operation"."command")) between 1 and 80),
	CONSTRAINT "order_operation_idempotency_key_check" CHECK ("order_operation"."idempotency_key" ~ '^[!-~]{1,128}$'),
	CONSTRAINT "order_operation_request_hash_check" CHECK ("order_operation"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "order_operation_http_status_check" CHECK ("order_operation"."http_status" between 100 and 599),
	CONSTRAINT "order_operation_result_object_check" CHECK (jsonb_typeof("order_operation"."result_payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "order_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"order_event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"template_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "order_outbox_event_type_check" CHECK (length(btrim("order_outbox"."event_type")) between 1 and 100),
	CONSTRAINT "order_outbox_template_id_check" CHECK ("order_outbox"."template_id" ~ '^[a-z0-9_]{1,100}$'),
	CONSTRAINT "order_outbox_status_check" CHECK ("order_outbox"."status" in ('pending', 'processing', 'sent', 'failed')),
	CONSTRAINT "order_outbox_attempt_count_check" CHECK ("order_outbox"."attempt_count" between 0 and 1000000),
	CONSTRAINT "order_outbox_claim_state_check" CHECK (
    ("order_outbox"."status" = 'processing' and "order_outbox"."claimed_at" is not null)
    or ("order_outbox"."status" <> 'processing' and "order_outbox"."claimed_at" is null)
  ),
	CONSTRAINT "order_outbox_sent_state_check" CHECK (
    ("order_outbox"."status" = 'sent' and "order_outbox"."sent_at" is not null)
    or ("order_outbox"."status" <> 'sent' and "order_outbox"."sent_at" is null)
  ),
	CONSTRAINT "order_outbox_error_code_check" CHECK ("order_outbox"."last_error_code" is null or "order_outbox"."last_error_code" ~ '^[A-Z0-9_]{1,100}$')
);
--> statement-breakpoint
CREATE TABLE "payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"method" text NOT NULL,
	"provider" text NOT NULL,
	"amount_satang" bigint NOT NULL,
	"currency" text DEFAULT 'THB' NOT NULL,
	"status" text DEFAULT 'awaiting_collection' NOT NULL,
	"provider_reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_method_nonblank_check" CHECK (length(btrim("payment"."method")) between 1 and 80),
	CONSTRAINT "payment_provider_nonblank_check" CHECK (length(btrim("payment"."provider")) between 1 and 80),
	CONSTRAINT "payment_amount_safe_range_check" CHECK ("payment"."amount_satang" between 0 and 9007199254740991),
	CONSTRAINT "payment_currency_check" CHECK ("payment"."currency" = 'THB'),
	CONSTRAINT "payment_status_check" CHECK ("payment"."status" in ('awaiting_collection', 'collected', 'void')),
	CONSTRAINT "payment_provider_reference_check" CHECK ("payment"."provider_reference" is null or length(btrim("payment"."provider_reference")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_type_check";--> statement-breakpoint
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_type_delta_sign_check";--> statement-breakpoint
ALTER TABLE "inventory_lot" ADD COLUMN "reversible_quantity" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commerce_order" ADD CONSTRAINT "commerce_order_reservation_id_inventory_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."inventory_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_event" ADD CONSTRAINT "order_event_payment_id_payment_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservation_allocation" ADD CONSTRAINT "inventory_reservation_allocation_id_lot_quantity_unique" UNIQUE("id","lot_id","quantity");--> statement-breakpoint
ALTER TABLE "order_item_allocation" ADD CONSTRAINT "order_item_allocation_order_item_id_order_item_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_allocation" ADD CONSTRAINT "order_item_allocation_lot_id_inventory_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_item_allocation" ADD CONSTRAINT "order_item_allocation_reservation_lot_quantity_fk" FOREIGN KEY ("reservation_allocation_id","lot_id","quantity") REFERENCES "public"."inventory_reservation_allocation"("id","lot_id","quantity") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_operation" ADD CONSTRAINT "order_operation_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_outbox" ADD CONSTRAINT "order_outbox_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_outbox" ADD CONSTRAINT "order_outbox_event_order_type_fk" FOREIGN KEY ("order_event_id","order_id","event_type") REFERENCES "public"."order_event"("id","order_id","event_type") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment" ADD CONSTRAINT "payment_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_order_number_unique" ON "commerce_order" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "commerce_order_reservation_unique" ON "commerce_order" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "commerce_order_customer_created_idx" ON "commerce_order" USING btree ("customer_id","created_at","id");--> statement-breakpoint
CREATE INDEX "commerce_order_status_created_idx" ON "commerce_order" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "order_event_order_created_idx" ON "order_event" USING btree ("order_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_item_order_variant_unique" ON "order_item" USING btree ("order_id","variant_id");--> statement-breakpoint
CREATE INDEX "order_item_product_idx" ON "order_item" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "order_item_variant_idx" ON "order_item" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_item_allocation_reservation_allocation_unique" ON "order_item_allocation" USING btree ("reservation_allocation_id");--> statement-breakpoint
CREATE INDEX "order_item_allocation_item_idx" ON "order_item_allocation" USING btree ("order_item_id");--> statement-breakpoint
CREATE INDEX "order_item_allocation_lot_idx" ON "order_item_allocation" USING btree ("lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "order_operation_scope_command_key_unique" ON "order_operation" USING btree ("scope","command","idempotency_key");--> statement-breakpoint
CREATE INDEX "order_operation_order_created_idx" ON "order_operation" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_outbox_order_event_unique" ON "order_outbox" USING btree ("order_id","event_type");--> statement-breakpoint
CREATE INDEX "order_outbox_due_idx" ON "order_outbox" USING btree ("next_attempt_at","created_at") WHERE "order_outbox"."status" in ('pending', 'failed');--> statement-breakpoint
CREATE UNIQUE INDEX "payment_one_active_per_order_unique" ON "payment" USING btree ("order_id") WHERE "payment"."status" <> 'void';--> statement-breakpoint
CREATE INDEX "payment_status_created_idx" ON "payment" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "inventory_lot" ADD CONSTRAINT "inventory_lot_reversible_quantity_range_check" CHECK ("inventory_lot"."reversible_quantity" between 0 and 1000000000);--> statement-breakpoint
ALTER TABLE "inventory_lot" ADD CONSTRAINT "inventory_lot_on_hand_plus_reversible_capacity_check" CHECK ("inventory_lot"."on_hand_quantity" + "inventory_lot"."reversible_quantity" <= 1000000000);--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_type_check" CHECK ("stock_movement"."type" in ('receipt', 'write_off', 'count_adjustment', 'reservation_confirm', 'order_cancel_restore'));--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_type_delta_sign_check" CHECK (
    ("stock_movement"."type" = 'receipt' and "stock_movement"."quantity_delta" > 0)
    or ("stock_movement"."type" in ('write_off', 'reservation_confirm') and "stock_movement"."quantity_delta" < 0)
    or ("stock_movement"."type" = 'order_cancel_restore' and "stock_movement"."quantity_delta" > 0)
    or "stock_movement"."type" = 'count_adjustment'
  );--> statement-breakpoint

-- Custom trigger SQL enforces append-only purchase snapshots; these triggers are not represented in Drizzle snapshot metadata.
CREATE FUNCTION reject_commerce_order_snapshot_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'commerce order snapshots cannot be deleted' USING ERRCODE = '23514';
	END IF;
	IF ROW(
		NEW.order_number, NEW.customer_id, NEW.guest_access_token_hash,
		NEW.guest_access_token_nonce, NEW.guest_access_token_version,
		NEW.contact_email, NEW.contact_phone, NEW.recipient_name,
		NEW.address_line_1, NEW.address_line_2, NEW.subdistrict, NEW.district,
		NEW.province, NEW.postal_code, NEW.subtotal_satang, NEW.shipping_satang,
		NEW.total_satang, NEW.currency, NEW.payment_method, NEW.reservation_id,
		NEW.quote_fingerprint, NEW.created_at
	) IS DISTINCT FROM ROW(
		OLD.order_number, OLD.customer_id, OLD.guest_access_token_hash,
		OLD.guest_access_token_nonce, OLD.guest_access_token_version,
		OLD.contact_email, OLD.contact_phone, OLD.recipient_name,
		OLD.address_line_1, OLD.address_line_2, OLD.subdistrict, OLD.district,
		OLD.province, OLD.postal_code, OLD.subtotal_satang, OLD.shipping_satang,
		OLD.total_satang, OLD.currency, OLD.payment_method, OLD.reservation_id,
		OLD.quote_fingerprint, OLD.created_at
	) THEN
		RAISE EXCEPTION 'commerce order purchase snapshots are immutable' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER commerce_order_snapshot_immutable
BEFORE UPDATE OR DELETE ON commerce_order
FOR EACH ROW EXECUTE FUNCTION reject_commerce_order_snapshot_mutation();--> statement-breakpoint

CREATE FUNCTION reject_order_item_snapshot_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'order item snapshots are immutable' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER order_item_snapshot_immutable
BEFORE UPDATE OR DELETE ON order_item
FOR EACH ROW EXECUTE FUNCTION reject_order_item_snapshot_mutation();--> statement-breakpoint

CREATE FUNCTION reject_order_item_allocation_snapshot_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'order item allocation snapshots cannot be deleted' USING ERRCODE = '23514';
	END IF;
	IF ROW(NEW.id, NEW.order_item_id, NEW.lot_id, NEW.reservation_allocation_id, NEW.quantity, NEW.created_at)
		IS DISTINCT FROM ROW(OLD.id, OLD.order_item_id, OLD.lot_id, OLD.reservation_allocation_id, OLD.quantity, OLD.created_at) THEN
		RAISE EXCEPTION 'order item allocation snapshots are immutable' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER order_item_allocation_snapshot_immutable
BEFORE UPDATE OR DELETE ON order_item_allocation
FOR EACH ROW EXECUTE FUNCTION reject_order_item_allocation_snapshot_mutation();--> statement-breakpoint

CREATE FUNCTION reject_order_event_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'order events are append-only' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER order_event_append_only
BEFORE UPDATE OR DELETE ON order_event
FOR EACH ROW EXECUTE FUNCTION reject_order_event_mutation();
