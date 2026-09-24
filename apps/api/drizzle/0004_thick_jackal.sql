ALTER TABLE "identity_email_claim" DROP CONSTRAINT "identity_email_claim_shape_check";--> statement-breakpoint
ALTER TABLE "identity_email_claim" ADD CONSTRAINT "identity_email_claim_shape_check" CHECK ((
        "identity_email_claim"."state" in ('customer', 'staff')
        and "identity_email_claim"."user_id" is not null
        and "identity_email_claim"."invitation_id" is null
        and "identity_email_claim"."operation_id" is null
      ) or (
        "identity_email_claim"."state" = 'pending_staff'
        and "identity_email_claim"."user_id" is null
        and "identity_email_claim"."invitation_id" is not null
        and ("identity_email_claim"."operation_id" is null or "identity_email_claim"."request_id" is not null)
      ) or (
        "identity_email_claim"."state" = 'pending_customer'
        and "identity_email_claim"."user_id" is null
        and "identity_email_claim"."invitation_id" is null
        and "identity_email_claim"."operation_id" is not null
      ));