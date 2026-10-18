ALTER TABLE "product" ADD COLUMN "vat_treatment" text;--> statement-breakpoint
UPDATE "product" SET "vat_treatment" = CASE WHEN "category" = 'fresh' THEN 'exempt' ELSE 'standard' END;--> statement-breakpoint
ALTER TABLE "product" ALTER COLUMN "vat_treatment" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "product" ADD CONSTRAINT "product_vat_treatment_check" CHECK ("product"."vat_treatment" in ('standard', 'exempt'));
