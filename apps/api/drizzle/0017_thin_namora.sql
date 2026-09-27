ALTER TABLE "stripe_checkout_attempt" DROP CONSTRAINT "stripe_checkout_attempt_session_shape_check";--> statement-breakpoint
ALTER TABLE "stripe_checkout_attempt" ADD CONSTRAINT "stripe_checkout_attempt_session_shape_check" CHECK (
    ("stripe_checkout_attempt"."stripe_session_id" is null and "stripe_checkout_attempt"."checkout_url" is null and "stripe_checkout_attempt"."expires_at" is null)
    or "stripe_checkout_attempt"."stripe_session_id" is not null
  );