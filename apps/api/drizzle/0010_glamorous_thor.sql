CREATE TABLE "cart" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"customer_id" text,
	"guest_token_hash" text,
	"version" integer DEFAULT 1 NOT NULL,
	"last_mutation_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_owner_shape_check" CHECK (
    ("cart"."customer_id" is not null and "cart"."guest_token_hash" is null and "cart"."expires_at" is null)
    or ("cart"."customer_id" is null and "cart"."guest_token_hash" is not null and "cart"."expires_at" is not null)
  ),
	CONSTRAINT "cart_version_positive_check" CHECK ("cart"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "cart_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_item_quantity_range_check" CHECK ("cart_item"."quantity" between 1 and 99)
);
--> statement-breakpoint
CREATE TABLE "commerce_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"shipping_fee_satang" integer,
	"checkout_enabled" boolean DEFAULT false NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commerce_settings_singleton_check" CHECK ("commerce_settings"."id" = 1),
	CONSTRAINT "commerce_settings_shipping_fee_nonnegative_check" CHECK ("commerce_settings"."shipping_fee_satang" is null or "commerce_settings"."shipping_fee_satang" >= 0),
	CONSTRAINT "commerce_settings_enabled_requires_fee_check" CHECK (not "commerce_settings"."checkout_enabled" or "commerce_settings"."shipping_fee_satang" is not null),
	CONSTRAINT "commerce_settings_version_positive_check" CHECK ("commerce_settings"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "cart" ADD CONSTRAINT "cart_customer_id_user_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_cart_id_cart_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."cart"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_item" ADD CONSTRAINT "cart_item_variant_id_product_variant_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_customer_owner_unique" ON "cart" USING btree ("customer_id") WHERE "cart"."customer_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_guest_token_hash_unique" ON "cart" USING btree ("guest_token_hash") WHERE "cart"."guest_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "cart_guest_expiry_idx" ON "cart" USING btree ("expires_at") WHERE "cart"."guest_token_hash" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "cart_item_cart_variant_unique" ON "cart_item" USING btree ("cart_id","variant_id");--> statement-breakpoint
CREATE INDEX "cart_item_variant_idx" ON "cart_item" USING btree ("variant_id");
--> statement-breakpoint
INSERT INTO "commerce_settings" ("id", "shipping_fee_satang", "checkout_enabled", "version")
VALUES (1, null, false, 1);
