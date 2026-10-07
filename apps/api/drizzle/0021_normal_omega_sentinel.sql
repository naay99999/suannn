CREATE TABLE "farm" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"farmer_name" text,
	"province" text,
	"district" text,
	"summary" text,
	"story" text,
	"growing_practices" text,
	"cover_image_url" text,
	"cover_image_alt" text,
	"portrait_image_url" text,
	"portrait_image_alt" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	CONSTRAINT "farm_slug_format_check" CHECK ("farm"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
	CONSTRAINT "farm_status_check" CHECK ("farm"."status" in ('draft', 'published', 'archived')),
	CONSTRAINT "farm_name_nonblank_check" CHECK (length(btrim("farm"."name")) between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "product_farm" (
	"product_id" uuid NOT NULL,
	"farm_id" uuid NOT NULL,
	"display_order" integer NOT NULL,
	CONSTRAINT "product_farm_pk" PRIMARY KEY("product_id","farm_id"),
	CONSTRAINT "product_farm_display_order_check" CHECK ("product_farm"."display_order" between 0 and 19)
);
--> statement-breakpoint
ALTER TABLE "product_farm" ADD CONSTRAINT "product_farm_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_farm" ADD CONSTRAINT "product_farm_farm_id_farm_id_fk" FOREIGN KEY ("farm_id") REFERENCES "public"."farm"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "farm_slug_unique" ON "farm" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "farm_status_created_id_idx" ON "farm" USING btree ("status","created_at","id");--> statement-breakpoint
CREATE INDEX "product_farm_farm_id_idx" ON "product_farm" USING btree ("farm_id","display_order","product_id");