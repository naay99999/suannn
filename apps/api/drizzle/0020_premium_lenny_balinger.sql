DROP INDEX "stripe_checkout_attempt_unresolved_idx";--> statement-breakpoint
DROP INDEX "stripe_refund_unresolved_idx";--> statement-breakpoint
ALTER TABLE "stripe_checkout_attempt" ADD COLUMN "last_reconciled_at" timestamp with time zone DEFAULT '1970-01-01T00:00:00.000Z'::timestamptz NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_refund" ADD COLUMN "last_reconciled_at" timestamp with time zone DEFAULT '1970-01-01T00:00:00.000Z'::timestamptz NOT NULL;--> statement-breakpoint
CREATE INDEX "stripe_checkout_attempt_unresolved_idx" ON "stripe_checkout_attempt" USING btree ("last_reconciled_at","last_create_call_at","created_at") WHERE "stripe_checkout_attempt"."status" in ('creating', 'open');--> statement-breakpoint
CREATE INDEX "stripe_refund_unresolved_idx" ON "stripe_refund" USING btree ("last_reconciled_at","updated_at","created_at") WHERE "stripe_refund"."status" in ('pending', 'requires_action');