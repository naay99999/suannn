# Customer Account API Design

**Date:** 2026-09-24

**Status:** Awaiting written-spec review

**Scope:** `apps/api` only. No storefront or admin integration in this work.

## Purpose and success criteria

Give customer accounts a complete self-service API for identity, profile,
addresses, and sessions. Customers must be able to register, sign in, verify
their email, recover or change a password, sign out, inspect and revoke their
sessions, change their name, confirm a new email address, and maintain multiple
Thai addresses with independent shipping and billing defaults. A customer may
sign in and maintain their account before verifying their original email.

The API must keep customer and staff identities separate. A customer cannot
read or change another customer's data, and a staff session cannot use customer
self-service endpoints. Existing identity-claim, CSRF, rate-limit, and audit
policies remain authoritative.

Order history, checkout, account deletion, social login, storefront screens,
and admin screens are outside this design. The API does not add a second auth
provider or session store.

## Existing context

The API already implements application-owned `POST /api/v1/auth/sign-up` and
allowlisted Better Auth routes for sign-in, sign-out, verification, password
recovery and change, session inspection and revocation. `get-session` projects
the current user and session without internal credential data. Customer signup
uses `identityEmailClaim` and normalized-email locks so a staff invitation and
a customer cannot claim the same email. Customer sessions last up to 30 days;
staff sessions follow separate stricter rules. The email sender uses Resend and
an existing background task queue.

There is no customer profile or address module beyond Better Auth's `user`
record. The storefront has no auth integration. Application routes are typed by
the `App` export and documented in the generated OpenAPI output; Better Auth's
HTTP routes are documented separately and need a direct credentialed HTTP
client until a storefront auth adapter is built.

## Architecture and API ownership

Better Auth continues to own password hashing, email/password sign-in,
verification, reset/change password, cookies, and session lifecycle. The
existing customer signup service remains the only public user creation path.
New customer modules under `src/modules/customer/` own profile, email-change,
and address application routes. Their route modules validate HTTP input and
authorize the customer; services enforce business rules; repositories perform
database access. `app.ts` composes the modules and exports their typed routes.

All new account routes require a valid session whose `accountType` is
`customer`. The guard returns `401 AUTHENTICATION_REQUIRED` without a session
and `403 CUSTOMER_ACCOUNT_REQUIRED` for a staff session. Verification of the
original email is not required for self-service. Every new browser mutation
requires JSON and the configured storefront Origin through the existing
`browserMutation('storefront')` policy. New sensitive routes use the shared
PostgreSQL application rate limiter. The API does not trust a user ID from a
request body or path for self-service authorization.

The existing Better Auth `/update-user` allowlist remains available for its
current purpose. The new profile route exposes a narrow, application-owned
contract for the customer-facing API. Raw Better Auth `/change-email` stays
blocked; only the new email-change flow may change a customer's email.

## Profile contract

- `GET /api/v1/customer/profile` returns `id`, `name`, `email`, and
  `emailVerified` from current server state.
- `PATCH /api/v1/customer/profile` accepts only a nonblank `name` of at most
  100 characters and returns the same projection. It cannot update email,
  role, account type, verification status, or plugin fields.

The profile has no separate phone field. Each delivery or billing address owns
its recipient phone number, allowing different recipients. Image upload and
avatar editing are outside this API.

## Change-email contract and data flow

- `POST /api/v1/customer/email-change/request` accepts `newEmail` and
  `currentPassword`. It checks the current password without issuing a second
  session, normalizes the address with the existing `normalizeEmail()`, rejects
  the unchanged address, and checks both `user` and `identityEmailClaim` for
  availability. It sends an eight-digit confirmation code to the new address
  and returns `{ accepted: true }`. An occupied or reserved email returns
  `409 EMAIL_UNAVAILABLE`, without disclosing whether it belongs to a customer
  or staff member.
- `POST /api/v1/customer/email-change/confirm` accepts the code from an active
  customer session. It returns `{ changed: true }` after a successful change.
  A code alone is insufficient without the requesting customer's session.

One pending change per user is stored in an application-owned table containing
the user ID, normalized new email, keyed code digest, creation and expiration
times, and failed-attempt count. It contains no plaintext code or password.
The code expires after ten minutes, permits at most five failed attempts, and
is consumed once. A new request replaces the previous pending change. Request
and confirmation routes are additionally limited by customer ID and client IP;
the request limit is three per hour and confirmation limit is five per ten
minutes. Email sending uses the existing sender and best-effort queue; a
delivery failure is logged without code or address and the customer can retry.

Confirmation obtains locks for the current and proposed normalized emails in
stable order. Inside one database transaction it locks and rechecks the user,
active session, pending code, and the new address's user and claim state. It
updates `user.email`, marks the new email verified, removes the old customer
claim, inserts the new customer claim, consumes the pending change, revokes all
of that customer's sessions, and records `customer.email-changed` with no
email or code in audit metadata. If another signup or staff invitation claimed
the new address while the code was in transit, confirmation returns
`409 EMAIL_UNAVAILABLE` and leaves the old identity intact. Locking must use
the same identity lock mechanism as signup and invitations; it must not introduce
a second unsynchronized email-change path.

The confirmation code is sent in the email body, with no mutating GET link.
This makes the complete flow callable through the API before a storefront
screen exists. Changing the email invalidates all sessions; the customer signs
in again with the new email. The old address becomes available only after the
transaction commits.

## Address contract and persistence

The customer address table has an ID, `userId` foreign key, `label`,
`recipientName`, `phone`, `addressLine1`, optional `addressLine2`,
`subdistrict`, `district`, `province`, `postalCode`, fixed country `TH`,
`isDefaultShipping`, `isDefaultBilling`, and creation/update timestamps. Labels
and recipients are required; `addressLine1`, district hierarchy, and a
five-digit postal code are required. Phone is a 9- or 10-digit domestic number,
stored as digits. Text fields have explicit length limits and whitespace is
trimmed. The API validates the address shape but does not claim that a free-text
district/province combination matches an external postal reference dataset.
Each customer can store at most 20 addresses.

Endpoints are:

- `GET /api/v1/customer/addresses` lists the current customer's addresses in
  creation order.
- `POST /api/v1/customer/addresses` creates an address and returns it. The
  first address becomes both defaults.
- `PATCH /api/v1/customer/addresses/:id` updates address fields only, never
  ownership or default flags.
- `DELETE /api/v1/customer/addresses/:id` deletes one owned address.
- `PUT /api/v1/customer/addresses/:id/default` accepts
  `{ kind: 'shipping' | 'billing' }` and sets that type's default.

Every lookup includes `userId`; missing and other users' IDs both return
`404 ADDRESS_NOT_FOUND`. Address creation, deletion, and default changes lock
the owner user row and use one transaction. Partial unique indexes enforce at
most one shipping default and one billing default per user. Deleting a default
promotes the oldest remaining address for that type; an empty address list has
no default. Setting one type does not change the other. Address responses never
contain another user's records or internal auth fields.

## Errors, observability, and documentation

Application routes use the existing `{ code, message }` error envelope and
request IDs. Validation errors identify invalid fields without echoing
passwords, codes, or full addresses. Authentication and account-type failures
use the codes above. Additional stable codes are `INVALID_CURRENT_PASSWORD`,
`EMAIL_UNAVAILABLE`, `EMAIL_CHANGE_CODE_INVALID`,
`EMAIL_CHANGE_CODE_EXPIRED`, `ADDRESS_NOT_FOUND`, and `ADDRESS_LIMIT_REACHED`.
Rate limits return the existing rate-limit response and retry information.
Unexpected delivery or database failures are logged with sanitized categories
and return a safe server error.

Add OpenAPI tags and operation descriptions for new routes. Keep the exported
`App` type accurate for Eden Treaty. Update the API README with the new routes,
the email-change code flow, and the `_test` integration-test requirement.

## Verification

Unit tests cover field validation, customer-only authorization, code expiry,
attempt count and replacement, safe error responses, and address default
selection. PostgreSQL integration tests cover ownership isolation, concurrent
default changes, first-address behavior, deletion promotion, email conflicts
against customers and pending staff invitations, confirmation versus concurrent
identity creation, one-use codes, audit redaction, and session revocation.
Existing auth tests remain green, including signup, verification, password
recovery, role isolation, CSRF, and OpenAPI policy tests. Email delivery uses a
fake sender; tests never send real messages.

Run `bun --filter api test:unit`, `bun --filter api typecheck`, and
`bun --filter api lint`. Run `bun --filter api test:integration` only with a
dedicated `TEST_DATABASE_URL` whose PostgreSQL database name ends in `_test`;
the suite resets its schemas.
