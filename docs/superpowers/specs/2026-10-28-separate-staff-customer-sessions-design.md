# Separate staff and customer sessions — design

## Intent

Admin (`ADMIN_URL`) and the storefront (`STOREFRONT_URL`) both call one API host and one Better Auth instance at `/api/v1/auth`. Both get the same session cookie (`better-auth.session_token`, `__Secure-` prefixed in production) on the API host, so a browser holds one session at a time:

- Signing in to the storefront as a customer signs the staff member out of admin, and the reverse.
- A staff member who opens the storefront while signed in to admin gets `403 CUSTOMER_ACCOUNT_REQUIRED` from `GET /api/v1/store/cart`, and the cart shows "โหลดตะกร้าไม่ได้".

The owner wants the long-term fix: staff and customer sessions live side by side in one browser, so a staff member can work in admin and browse or buy on the storefront at the same time. This follows the Shopify model (staff identity and customer identity are separate) rather than the WooCommerce model (one account does both).

## Goals

1. One browser can hold a staff session (admin) and a customer session (storefront) at the same time. Signing in or out on one side never affects the other.
2. Store and customer routes never see a staff session; admin and staff routes never see a customer session. This is enforced by the API, not by the frontends.
3. A staff member browsing the storefront while signed in to admin is a guest there: they can browse, use the cart and check out as a guest, or sign in with their customer account.
4. Works the same in local development (`localhost:5183` / `localhost:5184` share cookies because cookies ignore ports) and in production.

## Non-goals

- **One email for both a staff account and a customer account.** Decided by the owner: accounts stay separate with different emails (for example `name+shop@gmail.com` for the customer account). `user.email` stays unique and identity claims stay as they are.
- Splitting the API onto separate hostnames per frontend.
- Staff placing orders on behalf of customers (draft orders) — a possible later feature.
- Changing MFA, session lifetime, or invitation policy. The only permission change is the new `staff:reset-password` capability.
- Self-service "forgot password" for staff.

## Anti-goals

- A staff session token being accepted on a store or customer route by any path (renamed cookie, copied token, header), or a customer token on an admin route.
- Logging customers out because of this change.
- Weakening the existing origin, CSRF, rate-limit, or Better Auth HTTP allowlist protections.

## Decided approach

Two Better Auth instances built from one shared configuration, over the same database tables (`user`, `session`, `account`, `verification`, `two_factor`, rate limit). No schema change.

| | Customer instance | Staff instance |
|---|---|---|
| Base path | `/api/v1/auth` (unchanged) | `/api/v1/staff-auth` |
| Cookie prefix | `better-auth` (unchanged, so customers stay signed in) | a distinct prefix, e.g. `suannn-staff` |
| Accounts it accepts | `accountType = 'customer'` only | `accountType = 'staff'` only |
| Trusted origins | `CORS_ORIGINS` (unchanged, shared) | `CORS_ORIGINS` (unchanged, shared) |
| Used by | storefront; `/api/v1/store/*`, `/api/v1/customer/*`, customer sign-up, cart, checkout, store orders, tracking consent | admin; `/api/v1/admin/*`, `/api/v1/staff/*`, `/api/v1/auth/staff/*` (MFA, self sessions, invitation acceptance), audit, system settings, CLIs |

### Account-type enforcement

Each instance rejects the other account type at two points, so a token is never usable on the wrong surface even if a cookie is copied or renamed:

1. **Session creation** (`databaseHooks.session.create.before`): the customer instance refuses to create a session for a staff user and the staff instance for a customer user. Sign-in with the wrong account type returns the same response as a wrong password (`401 INVALID_EMAIL_OR_PASSWORD`), consistent with how pending identity claims are already hidden. *(My call: no account-type enumeration on either sign-in page.)*
2. **Session read** (`customSession` / `getSession`): a session whose user is the other account type resolves as no session (the request is anonymous), not as an error.

Session read covers every session-protected endpoint of an instance, not only `get-session`: a copied staff token must not work on the customer instance's `change-password`, `sign-out`, `revoke-session` and similar routes (for example via a before-hook), and the reverse.

Trusted origins stay the full shared `CORS_ORIGINS` list on both instances, as today. *(My call: development and preview use several localhost origins and there are no new environment variables to assign them to a surface; separation comes from cookies and account type, and origin/CSRF checks are no weaker than today.)*

The two instances must not share rate-limit buckets: each instance uses its own keys in the shared rate-limit table. *(My call.)*

Staff accounts are verified at invitation acceptance, so the staff instance has no `send-verification-email` / `verify-email`. *(My call.)*

Existing staff sessions carry the old cookie name. After deploy the customer instance reads that cookie, sees a staff user, and treats the request as anonymous. Staff must sign in to admin again (and pass MFA). Customers are not affected.

### HTTP allowlist per instance

The current single allowlist (`src/plugins/auth/http-policy.ts`) splits by the endpoints each frontend actually uses today:

- **Customer:** `ok`, `get-session`, `sign-in/email`, `sign-out`, `verify-email`, `send-verification-email`, `request-password-reset`, `reset-password` (+ `GET /reset-password/:token`), `change-password`, `update-user`, `list-sessions`, `revoke-session`, `revoke-other-sessions`.
- **Staff:** `ok`, `get-session`, `sign-in/email`, `sign-out`, `revoke-sessions`, `two-factor/verify-totp`, `two-factor/verify-backup-code`, and `reset-password` (+ `GET /reset-password/:token`) for admin-issued reset links only. `request-password-reset` is **not** exposed over HTTP on the staff instance (see "Staff password reset").

`prepareAuthRequest` logic that is staff-specific (MFA bypass on sign-in, two-factor challenge checks, `MFA_ONBOARDING_REQUIRED`) runs only for the staff instance. The two-factor challenge cookie check must use the staff prefix instead of the hard-coded `better-auth.two_factor`. Rate-limit rules stay per instance with the same values.

### Staff password reset

Today staff reset a forgotten password through the storefront's `/forgot-password` page, because both surfaces share one Better Auth instance. After the split the customer instance refuses staff accounts, so that path closes. Decided by the owner: **a staff member who forgets their password can only get back in through an owner or admin.** There is no self-service "forgot password" for staff.

- **Customer instance:** `request-password-reset` for a staff email behaves exactly like an unknown email (same success response, no email sent), so the storefront page reveals nothing about staff accounts.
- **New admin action:** `POST /api/v1/staff/:id/password-reset` sends the target staff member a one-time reset link by email. The endpoint triggers the staff instance's reset server-side (`requestPasswordReset` through `staffAuth.api`, not over HTTP).
  - Permission: a new `staff:reset-password` capability, granted wherever the `staff` permission group is granted today (owner, admin).
  - Same rules as `POST /api/v1/staff/:id/mfa/reset`: cannot target yourself (`SELF_PASSWORD_RESET`), only an owner can target an owner (`OWNER_REQUIRED`), unknown target is 404, `browserMutation: 'admin'`, application rate limit, and an audit record (`staff.password-reset-requested`).
  - Admin staff list/detail gets a "ส่งลิงก์ตั้งรหัสผ่านใหม่" action next to the existing MFA reset, with a confirmation dialog.
- **Reset link and page:** the email links to a new admin page (for example `/reset-password/:token`) that sets the new password through the staff instance's `reset-password`. Token lifetime stays one hour. On success every session of that staff member is revoked (`revokeSessionsOnPasswordReset` is already on) and the page sends them to `/login`. MFA is unchanged by a password reset.
- The staff reset email uses its own wording (sent by an administrator, link to admin), not the customer template.
- **Owner who forgets their own password** *(my call)*: a server CLI, `src/cli/recover-owner-password.ts`, alongside `recover-owner-mfa.ts`, that sends the owner a reset link to the same admin page. Run from the `api` container like `bootstrap-owner`.

### Wiring

- `createAuth` takes a surface (`'customer' | 'staff'`) and returns an instance configured as in the table. `index.ts` builds both; `AppDependencies` carries both (e.g. `customerAuth`, `staffAuth`) instead of `auth`.
- Each route module receives only the instance for its surface. Services that call Better Auth server APIs get the matching instance: `CustomerSignupService` → customer; `StaffInvitationService` (`createUser`, `signInEmail`) and `StaffMfaService` → staff.
- `createAuthPlugin` mounts each instance's catch-all handler at its base path. The staff catch-all must not swallow the existing Elysia routes under `/api/v1/auth/staff/*` (those stay where they are; the new base path avoids the overlap).
- Auth macros (`auth`, `verifiedCustomer`, `customerAuth`, `staffAuth`, `permission`) bind to the right instance: customer macros to the customer instance, staff macros to the staff instance.
- `resolveCartPrincipal`, checkout, store orders and consent use the customer instance. A staff cookie is invisible to them, so the `CUSTOMER_ACCOUNT_REQUIRED` path for staff no longer occurs from a normal browser; keep the check as defence in depth.
- OpenAPI documents both instances' paths.
- `bootstrap-owner` and `recover-owner-mfa` CLIs use the staff instance. `auth:generate` keeps generating the one shared schema.

### Frontends

- **Admin:** the hand-written auth client (`apps/admin/src/lib/auth-client.ts`) points at `/api/v1/staff-auth/`. New: the reset-password page and the "send reset link" staff action described above. The `customer` branch in `auth-gate.tsx` ("Use a staff account to sign in.") can no longer trigger from a session; a customer signing in to admin gets the normal wrong-credentials error.
- **Storefront:** the auth client stays at `/api/v1/auth/`. Staff-session handling becomes dead code and is removed: the "ไปหน้าผู้ดูแล" header link (`pages/layout.tsx`), the `staff` state in `customer-guard.tsx` and `auth-session.ts`, `staffFlow` in `sign-in-page.tsx`, and `staffSignInUrl`. Session types narrow to customer only.

## Verification the builder must show

- API unit tests: each instance rejects the other account type on sign-in (401 generic) and on session read (anonymous); a staff cookie on `GET /api/v1/store/cart` returns a guest cart; a customer cookie on an admin route returns 401; allowlists per instance; two-factor challenge with the staff prefix.
- An integration test that signs in a staff user and a customer user in one cookie jar and uses admin and store routes in alternation without either session being dropped.
- Staff password reset: permission, self/owner rules, audit record, rate limit; storefront `request-password-reset` with a staff email sends nothing; the admin reset page sets the password and revokes sessions; the CLI sends a link to the owner.
- Existing route tests updated to build the app with both instances (fakes in `test/helpers/fakes.ts`).
- Admin and storefront tests, lint and builds pass; `bun run check` passes.
- Manual check on staging: one browser, admin and storefront both signed in, cart works on the storefront.

## Deployment

- No migration and no new environment variables. The new `staff:reset-password` capability is code-only (role permissions are defined in `access-control.ts`).
- Staff can no longer reset their password from the storefront; tell staff to ask an owner or admin.
- On deploy, every staff member is signed out once and signs in again with MFA. Customers stay signed in.
- Deploy API and both frontends together (one Dokploy deploy already does this). An old admin bundle talking to the new API would hit the customer instance and fail sign-in until the page reloads.
- Update `apps/api/README.md` (auth section and endpoint tables) and the OpenAPI description.

## Left to the builder

- The exact staff cookie prefix string and how `createAuth` is parameterised.
- Whether the account-type check on session read lives in `customSession`, a wrapper around `getSession`, or both, as long as the wrong type never yields a session.
- How macros are split (one factory per surface or one factory taking both instances).
