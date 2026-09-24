CREATE TABLE "customer_address" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text NOT NULL,
	"recipient_name" text NOT NULL,
	"phone" text NOT NULL,
	"address_line_1" text NOT NULL,
	"address_line_2" text,
	"subdistrict" text NOT NULL,
	"district" text NOT NULL,
	"province" text NOT NULL,
	"postal_code" text NOT NULL,
	"country" text DEFAULT 'TH' NOT NULL,
	"is_default_shipping" boolean DEFAULT false NOT NULL,
	"is_default_billing" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "customer_address_country_th" CHECK ("customer_address"."country" = 'TH')
);
--> statement-breakpoint
ALTER TABLE "customer_address" ADD CONSTRAINT "customer_address_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_address_shipping_default_unique" ON "customer_address" USING btree ("user_id") WHERE "customer_address"."is_default_shipping" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_address_billing_default_unique" ON "customer_address" USING btree ("user_id") WHERE "customer_address"."is_default_billing" = true;--> statement-breakpoint
CREATE INDEX "customer_address_owner_created_idx" ON "customer_address" USING btree ("user_id","created_at","id");