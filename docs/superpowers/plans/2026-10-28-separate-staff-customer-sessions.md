# Separate Staff and Customer Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run two Better Auth instances (customer and staff) over the same tables, with distinct base paths and cookie prefixes, so one browser can be signed in to admin and the storefront at once, and add an admin-issued staff password reset.

**Architecture:** `createAuth` gains a `surface` argument and returns an instance of the same `Auth` type for either surface. Each instance hides sessions of the other account type at the adapter level (`findOne` on `session` joined with `user`), so every session-protected endpoint and `getSession` treats them as absent. `app.ts` passes the customer instance to store/customer modules and the staff instance to admin/staff modules; module signatures do not change.

**Tech Stack:** Bun, Elysia, Better Auth 1.7.5 (drizzle adapter, admin, twoFactor, customSession plugins), Drizzle/PostgreSQL, React 19 + TanStack Query, bun test.

**Spec:** `docs/superpowers/specs/2026-10-28-separate-staff-customer-sessions-design.md`

## Global Constraints

- Customer instance: base path `/api/v1/auth`, cookie prefix `better-auth` (unchanged, customers stay signed in).
- Staff instance: base path `/api/v1/staff-auth`, cookie prefix `suannn-staff`.
- Both instances: same secret, same `trustedOrigins` (`config.corsOrigins`), same plugins, same schema. No migration, no new environment variables.
- Wrong-account-type sign-in returns `401 { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' }`.
- Customer `request-password-reset` for a staff email returns Better Auth's normal success body (`{ status: true, message: 'If this email exists in our system, check your email for the reset link' }`) and sends nothing.
- Staff `request-password-reset` is never reachable over HTTP; staff reset links come only from `POST /api/v1/staff/:id/password-reset` or the owner CLI.
- New capability `staff:reset-password`; audit action `staff.password-reset-requested`; error `SELF_PASSWORD_RESET` (403).
- Reset link redirect: `${ADMIN_URL}/reset-password`. Token lifetime 1 hour (unchanged).
- Code style: two spaces, single quotes, no semicolons. Run `typecheck`, `lint`, and relevant tests for every changed package.
- Integration tests: one file at a time, `--parallel=1`, `TEST_DATABASE_URL` ending in `_test`.

## Review Focus

1. A browser still holding the pre-deploy `better-auth.session_token` of a **staff** user calls store routes → treated as a guest (200 guest cart), never 401/500. Test in Task 1 and Task 3.
2. A staff session token copied into the customer cookie name and sent to `POST /api/v1/auth/change-password` or `/revoke-session` → 401, no change. Test in Task 1.
3. Staff sign-in with TOTP enabled: the two-factor challenge cookie is `suannn-staff.two_factor` (`__Secure-suannn-staff.two_factor` in production) and the verify-totp guard accepts both. Test in Task 2.
4. Invitation acceptance returns `Set-Cookie: suannn-staff.session_token=…`, not the customer cookie. Test in Task 3.
5. An expired or reused reset link lands on the admin page with `?error=INVALID_TOKEN` and shows a message plus "ask an administrator", not a blank form. Test in Task 5.

---

### Task 1: Surface-aware `createAuth`

**Files:**
- Modify: `apps/api/src/plugins/auth/auth.ts`
- Modify: `apps/api/src/modules/email/templates.ts` (add `staffResetPasswordEmail`)
- Test: `apps/api/test/unit/auth-config.test.ts`, Create: `apps/api/test/integration/auth-surfaces.test.ts`

**Interfaces:**
- Produces:
  - `export type AuthSurface = 'customer' | 'staff'`
  - `export const authSurfaces: Record<AuthSurface, { basePath: string; cookiePrefix: string }>` with the values from Global Constraints.
  - `createAuth(config, db, dependencies?, surface: AuthSurface = 'customer'): Auth` — `Auth` type unchanged.
  - `AuthDependencies.rateLimitStorage?: BetterAuthRateLimitStorage` (used by the staff instance; see Task 3).
  - `staffResetPasswordEmail(url: string): EmailContent` — Thai/English copy saying an administrator requested the reset, link valid 1 hour.

- [ ] **Step 1: Write failing unit tests** in `auth-config.test.ts`: `createAuth(..., 'staff').options.basePath === '/api/v1/staff-auth'` and `.options.advanced.cookiePrefix === 'suannn-staff'`; customer instance keeps `/api/v1/auth` and `better-auth`.
- [ ] **Step 2: Write failing integration tests** in `auth-surfaces.test.ts` using real instances over the test DB (create one verified customer and one active staff user via the existing helpers in `test/helpers/database.ts`):
  - `customer instance hides staff sessions`: sign in staff on the staff instance, copy the token into a `better-auth.session_token` cookie, `customerAuth.api.getSession` → `null`.
  - `staff instance hides customer sessions`: mirror case → `null`.
  - `copied staff token cannot change password on customer instance`: `POST /api/v1/auth/change-password` via `customerAuth.handler` with the copied cookie → 401, password unchanged.
  - `session creation is refused for the wrong account type`: `customerAuth.api.signInEmail` with staff credentials throws; no session row created.
  - `staff reset email uses the staff template`: `staffAuth.api.requestPasswordReset` → `emailSender.send` called with `template: 'staff-reset-password'`.
- [ ] **Step 3: Run tests, verify they fail.** `cd apps/api && bun test test/unit/auth-config.test.ts` and `TEST_DATABASE_URL=… bun test --parallel=1 test/integration/auth-surfaces.test.ts` — FAIL.
- [ ] **Step 4: Implement in `auth.ts`.**
  - `basePath` and `advanced.cookiePrefix` from `authSurfaces[surface]`.
  - In the existing adapter wrapper's `findOne`: when `input.model === 'session'` and the result carries a joined `user`, return `null` if `user.accountType !== surface`. Keep the existing MFA-bypass logic for `model === 'user'`. Verify (and test) that transactions go through the wrapper too; if Better Auth uses a transactional adapter that bypasses `findOne`, wrap `transaction` the same way.
  - In `databaseHooks.session.create.before`: throw `APIError('UNAUTHORIZED', { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' })` when the account type does not match `surface`, before the existing customer/staff branches.
  - `sendResetPassword` uses `staffResetPasswordEmail` and template name `'staff-reset-password'` when `surface === 'staff'`.
  - `rateLimit.customStorage = dependencies.rateLimitStorage` when provided.
- [ ] **Step 5: Run tests, verify they pass** (same commands). Also `bun --filter api typecheck`.
- [ ] **Step 6: Commit** — `git commit -m "Add customer and staff Better Auth surfaces"`

### Task 2: Per-surface HTTP policy and plugin

**Files:**
- Modify: `apps/api/src/plugins/auth/http-policy.ts`, `apps/api/src/plugins/auth/index.ts`
- Test: `apps/api/test/unit/auth-http-policy.test.ts`

**Interfaces:**
- Consumes: `AuthSurface`, `authSurfaces` (Task 1).
- Produces:
  - `authRelativePath(request: Request, surface: AuthSurface): string | null`
  - `isAllowedAuthRequest(request: Request, surface: AuthSurface): boolean`
  - `createAuthPlugin(auth: Auth, surface: AuthSurface, dependencies?: AuthHttpDependencies)` — mounts `.all(\`${authSurfaces[surface].basePath}/*\`)`; plugin `name` must differ per surface (`better-auth-customer` / `better-auth-staff`) so Elysia does not dedupe them.
  - `createAuthMacros(auth)` unchanged (bound per module by the instance it receives).

- [ ] **Step 1: Write failing tests** in `auth-http-policy.test.ts`:
  - Customer allowlist exactly: `GET /ok`, `GET /get-session`, `POST /sign-in/email`, `POST /sign-out`, `GET /verify-email`, `POST /send-verification-email`, `POST /request-password-reset`, `POST /reset-password`, `GET /reset-password/:token`, `POST /change-password`, `POST /update-user`, `GET /list-sessions`, `POST /revoke-session`, `POST /revoke-other-sessions`. `POST /two-factor/verify-totp` → not allowed.
  - Staff allowlist exactly: `GET /ok`, `GET /get-session`, `POST /sign-in/email`, `POST /sign-out`, `POST /revoke-sessions`, `POST /two-factor/verify-totp`, `POST /two-factor/verify-backup-code`, `POST /reset-password`, `GET /reset-password/:token`. `POST /request-password-reset` and `POST /send-verification-email` → not allowed.
  - Paths under `/api/v1/auth/staff/...` are **not** staff-surface auth paths (`authRelativePath(req, 'staff') === null`).
  - Plugin: customer sign-in whose `identityReservations.findState` returns `'staff'` → 401 `INVALID_EMAIL_OR_PASSWORD` without calling `auth.handler`; staff sign-in with state `'customer'` → same.
  - Plugin: customer `request-password-reset` with a staff email → 200 with the exact success body, `auth.handler` not called.
  - Plugin: staff `verify-totp` with cookie `suannn-staff.two_factor=x` and with `__Secure-suannn-staff.two_factor=x` passes the challenge guard; with only `better-auth.two_factor=x` → 400 `INVALID_TWO_FACTOR_CHALLENGE`.
  - Plugin: MFA bypass and `MFA_ONBOARDING_REQUIRED` checks run only for the staff surface.
- [ ] **Step 2: Run** `cd apps/api && bun test test/unit/auth-http-policy.test.ts` — FAIL.
- [ ] **Step 3: Implement.** Allowlists as two sets keyed by surface. In `prepareAuthRequest(auth, surface, request, deps)`: wrong-type check uses `findState` (`'customer'`/`'staff'`) on sign-in; staff-email reset short-circuit only on customer surface; two-factor cookie regex built from `authSurfaces.staff.cookiePrefix` with optional `__Secure-`; staff-only branches gated on `surface === 'staff'`.
- [ ] **Step 4: Run** the same test — PASS; `bun --filter api typecheck`.
- [ ] **Step 5: Commit** — `git commit -m "Split Better Auth HTTP policy by surface"`

### Task 3: Wire both instances through the app

**Files:**
- Modify: `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/plugins/openapi.ts` (if auth paths are prefixed there), `apps/api/src/cli/bootstrap-owner.ts`, `apps/api/src/cli/recover-owner-mfa.ts`
- Create: `apps/api/src/modules/rate-limit/better-auth-storage.ts`
- Modify tests that build the app: every `createApp(` caller under `apps/api/test/` (17 files) and `test/helpers/fakes.ts`
- Test: Create `apps/api/test/integration/auth-dual-session.test.ts`
- Docs: `apps/api/README.md` (auth section, endpoint tables, cookie names), `docs/deployment.md` (staff re-login note)

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces:
  - `AppDependencies.customerAuth: Auth` and `AppDependencies.staffAuth: Auth` (replace `auth`).
  - `createBetterAuthRateLimitStorage(repository: ApplicationRateLimitRepository, namespace: string): BetterAuthRateLimitStorage` — `consume(key, rule)` hashes `${namespace}:${key}`, uses `rule.window` seconds and `rule.max`, returns `{ allowed, retryAfter }`.

Module assignment in `app.ts`:
- `customerAuth`: `createAuthPlugin(customerAuth, 'customer', …)`, customer profile/addresses/email-change/account-deletion, store consent, store cart, store cart discount, store checkout, store orders.
- `staffAuth`: `createAuthPlugin(staffAuth, 'staff', …)`, staff invitations, staff MFA, staff sessions, staff admin, audit, system settings, every `createAdmin*Module`.
- Services: `CustomerSignupService({ auth: customerAuth })`, `StaffInvitationService({ auth: staffAuth })`, `StaffMfaService({ auth: staffAuth })`. CLIs build `createAuth(..., 'staff')`.
- OpenAPI: document both instances' paths (`generateOpenAPISchema` on each, staff paths under `/api/v1/staff-auth`); the `sessionCookie` security scheme lists both cookie names.

- [ ] **Step 1: Write failing integration test** `auth-dual-session.test.ts` with `createApp` over the test DB and one shared cookie jar:
  - sign in staff via `POST /api/v1/staff-auth/sign-in/email` (MFA off via system setting), sign in customer via `POST /api/v1/auth/sign-in/email`; then alternately `GET /api/v1/admin/products` → 200, `GET /api/v1/customer/profile` → 200, `GET /api/v1/staff-auth/get-session` → staff, `GET /api/v1/auth/get-session` → customer; sign out customer → staff still 200 on admin.
  - staff cookie only: `GET /api/v1/store/cart` → 200 empty guest cart; `PUT /api/v1/store/cart/items/:variantId` succeeds as guest.
  - legacy staff `better-auth.session_token` only: `GET /api/v1/store/cart` → 200 guest; `GET /api/v1/admin/products` → 401.
  - customer cookie only: `GET /api/v1/admin/products` → 401.
  - invitation acceptance response sets `suannn-staff.session_token`.
- [ ] **Step 2: Run** it — FAIL.
- [ ] **Step 3: Implement** wiring, rate-limit storage (staff instance gets `rateLimitStorage: createBetterAuthRateLimitStorage(rateLimitRepository, 'staff-auth')`), CLIs, OpenAPI, then update every test that builds the app to pass `customerAuth` and `staffAuth` (fakes may pass the same fake object for both).
- [ ] **Step 4: Run** `bun --filter api typecheck`, `bun --filter api lint`, `bun --filter api test:unit`, then the new integration file and `customer-auth`, `staff-invitations`, `staff-mfa-policy`, `commerce-app-flow`, `cart` integration files one by one — all PASS.
- [ ] **Step 5: Update README and deployment docs** (cookie names, base paths, "staff sign in again once after this deploy; customers unaffected", staff reset only via admin).
- [ ] **Step 6: Commit** — `git commit -m "Serve staff and customers from separate auth instances"`

### Task 4: Admin-issued staff password reset (API + CLI)

**Files:**
- Modify: `apps/api/src/plugins/auth/access-control.ts` (`staff` gains `'reset-password'`), `apps/api/src/shared/domain-error.ts` (`SELF_PASSWORD_RESET: { status: 403, message: 'Cannot reset your own password' }`), `apps/api/src/modules/auth/staff/{repository,service,index}.ts`, `apps/api/src/index.ts`
- Create: `apps/api/src/cli/recover-owner-password.ts`, `apps/api/package.json` script `auth:recover-owner-password`
- Test: `apps/api/test/unit/staff-routes.test.ts` (or the existing staff unit test file), `apps/api/test/integration/staff-admin.test.ts`

**Interfaces:**
- Produces:
  - `StaffRepository.recordPasswordResetRequest(actor: StaffActor, targetUserId: string): Promise<{ email: string }>` — in one transaction: lock target role, apply `assertActorMayTarget`, audit `staff.password-reset-requested`, return the target email.
  - `new StaffService(repository, sendPasswordReset: (email: string) => Promise<void>)`
  - `StaffService.requestPasswordReset(actor: StaffActor, targetUserId: string): Promise<void>` — `SELF_PASSWORD_RESET` if self, then repository, then `sendPasswordReset(email)`.
  - Route `POST /api/v1/staff/:id/password-reset`: `permission: { staff: ['reset-password'] }`, `browserMutation: 'admin'`, `applicationRateLimit: { namespace: 'staff-password-reset', limit: 5, windowSeconds: 300 }`, responses as `/:id/mfa/reset`, OpenAPI summary "Send staff password reset link".
  - `index.ts`: `sendPasswordReset = (email) => staffAuth.api.requestPasswordReset({ body: { email, redirectTo: new URL('/reset-password', config.adminUrl).toString() } }).then(() => undefined)`.
  - CLI `bun src/cli/recover-owner-password.ts <owner-email>`: refuses unless the user is an active owner, records audit (actor null, same action), sends the link.

- [ ] **Step 1: Write failing tests:** route returns 403 for a role without `staff:reset-password`; 403 `SELF_PASSWORD_RESET` on self; 403 `OWNER_REQUIRED` when admin targets owner; 404 unknown; 200 calls `sendPasswordReset` with the target email; integration: audit row `staff.password-reset-requested` exists and the reset link (captured from the fake email sender) lets the staff user set a new password through `POST /api/v1/staff-auth/reset-password`, after which their old sessions are gone and the new password signs in.
- [ ] **Step 2: Run** them — FAIL.
- [ ] **Step 3: Implement** per Interfaces.
- [ ] **Step 4: Run** unit + `staff-admin` integration — PASS; typecheck, lint.
- [ ] **Step 5: Document** the endpoint and CLI in `apps/api/README.md`.
- [ ] **Step 6: Commit** — `git commit -m "Let owners and admins send staff password reset links"`

### Task 5: Admin frontend

**Files:**
- Modify: `apps/admin/src/lib/auth-client.ts` (base `/api/v1/staff-auth/`; add `resetPassword(token: string, newPassword: string): Promise<void>` posting `{ token, newPassword }` to `reset-password`)
- Modify: `apps/admin/src/router.tsx` (public route `reset-password`)
- Create: `apps/admin/src/pages/auth/reset-password-page.tsx` (or beside the existing login page — follow where `login` lives)
- Modify: `apps/admin/src/pages/settings/_components/staff-management-api.ts` (`sendStaffPasswordReset(id: string)` → `api.staff({ id })['password-reset'].post({})`), `staff-management.tsx` (action "ส่งลิงก์ตั้งรหัสผ่านใหม่" beside MFA reset, confirmation dialog, shown only with `staff:reset-password`, hidden for self)
- Test: `apps/admin/test/auth-client.test.ts`, `apps/admin/test/staff-management-view.test.tsx`, Create `apps/admin/test/reset-password-page.test.tsx`

- [ ] **Step 1: Write failing tests:**
  - auth client calls `…/api/v1/staff-auth/get-session` and `…/staff-auth/sign-in/email`.
  - reset page with `?token=abc`: password + confirm fields (min 12 chars, must match), submit calls `resetPassword('abc', pw)`, success navigates to `/login` with a success notice.
  - reset page with `?error=INVALID_TOKEN` or no token: shows "ลิงก์หมดอายุหรือใช้ไปแล้ว กรุณาขอลิงก์ใหม่จากผู้ดูแล" and no form.
  - staff management: action visible for another staff member when permitted; hidden for self and without permission; confirming calls `sendStaffPasswordReset(id)` and shows a sent notice.
- [ ] **Step 2: Run** `bun --filter admin test` — new tests FAIL.
- [ ] **Step 3: Implement** with existing shared components (`Field`, `FieldGroup`, `AlertDialog`, `Button`), matching the login page layout.
- [ ] **Step 4: Run** `bun --filter admin test`, `bun --filter admin lint`, `bun --filter admin build` — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Add staff reset-password page and admin reset action"`

### Task 6: Storefront cleanup

**Files:**
- Modify: `apps/storefront/src/lib/auth-client.ts` (session type customer-only; a `staff` account type in a response is treated as signed out), `lib/auth-session.ts` (`CustomerAuthState = 'anonymous' | 'customer'`), `lib/auth-navigation.ts` (remove `staffSignInUrl`), `pages/layout.tsx` (remove staff header link), `pages/auth/customer-guard.tsx` (remove staff state), `pages/auth/sign-in-page.tsx` (remove `staffFlow`), `components/cart/cart-provider.tsx` (customer check simplifies)
- Test: update `apps/storefront/tests/{auth-client,auth-session,auth-navigation,auth-pages,header}.test.*`

- [ ] **Step 1: Update tests** to the customer-only behaviour (remove staff-link expectations; add: a get-session response with `accountType: 'staff'` yields signed-out state).
- [ ] **Step 2: Run** `bun --filter storefront test` — updated tests FAIL.
- [ ] **Step 3: Remove** the staff code paths listed above.
- [ ] **Step 4: Run** `bun --filter storefront test`, `lint`, `build` — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Drop staff session handling from the storefront"`

### Task 7: Full check

- [ ] **Step 1:** `bun run check` from the repo root (with `TEST_DATABASE_URL` set) — PASS.
- [ ] **Step 2:** Manual: `bun run dev`, sign in to admin (5184) and storefront (5183) in one browser, add to cart, sign out of one, confirm the other stays signed in; send a staff reset link and complete it from the dev email log.
