CREATE INDEX "commerce_order_created_id_idx" ON "commerce_order" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "commerce_order_total_id_idx" ON "commerce_order" USING btree ("total_satang","id");--> statement-breakpoint
CREATE INDEX "commerce_order_recipient_id_idx" ON "commerce_order" USING btree ("recipient_name","id");--> statement-breakpoint
CREATE INDEX "commerce_order_status_id_idx" ON "commerce_order" USING btree ("status","id");