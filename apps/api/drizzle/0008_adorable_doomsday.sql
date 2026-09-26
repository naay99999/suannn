CREATE TABLE "product" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"english_name" text,
	"description" text,
	"category" text NOT NULL,
	"origin_story" text,
	"storage_instructions" text,
	"image_url" text,
	"image_alt" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "product_category_check" CHECK ("product"."category" in ('fresh', 'processed')),
	CONSTRAINT "product_status_check" CHECK ("product"."status" in ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "product_variant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" text NOT NULL,
	"name" text NOT NULL,
	"unit" text NOT NULL,
	"price_satang" integer NOT NULL,
	"sales_enabled" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "product_variant_price_satang_range_check" CHECK ("product_variant"."price_satang" between 1 and 1000000000),
	CONSTRAINT "product_variant_display_order_range_check" CHECK ("product_variant"."display_order" between 0 and 1000000)
);
--> statement-breakpoint
ALTER TABLE "product_variant" ADD CONSTRAINT "product_variant_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "product_slug_unique" ON "product" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "product_status_created_id_idx" ON "product" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variant_sku_unique" ON "product_variant" USING btree ("sku");--> statement-breakpoint
CREATE INDEX "product_variant_product_display_order_id_idx" ON "product_variant" USING btree ("product_id","display_order","id");