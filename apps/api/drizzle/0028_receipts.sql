CREATE TABLE "receipt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"receipt_number" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'issued' NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancel_reason" text,
	"snapshot" jsonb NOT NULL,
	CONSTRAINT "receipt_number_format_check" CHECK ("receipt"."receipt_number" ~ '^RC[0-9]{6}-[0-9]{5,}$'),
	CONSTRAINT "receipt_kind_check" CHECK ("receipt"."kind" in ('abbreviated_tax_invoice', 'receipt')),
	CONSTRAINT "receipt_status_check" CHECK ("receipt"."status" in ('issued', 'cancelled')),
	CONSTRAINT "receipt_snapshot_object_check" CHECK (jsonb_typeof("receipt"."snapshot") = 'object'),
	CONSTRAINT "receipt_cancel_state_check" CHECK (
    ("receipt"."status" = 'issued'
      and "receipt"."cancelled_at" is null and "receipt"."cancelled_by" is null and "receipt"."cancel_reason" is null)
    or ("receipt"."status" = 'cancelled'
      and "receipt"."cancelled_at" is not null
      and "receipt"."cancelled_by" is not null and length(btrim("receipt"."cancelled_by")) between 1 and 200
      and "receipt"."cancel_reason" is not null and length(btrim("receipt"."cancel_reason")) between 1 and 300)
  )
);
--> statement-breakpoint
CREATE TABLE "receipt_counter" (
	"period" text PRIMARY KEY NOT NULL,
	"last_value" integer NOT NULL,
	CONSTRAINT "receipt_counter_period_check" CHECK ("receipt_counter"."period" ~ '^[0-9]{6}$'),
	CONSTRAINT "receipt_counter_last_value_check" CHECK ("receipt_counter"."last_value" > 0)
);
--> statement-breakpoint
ALTER TABLE "receipt" ADD CONSTRAINT "receipt_order_id_commerce_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."commerce_order"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_order_unique" ON "receipt" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_number_unique" ON "receipt" USING btree ("receipt_number");--> statement-breakpoint
CREATE FUNCTION reject_receipt_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'receipts cannot be deleted' USING ERRCODE = '23514';
	END IF;
	IF ROW(NEW.id, NEW.order_id, NEW.receipt_number, NEW.kind, NEW.issued_at, NEW.snapshot)
		IS DISTINCT FROM ROW(OLD.id, OLD.order_id, OLD.receipt_number, OLD.kind, OLD.issued_at, OLD.snapshot) THEN
		RAISE EXCEPTION 'issued receipts are immutable' USING ERRCODE = '23514';
	END IF;
	IF OLD.status = 'cancelled' AND ROW(NEW.status, NEW.cancelled_at, NEW.cancelled_by, NEW.cancel_reason)
		IS DISTINCT FROM ROW(OLD.status, OLD.cancelled_at, OLD.cancelled_by, OLD.cancel_reason) THEN
		RAISE EXCEPTION 'cancelled receipts are final' USING ERRCODE = '23514';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER receipt_immutable
BEFORE UPDATE OR DELETE ON receipt
FOR EACH ROW EXECUTE FUNCTION reject_receipt_mutation();
