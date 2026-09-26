CREATE TABLE "inventory_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"lot_code" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expiry_date" date NOT NULL,
	"quarantined_at" timestamp with time zone,
	"quarantine_reason" text,
	"on_hand_quantity" integer DEFAULT 0 NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_lot_id_variant_unique" UNIQUE("id","variant_id"),
	CONSTRAINT "inventory_lot_code_format_check" CHECK (btrim("inventory_lot"."lot_code") ~* '^[a-z0-9._/-]{1,100}$'),
	CONSTRAINT "inventory_lot_on_hand_quantity_range_check" CHECK ("inventory_lot"."on_hand_quantity" between 0 and 1000000000),
	CONSTRAINT "inventory_lot_reserved_quantity_range_check" CHECK ("inventory_lot"."reserved_quantity" between 0 and 1000000000),
	CONSTRAINT "inventory_lot_reserved_not_over_on_hand_check" CHECK ("inventory_lot"."reserved_quantity" <= "inventory_lot"."on_hand_quantity")
);
--> statement-breakpoint
CREATE TABLE "inventory_operation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"http_status" integer NOT NULL,
	"result_payload" jsonb NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_operation_scope_nonblank_check" CHECK (length(btrim("inventory_operation"."scope")) between 1 and 100),
	CONSTRAINT "inventory_operation_idempotency_key_check" CHECK ("inventory_operation"."idempotency_key" ~ '^[!-~]{1,128}$'),
	CONSTRAINT "inventory_operation_request_hash_check" CHECK ("inventory_operation"."request_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "inventory_operation_http_status_check" CHECK ("inventory_operation"."http_status" between 100 and 599)
);
--> statement-breakpoint
CREATE TABLE "inventory_reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"warehouse_id" uuid NOT NULL,
	"external_reference" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"actor_id" text NOT NULL,
	CONSTRAINT "inventory_reservation_status_check" CHECK ("inventory_reservation"."status" in ('active', 'confirmed', 'released', 'expired', 'cancelled')),
	CONSTRAINT "inventory_reservation_expiry_after_creation_check" CHECK ("inventory_reservation"."expires_at" > "inventory_reservation"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inventory_reservation_allocation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "inventory_reservation_allocation_quantity_range_check" CHECK ("inventory_reservation_allocation"."quantity" between 1 and 1000000)
);
--> statement-breakpoint
CREATE TABLE "stock_movement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lot_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"quantity_delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"type" text NOT NULL,
	"reason_code" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" text NOT NULL,
	CONSTRAINT "stock_movement_type_check" CHECK ("stock_movement"."type" in ('receipt', 'write_off', 'count_adjustment', 'reservation_confirm')),
	CONSTRAINT "stock_movement_quantity_delta_nonzero_check" CHECK ("stock_movement"."quantity_delta" <> 0),
	CONSTRAINT "stock_movement_balance_after_range_check" CHECK ("stock_movement"."balance_after" between 0 and 1000000000),
	CONSTRAINT "stock_movement_type_delta_sign_check" CHECK (
    ("stock_movement"."type" = 'receipt' and "stock_movement"."quantity_delta" > 0)
    or ("stock_movement"."type" in ('write_off', 'reservation_confirm') and "stock_movement"."quantity_delta" < 0)
    or "stock_movement"."type" = 'count_adjustment'
  ),
	CONSTRAINT "stock_movement_reason_code_nonblank_check" CHECK (length(btrim("stock_movement"."reason_code")) between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "warehouse" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "warehouse_code_nonblank_check" CHECK (length(btrim("warehouse"."code")) between 1 and 100),
	CONSTRAINT "warehouse_name_nonblank_check" CHECK (length(btrim("warehouse"."name")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "product_variant" ADD COLUMN "min_remaining_shelf_life_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_lot" ADD CONSTRAINT "inventory_lot_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lot" ADD CONSTRAINT "inventory_lot_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservation" ADD CONSTRAINT "inventory_reservation_warehouse_id_warehouse_id_fk" FOREIGN KEY ("warehouse_id") REFERENCES "public"."warehouse"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservation_allocation" ADD CONSTRAINT "inventory_reservation_allocation_reservation_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."inventory_reservation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservation_allocation" ADD CONSTRAINT "inventory_reservation_allocation_lot_variant_fk" FOREIGN KEY ("lot_id","variant_id") REFERENCES "public"."inventory_lot"("id","variant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_lot_id_inventory_lot_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."inventory_lot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_operation_id_inventory_operation_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."inventory_operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_lot_normalized_code_unique" ON "inventory_lot" USING btree ("warehouse_id","variant_id",upper(btrim("lot_code")));--> statement-breakpoint
CREATE INDEX "inventory_lot_allocation_fifo_idx" ON "inventory_lot" USING btree ("warehouse_id","variant_id","received_at","id");--> statement-breakpoint
CREATE INDEX "inventory_lot_availability_expiry_idx" ON "inventory_lot" USING btree ("warehouse_id","variant_id","expiry_date");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_operation_scope_key_unique" ON "inventory_operation" USING btree ("scope","idempotency_key");--> statement-breakpoint
CREATE INDEX "inventory_reservation_status_expiry_idx" ON "inventory_reservation" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_reservation_allocation_reservation_lot_unique" ON "inventory_reservation_allocation" USING btree ("reservation_id","lot_id");--> statement-breakpoint
CREATE INDEX "inventory_reservation_allocation_lot_idx" ON "inventory_reservation_allocation" USING btree ("lot_id");--> statement-breakpoint
CREATE INDEX "inventory_reservation_allocation_variant_idx" ON "inventory_reservation_allocation" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "stock_movement_lot_history_idx" ON "stock_movement" USING btree ("lot_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "stock_movement_operation_idx" ON "stock_movement" USING btree ("operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "warehouse_code_unique" ON "warehouse" USING btree ("code");--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_min_remaining_shelf_life_days_range_check" CHECK ("product_variant"."min_remaining_shelf_life_days" between 0 and 365);
--> statement-breakpoint
INSERT INTO "warehouse" ("id", "code", "name", "is_active")
VALUES ('00000000-0000-4000-8000-000000000001', 'MAIN', 'Main warehouse', true);
