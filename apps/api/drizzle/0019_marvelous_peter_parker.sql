ALTER TABLE "stripe_checkout_attempt" DROP CONSTRAINT "stripe_checkout_attempt_status_check";--> statement-breakpoint
ALTER TABLE "stripe_checkout_attempt" ADD COLUMN "success_url" text;--> statement-breakpoint
ALTER TABLE "stripe_checkout_attempt" ADD COLUMN "cancel_url" text;--> statement-breakpoint
ALTER TABLE "stripe_checkout_attempt" ADD CONSTRAINT "stripe_checkout_attempt_status_check" CHECK ("stripe_checkout_attempt"."status" in ('creating', 'open', 'completed', 'expired', 'failed', 'manual_review'));