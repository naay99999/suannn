# Storefront Customer Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Customers can register, sign in, and use real account data behind a customer-only `/account/*` guard.

**Architecture:** A small fetch client handles Better Auth routes with cookies; Eden Treaty handles typed application routes with cookies. TanStack Query owns the session and account data, while a React Router guard controls account navigation. Existing account demo pages are converted in place to real API reads and writes.

**Tech Stack:** Bun, Elysia, Better Auth, React 19, React Router 8, TanStack Query, Eden Treaty, React Hook Form, Zod, shared shadcn/ui, GSAP, Tailwind CSS v4.

**Spec:** `docs/superpowers/specs/2026-09-28-storefront-customer-auth-design.md`

## Global Constraints

- Preserve existing uncommitted storefront and shared UI changes; do not reset or overwrite unrelated edits.
- Only `/account` and descendants require a customer session; checkout remains available to guests.
- Use API authorization as the final authority. Send `credentials: 'include'`; do not store tokens in browser storage.
- Registration name is 1–100 trimmed characters, email follows API length, and password is 12–256 characters. Preserve the API's neutral accepted response.
- Use Satoshi and the existing Thai font stack, shared shadcn components, Hugeicons, and semantic theme tokens. No second icon set or raw colors where tokens suffice.
- Before writing React/UI code, publish the `gpt-taste` `<design_plan>` with deterministic selection, AIDA check, heading width, gapless grid math, label sweep, and button contrast. Keep the form immediately accessible and respect reduced motion.
- Run `bun --filter storefront build` and `bun --filter storefront lint`; run `bun --filter @workspace/ui typecheck` if shared UI changes. API integration tests require `TEST_DATABASE_URL` ending in `_test`.

## Review Focus

1. A return URL containing `//`, an encoded slash, or a path outside `/account` must resolve to `/account`; Task 2 tests it.
2. A failed `/get-session` network call must show retry and retain the current page, while a valid anonymous response redirects; Task 2 tests it.
3. A registration request for an existing email must show the same UI result as a new email; Task 3 tests the result mapper.
4. A 401 while loading account data must clear protected cache, while a 500 must offer retry; Task 4 tests the error classifier.
5. Address updates and order details must never show stale data from another signed-in customer; Tasks 4 and 6 test identity-scoped query keys and cache clearing.

---

### Task 1: Auth HTTP client and typed API credentials

**Files:**
- Create: `apps/storefront/src/lib/auth-client.ts`
- Modify: `apps/storefront/src/lib/api.ts`
- Test: `apps/storefront/tests/auth-client.test.ts`

**Interfaces:**
- Produces: `AuthRequestError` with `status` and `code`; `getSession(): Promise<CustomerSession | StaffSession | null>`; `signIn(email, password): Promise<'session' | 'challenge'>`; `signOut(): Promise<void>`; `requestPasswordReset(email, redirectTo): Promise<void>`; `resetPassword(token, password): Promise<void>`; `sendVerificationEmail(email): Promise<void>`; `changePassword(currentPassword, newPassword): Promise<void>`; `listSessions()`, `revokeSession(token)`, and `revokeOtherSessions()`.
- Produces: `api` from Eden Treaty configured with `fetch: { credentials: 'include' }`.

- [ ] **Step 1: Write failing fetch-client tests.** Assert cookie credentials, the exact auth path, null anonymous session, validated customer/staff session, network error, 401, and malformed success response.
- [ ] **Step 2: Run `bun test apps/storefront/tests/auth-client.test.ts`.** Confirm the new tests fail because the client is absent.
- [ ] **Step 3: Implement the client and Eden credential setting.** Parse unknown JSON defensively; return a typed session only after required fields are validated; keep server messages generic for 5xx and network failures.
- [ ] **Step 4: Run `bun test apps/storefront/tests/auth-client.test.ts`.** Confirm all tests pass.
- [ ] **Step 5: Commit only Task 1 files.** Subject: `Add storefront auth client`.

### Task 2: Session query, safe navigation, and account guard

**Files:**
- Create: `apps/storefront/src/lib/auth-session.ts`
- Create: `apps/storefront/src/lib/auth-navigation.ts`
- Create: `apps/storefront/src/pages/auth/customer-guard.tsx`
- Modify: `apps/storefront/src/router.tsx`
- Test: `apps/storefront/tests/auth-navigation.test.ts`
- Test: `apps/storefront/tests/auth-session.test.ts`

**Interfaces:**
- Consumes: `getSession`, `signOut`, `CustomerSession`, `AuthRequestError` from Task 1.
- Produces: `authSessionQuery`; `refreshAuthSession(queryClient): Promise<CustomerSession | StaffSession | null>`; `clearCustomerQueries(queryClient): void`; `safeAccountReturnPath(value: string | null): string`; `CustomerGuard` component.

- [ ] **Step 1: Write failing pure tests.** Check `/account`, nested account paths, unsafe external/encoded paths, anonymous vs staff classification, identity-scoped account query keys, and protected cache removal on sign-out.
- [ ] **Step 2: Run `bun test apps/storefront/tests/auth-navigation.test.ts apps/storefront/tests/auth-session.test.ts`.** Confirm expected failures.
- [ ] **Step 3: Implement session helpers and guard.** Session query has no retry and refetches on focus. The guard shows pending/retry states, redirects anonymous users to `/sign-in?returnTo=<account path>`, and rejects staff sessions without rendering account content. Keep checkout outside it.
- [ ] **Step 4: Run the two tests and `bun --filter storefront typecheck`.** Confirm pass.
- [ ] **Step 5: Commit only Task 2 files.** Subject: `Guard customer account routes`.

### Task 3: Registration, sign-in, and recovery screens

**Files:**
- Create: `apps/storefront/src/pages/auth/auth-schemas.ts`
- Create: `apps/storefront/src/pages/auth/auth-result.ts`
- Create: `apps/storefront/src/pages/auth/auth-layout.tsx`
- Create: `apps/storefront/src/pages/auth/sign-in-page.tsx`
- Create: `apps/storefront/src/pages/auth/sign-up-page.tsx`
- Create: `apps/storefront/src/pages/auth/forgot-password-page.tsx`
- Create: `apps/storefront/src/pages/auth/reset-password-page.tsx`
- Modify: `apps/storefront/src/router.tsx`
- Modify: `apps/storefront/src/pages/layout.tsx`
- Test: `apps/storefront/tests/auth-forms.test.ts`

**Interfaces:**
- Consumes: Task 1 client, `api.auth['sign-up']`, Task 2 session refresh and safe return path.
- Produces: RHF/Zod schemas, neutral registration result mapper, routes `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`.

- [ ] **Step 1: Publish the required `gpt-taste` `<design_plan>` before editing UI code.** Include the seed and selected hero/font/components/motion, AIDA order, `max-w` heading width, exact grid cell occupancy, label sweep, and contrast check.
- [ ] **Step 2: Write failing schema and result tests.** Assert trimmed name bounds, email shape/length, 12–256 character password, confirmation mismatch, and identical accepted copy for new/existing addresses.
- [ ] **Step 3: Run `bun test apps/storefront/tests/auth-forms.test.ts`.** Confirm expected failures.
- [ ] **Step 4: Implement schema/result helpers and four screens.** Keep form first on mobile; use shared Field/Input/Button; show pending and API errors; on sign-in refresh the session and navigate only for a customer. Use neutral recovery copy and the exact reset token from the URL.
- [ ] **Step 5: Run the test, storefront typecheck, and inspect both routes at mobile and desktop widths.** Confirm labels, focus, reduced motion, and that no scroll is required before interacting with the form.
- [ ] **Step 6: Commit only Task 3 files.** Subject: `Add customer auth pages`.

### Task 4: Account data client and identity-bound queries

**Files:**
- Create: `apps/storefront/src/pages/account/account-api.ts`
- Create: `apps/storefront/src/pages/account/account-queries.ts`
- Create: `apps/storefront/src/pages/account/account-state.ts`
- Test: `apps/storefront/tests/account-queries.test.ts`

**Interfaces:**
- Consumes: Task 1 Eden `api`, Task 2 session identifier and cache helper.
- Produces: `getProfile`, `getAddresses`, `getOrders(cursor?)`, `getOrder(orderId)`, and mutation functions for profile, email change, addresses; query options keyed by customer user ID; `classifyAccountError(error): 'signed-out' | 'forbidden' | 'not-found' | 'retry'`.

- [ ] **Step 1: Write failing API-wrapper tests.** Assert 401/403/404/500 classification, typed data extraction, per-user query keys, and credentials inherited from Eden.
- [ ] **Step 2: Run `bun test apps/storefront/tests/account-queries.test.ts`.** Confirm expected failures.
- [ ] **Step 3: Implement narrow wrappers and query factories.** Throw a normalized error for Eden error responses; use separate keys for profile, addresses, order pages, and order IDs, all under the current user ID.
- [ ] **Step 4: Run the test and storefront typecheck.** Confirm pass.
- [ ] **Step 5: Commit only Task 4 files.** Subject: `Add customer account data queries`.

### Task 5: Real profile, email change, and addresses

**Files:**
- Modify: `apps/storefront/src/pages/account/account-layout.tsx`
- Modify: `apps/storefront/src/pages/account/profile-page.tsx`
- Modify: `apps/storefront/src/pages/account/addresses-page.tsx`
- Modify: `apps/storefront/src/pages/account/account-ui.tsx`
- Create: `apps/storefront/src/pages/account/email-change-form.tsx`
- Test: `apps/storefront/tests/account-forms.test.ts`

**Interfaces:**
- Consumes: Task 4 query and mutation functions; Task 2 session state.
- Produces: real profile/name edit, two-step email change, real address CRUD and shipping/billing defaults.

- [ ] **Step 1: Write failing form-schema tests.** Assert API name/address limits, 9–10 digit phone, five-digit postal code, nullable second line, and exact eight-digit email confirmation code.
- [ ] **Step 2: Run `bun test apps/storefront/tests/account-forms.test.ts`.** Confirm expected failures.
- [ ] **Step 3: Convert profile and addresses to real data.** Remove editable phone from profile, handle loading/empty/retry, invalidate affected queries after mutations, and return to sign-in after confirmed email change revokes the session.
- [ ] **Step 4: Run the test and storefront typecheck.** Confirm pass.
- [ ] **Step 5: Commit only Task 5 files.** Subject: `Connect customer profile and addresses`.

### Task 6: Real overview and order history

**Files:**
- Modify: `apps/storefront/src/pages/account/overview-page.tsx`
- Modify: `apps/storefront/src/pages/account/orders-page.tsx`
- Modify: `apps/storefront/src/pages/account/order-detail-page.tsx`
- Modify: `apps/storefront/src/pages/account/account-ui.tsx`
- Delete after migration: `apps/storefront/src/pages/account/account-context.ts`
- Delete after migration: `apps/storefront/src/pages/account/account-data.ts`
- Test: `apps/storefront/tests/account-orders.test.ts`

**Interfaces:**
- Consumes: Task 4 order/profile/address queries and order types inferred from Eden.
- Produces: order status/price/date display helpers, paginated order history, owned order detail, real overview.

- [ ] **Step 1: Write failing data-display tests.** Assert all seven API order statuses, satang-to-baht conversion, latest order selection, cursor append without duplicates, and detail lookup scoped to the current user.
- [ ] **Step 2: Run `bun test apps/storefront/tests/account-orders.test.ts`.** Confirm expected failures.
- [ ] **Step 3: Replace demo data on overview/order pages.** Use `nextCursor` for load more, API snapshot fields for address/payment/items, not-found for unknown or inaccessible order, and real empty states. Delete demo files only when no rendered page imports them.
- [ ] **Step 4: Run the test, `rg -n 'demoOrders|useAccountDemo|initialProfile|initialAddresses' apps/storefront/src/pages/account`, and storefront typecheck.** Confirm tests pass and no demo references remain.
- [ ] **Step 5: Commit only Task 6 files.** Subject: `Connect account overview and orders`.

### Task 7: Security actions and final integration

**Files:**
- Modify: `apps/storefront/src/pages/account/security-page.tsx`
- Modify: `apps/storefront/src/pages/account/account-layout.tsx`
- Modify if required: `apps/api/src/plugins/auth/auth.ts`
- Test: `apps/storefront/tests/account-security.test.ts`
- Test if API changes: matching `apps/api/test/unit/*` or `apps/api/test/integration/*` auth test.

**Interfaces:**
- Consumes: Task 1 auth client, Task 2 cache/session helpers, Task 4 account error handling.
- Produces: verification resend, password change, session list/revoke, sign-out, session-aware navigation.

- [ ] **Step 1: Write failing security flow tests.** Assert sign-out clears account keys, revoked current session returns to sign-in, verification resend keeps a neutral result, and password change errors do not expose the entered password.
- [ ] **Step 2: Run `bun test apps/storefront/tests/account-security.test.ts`.** Confirm expected failures.
- [ ] **Step 3: Implement security UI and session actions.** Use real `emailVerified`, change-password, list-sessions, revoke-session, revoke-other-sessions, and sign-out endpoints. Invalidate session and account queries after identity changes.
- [ ] **Step 4: Resolve any reset destination API gap with a focused API test and minimal API edit.** Skip this step if the existing Better Auth route accepts the requested destination in an end-to-end check.
- [ ] **Step 5: Run `bun test apps/storefront/tests`, `bun --filter storefront build`, and `bun --filter storefront lint`.** Confirm all pass; run `bun --filter api test:unit` and `bun --filter api typecheck` if API files changed.
- [ ] **Step 6: Check the live sign-in/sign-up/account flows at desktop and mobile widths.** Verify keyboard use, request failures, return routing, reduced motion, and that checkout still works anonymously.
- [ ] **Step 7: Commit only Task 7 files.** Subject: `Complete customer account security`.
