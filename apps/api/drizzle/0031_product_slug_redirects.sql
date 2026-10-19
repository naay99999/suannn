CREATE TABLE "product_slug_redirect" (
	"slug" text PRIMARY KEY NOT NULL,
	"product_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_slug_redirect_format_check" CHECK ("product_slug_redirect"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "product_slug_redirect" ADD CONSTRAINT "product_slug_redirect_product_id_product_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."product"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "product_slug_redirect_product_idx" ON "product_slug_redirect" USING btree ("product_id");