ALTER TABLE "stripe_refund" DROP CONSTRAINT "stripe_refund_payment_id_payment_id_fk";
--> statement-breakpoint
ALTER TABLE "stripe_refund" DROP CONSTRAINT "stripe_refund_order_id_commerce_order_id_fk";
--> statement-breakpoint
ALTER TABLE "stripe_refund" ADD CONSTRAINT "stripe_refund_payment_order_fk" FOREIGN KEY ("payment_id","order_id") REFERENCES "public"."payment"("id","order_id") ON DELETE restrict ON UPDATE no action;