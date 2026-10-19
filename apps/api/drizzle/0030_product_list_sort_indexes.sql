CREATE INDEX "product_created_id_idx" ON "product" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "product_updated_id_idx" ON "product" USING btree ("updated_at","id");--> statement-breakpoint
CREATE INDEX "product_name_id_idx" ON "product" USING btree ("name","id");--> statement-breakpoint
CREATE INDEX "product_category_id_idx" ON "product" USING btree ("category","id");--> statement-breakpoint
CREATE INDEX "product_status_id_idx" ON "product" USING btree ("status","id");