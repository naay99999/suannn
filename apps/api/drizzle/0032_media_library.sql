CREATE TABLE "media_asset" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"storage_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"content_hash" text NOT NULL,
	"alt" text,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"byte_size" integer NOT NULL,
	"thumb_byte_size" integer NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_asset_alt_length_check" CHECK ("media_asset"."alt" is null or length("media_asset"."alt") between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "product_image" (
	"product_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"display_order" integer NOT NULL,
	CONSTRAINT "product_image_pk" PRIMARY KEY("product_id","media_id"),
	CONSTRAINT "product_image_order_unique" UNIQUE("product_id","display_order"),
	CONSTRAINT "product_image_display_order_check" CHECK ("product_image"."display_order" between 0 and 11)
);
--> statement-breakpoint
ALTER TABLE "farm" ADD COLUMN "cover_media_id" uuid;--> statement-breakpoint
ALTER TABLE "farm" ADD COLUMN "portrait_media_id" uuid;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "media_asset_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_image" ADD CONSTRAINT "product_image_media_id_media_asset_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_storage_key_unique" ON "media_asset" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "media_asset_content_hash_unique" ON "media_asset" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "media_asset_created_id_idx" ON "media_asset" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "product_image_media_id_idx" ON "product_image" USING btree ("media_id");--> statement-breakpoint
ALTER TABLE "farm" ADD CONSTRAINT "farm_cover_media_id_media_asset_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "farm" ADD CONSTRAINT "farm_portrait_media_id_media_asset_id_fk" FOREIGN KEY ("portrait_media_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;