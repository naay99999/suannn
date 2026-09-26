CREATE OR REPLACE FUNCTION reject_commerce_order_snapshot_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'commerce order snapshots cannot be deleted' USING ERRCODE = '23514';
	END IF;
	IF ROW(
		NEW.order_number, NEW.customer_id,
		NEW.contact_email, NEW.contact_phone, NEW.recipient_name,
		NEW.address_line_1, NEW.address_line_2, NEW.subdistrict, NEW.district,
		NEW.province, NEW.postal_code, NEW.subtotal_satang, NEW.shipping_satang,
		NEW.total_satang, NEW.currency, NEW.payment_method, NEW.reservation_id,
		NEW.quote_fingerprint, NEW.created_at
	) IS DISTINCT FROM ROW(
		OLD.order_number, OLD.customer_id,
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
