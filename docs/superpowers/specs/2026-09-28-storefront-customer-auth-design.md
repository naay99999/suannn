# Storefront customer authentication and account design

## Intent and scope

Customers can register, sign in, and use their real account data in the storefront. An anonymous visitor can continue browsing and using checkout. Only `/account` and its descendants require a customer session. The storefront must never treat its current account demo data as customer data.

This work covers `/sign-in`, `/sign-up`, the supporting password recovery and email verification screens needed by their flows, and the existing account pages. It uses the customer and Better Auth endpoints already exposed by `apps/api`. API changes are limited to gaps found during implementation; authorization remains enforced by the API.

The existing uncommitted storefront and shared UI changes are user work and must be preserved. The implementation should adapt to that current state without resetting or overwriting unrelated edits.

## Authentication architecture

Add a storefront auth client for the Better Auth routes under `/api/v1/auth/`. It sends `credentials: 'include'`, parses success and error responses, and returns a validated customer session or `null`. Use Eden Treaty for typed customer, store order, and customer registration endpoints, also with credentials. Do not store session tokens in browser storage.

TanStack Query owns the current session and account server state. A guard in the `/account` route renders a pending state while checking the session. Anonymous visitors go to `/sign-in` with an internal return path. Staff sessions are not customer sessions and cannot enter `/account`. Failed session requests show a retry state; they do not redirect as if the visitor were anonymous. The API still checks authorization on every protected request. A 401 from account data invalidates the session and moves the visitor to sign-in. A 403 displays the relevant account or verification restriction.

After successful sign-in, refresh the session before navigation. Allow only same-origin relative return paths under `/account`; otherwise go to `/account`. Authenticated customers visiting `/sign-in` or `/sign-up` go to `/account`. Sign-out calls the API, removes customer data from Query cache, and navigates outside the protected route.

## Registration and sign-in

`/sign-up` submits name, email, and password to `POST /api/v1/auth/sign-up`. Validate in the browser with React Hook Form and Zod: trimmed name of 1–100 characters, valid email within the API limit, password of 12–256 characters, and matching confirmation. The confirmation field is never sent to the API. On `{ accepted: true, next: 'sign-in' }`, display a neutral message that does not claim an account was created, then link to sign-in. The API intentionally returns the same accepted result for existing or reserved addresses and rate-limited attempts; the UI must preserve that privacy behavior.

`/sign-in` sends email and password to `POST /api/v1/auth/sign-in/email`, refreshes `/get-session`, and proceeds only for a customer session. Invalid credentials use a generic message. A staff or MFA challenge result cannot enter customer account pages and receives a clear path to the staff sign-in experience. Form controls have labels, autocomplete values, invalid state, and adjacent error text. Submission prevents duplicate requests.

The sign-in page links to `/forgot-password`. A recovery request uses `POST /api/v1/auth/request-password-reset` with `/reset-password` as the requested return destination and shows a neutral response. `/reset-password` receives the reset token, submits `POST /api/v1/auth/reset-password`, and returns to sign-in on success. The API handles its verification link. The storefront reads the real `emailVerified` state after the customer returns and offers `POST /api/v1/auth/send-verification-email` from the account area. If the existing API cannot produce the specified reset destination, make the smallest API change needed to do so.

## Real account pages

Replace the account demo context and fixtures in rendered account pages with API queries and mutations. Keep page structure where it still fits the real data and provide explicit loading, empty, error, and retry states.

- Overview: current name and email verification state, latest customer order from `GET /api/v1/store/orders`, and default shipping address from `GET /api/v1/customer/addresses`.
- Profile: current values from `GET /api/v1/customer/profile`; edit the name with `PATCH /api/v1/customer/profile`. Do not offer an editable phone field because the profile API has no phone field. Email changes use the existing request and eight-digit confirmation flow under `/api/v1/customer/email-change`; success revokes sessions and returns the customer to sign-in.
- Addresses: list, create, edit, delete, and set shipping or billing defaults with the existing `/api/v1/customer/addresses` routes. The form follows API validation, including Thai phone and postal code rules. Mutations invalidate the address and overview queries.
- Orders: show the authenticated customer's paginated orders from `GET /api/v1/store/orders`, with a load-more button when `nextCursor` exists, correct status and satang-to-baht formatting, and an empty state. Order details use `GET /api/v1/store/orders/:orderId` and show a not-found state for an inaccessible or unknown order. Do not display guest orders as account orders.
- Security: show verification state, resend verification email, change password, list active sessions, revoke a session or other sessions, and sign out using the already allowed Better Auth routes. Password and session actions show success and recoverable error feedback. The storefront does not expose staff MFA controls.

Session-aware navigation reflects the actual customer state. The account link can lead to the guarded area; account pages include a sign-out control. Any stale account data is removed when the identity changes or the session ends.

## Visual and interaction design

Use the existing suannn design tokens, Satoshi and Thai font stack, shared shadcn components, and Hugeicons. The authentication pages use a premium editorial composition with an immediately visible form, short heading, and garden imagery. On narrow screens the form appears before supporting visual material. Maintain a clear navigation, attention, interest, desire, and action progression without making the authentication task depend on scrolling. Apply `gpt-taste`'s design preflight before UI code, including deterministic layout selection, heading width, grid density, contrast, and label review.

Use GSAP for decorative imagery and story sections only. Respect reduced motion, keep focus and form error messages stable, and avoid animation that delays input or navigation. Images and clickable visual areas respond to hover where appropriate. Do not introduce a second icon set, raw colors where tokens suffice, or decorative labels that look like section numbers.

## Data and error handling

The client sends cookies with authenticated requests. It distinguishes network/server errors from an anonymous session, maps validation errors to fields where possible, and handles 401, 403, 404, 409, 422, and 429 without exposing account enumeration details. Retry controls are available for failed queries. Mutation success invalidates only affected query keys. The server remains the source of truth for session, permissions, orders, and verification state.

The API's current `requireEmailVerification: false` permits customer sign-in before verification. The UI may show verification prompts but must not invent a stricter client-only sign-in rule. Operations that the API limits to verified customers show the server restriction and a way to request verification.

## Validation

Add focused tests for form validation, registration privacy response, safe return navigation, anonymous/staff/expired-session guard behavior, session refresh and sign-out cache removal, and account data transformations that carry a correctness risk. Use existing API tests to confirm any API changes. Run storefront build and lint; run API unit tests and typecheck if API code changes. Run PostgreSQL integration tests only with a configured `TEST_DATABASE_URL` ending in `_test`. Check keyboard use, labels, small screens, contrast, and reduced-motion behavior for the authentication pages.

## Boundaries

Checkout remains available to guests. Admin authentication is not changed. This work does not add social sign-in, new account roles, new database tables, or a new token store. Existing account demo files can be removed only after all rendered account pages use real API data.
