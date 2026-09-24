# Admin Authentication Integration Design

**Date:** 2026-09-24

**Status:** Awaiting written-spec review

**Scope:** Connect `apps/admin` to the existing `apps/api` staff authentication routes.

## Purpose and success criteria

Staff should be able to follow an emailed invitation into the admin app, create
their account, enroll an authenticator, save backup codes, and enter protected
admin pages. Returning staff should sign in with email and password and complete
a TOTP or backup-code challenge. The admin app must respond to logout, session
expiry, revocation, and loss of staff access. Password recovery and staff
management screens are outside this integration.

Success means a customer session never opens the admin route tree, a limited
staff onboarding session cannot open it before MFA enrollment, and an active
staff session can resume after a page reload without repeating login. The API
remains the authority for session validity and permissions.

## Existing context

`apps/api` already has Better Auth email/password sign-in, TOTP and backup-code
challenge routes, a staff invitation acceptance route, staff MFA enrollment
routes, an explicit session projection, and sign-out. The invitation email links
to `/staff/invitations/accept?token=...` on the configured admin origin.

`apps/admin` has a visual login form, an Eden Treaty API client, TanStack Query,
React Router, and an unprotected admin layout. The login form currently has no
submit behavior. The sidebar displays placeholder account details. The API
client currently requests only health status.

The supplied `docs/openapi.json` documents the current endpoints. Application
routes are typed through the exported `App` type. Better Auth's catch-all HTTP
routes are documented in OpenAPI but are not represented as application-owned
Eden route methods.

## Architecture and ownership

Add a focused auth adapter in `apps/admin/src/lib/`. It uses Eden Treaty for
application-owned staff invitation and MFA enrollment routes, and credentialed
HTTP requests for Better Auth's sign-in, TOTP challenge, backup-code challenge,
session, and sign-out routes. The adapter normalizes successful results and
safe server error messages into UI-facing outcomes. It does not duplicate
permission rules or trust a client-side role assertion.

Use one TanStack Query entry for the current session. The server's
`get-session` projection is the source of truth. A session with a `staff`
projection is active; a staff identity without that projection is an onboarding
candidate; null, expired, or customer sessions cannot enter protected pages.
When a limited staff session is found, the app confirms its state through
`GET /api/v1/auth/staff/onboarding` before routing to MFA setup. The query
is invalidated after every auth transition and on relevant unauthorized API
responses. No credential, invitation token, TOTP secret, backup code, or
session token is persisted in local storage.

Credentialed requests use the configured `VITE_API_URL` and browser cookies.
The API's exact-origin CORS and browser mutation checks remain in force. The
client sends JSON for mutation routes. Existing production origin settings must
include the admin origin; this design does not relax CORS or CSRF rules.

## Screens and route behavior

- `/login` accepts email and password. The sign-in response determines whether
  the next step is an MFA challenge or a session check. A successful active
  staff session goes to the intended protected route, or `/dashboard`.
- `/staff/invitations/accept?token=...` accepts name and a new password. It
  submits the token to the existing invitation endpoint, then routes to MFA
  setup. The token is removed from the address bar after the page reads it.
- `/staff/onboarding` lets a limited staff member confirm their password,
  displays the authenticator setup URI in usable form, displays the issued
  backup codes with a clear save step, and verifies a TOTP code. It does not
  open the admin layout until the returned session is active.
- `/login/mfa` accepts either a TOTP code or a backup code for the short-lived
  sign-in challenge. It never requests trusted-device bypass. If the challenge
  is missing or expired, it returns to login with an explanation.
- Protected admin routes wait for the session query before rendering. They
  redirect signed-out visitors to login, customer sessions away from admin
  content, and limited staff sessions to onboarding. A valid staff session can
  open a deep link after a reload.
- The admin sidebar shows the current staff name and email and provides
  sign-out. Signing out clears cached private data and returns to login.

Any stored return destination is an internal app path. It is validated before
navigation so an auth route cannot become an external redirect. The UI may
hide actions based on returned permissions, but the API still authorizes every
protected operation.

## Session and error handling

The route gate distinguishes loading, active staff, onboarding staff, and
unauthenticated states. It does not render protected content during an initial
session check. A failed session request caused by a transient network or server
error shows a retry state instead of treating the user as signed out.

Invalid login credentials and invalid TOTP or backup codes remain on their
forms with safe messages. An expired or revoked invitation explains that a new
invitation is needed. API rate-limit responses display a retry message. A
session-expired response clears cached staff state and routes to login; a
permission-denied response keeps the session but shows an access message for
the affected action. The app never exposes raw exception text, credentials,
codes, or tokens in a toast or log.

Server-side staff idle and absolute timeouts remain unchanged. The app does not
extend a session locally. It rechecks the server projection after auth
transitions, on protected route entry, and when the browser regains focus. A
protected API response that reports an invalid session triggers the same
session refresh and redirect behavior.

## API contract considerations

The implementation should first use the current API contract. The client must
recognize Better Auth's MFA challenge response and use the two challenge
endpoints already allowed by the API HTTP policy. It must not call raw Better
Auth enrollment, backup-code generation, or Admin plugin HTTP endpoints.

If an existing response is insufficient to distinguish active, onboarding, and
challenge states reliably, make the smallest API contract adjustment needed,
update the exported `App` type and OpenAPI documentation, and keep the current
server authorization guarantees. No new auth subsystem or parallel session
store is part of this work.

## Validation

Cover the main state transitions: invitation acceptance to enrollment, MFA
enrollment to active staff, returning-staff login to MFA challenge, TOTP and
backup-code completion, protected route entry, customer-session rejection,
logout, challenge expiry, invitation expiry, and session revocation or expiry.
Check that protected content does not flash before the initial session result
and that transient API failure leaves a retry path. Check that the invitation
token is removed from the URL and that no auth secret is persisted in browser
storage.

Run `bun --filter admin build` and `bun --filter admin lint`. If `apps/api`
changes, run its typecheck, lint, and relevant authentication tests. Do not run
database integration tests without a dedicated `TEST_DATABASE_URL` ending in
`_test`.
