CREATE TABLE "receipt_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"seller_name" text,
	"seller_tax_id" text,
	"seller_branch" text,
	"seller_address_line1" text,
	"seller_address_line2" text,
	"seller_subdistrict" text,
	"seller_district" text,
	"seller_province" text,
	"seller_postal_code" text,
	"seller_phone" text,
	"vat_rate_basis_points" integer DEFAULT 700 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_settings_singleton_check" CHECK ("receipt_settings"."id" = 1),
	CONSTRAINT "receipt_settings_vat_rate_check" CHECK ("receipt_settings"."vat_rate_basis_points" between 0 and 10000),
	CONSTRAINT "receipt_settings_branch_check" CHECK ("receipt_settings"."seller_branch" is null or "receipt_settings"."seller_branch" ~ '^[0-9]{5}$'),
	CONSTRAINT "receipt_settings_tax_id_check" CHECK ("receipt_settings"."seller_tax_id" is null or "receipt_settings"."seller_tax_id" ~ '^[0-9]{13}$'),
	CONSTRAINT "receipt_settings_version_positive_check" CHECK ("receipt_settings"."version" > 0)
);

--> statement-breakpoint
INSERT INTO "receipt_settings" ("id", "vat_rate_basis_points", "version") VALUES (1, 700, 1);
