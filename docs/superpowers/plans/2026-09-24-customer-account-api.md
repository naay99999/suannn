# Customer Account API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete customer self-service API for profile, verified email change, and multiple Thai addresses while preserving the existing Better Auth flows.

**Architecture:** Reuse Better Auth for credentials and sessions. Add customer-only Elysia routes backed by focused services and Drizzle repositories; extend the identity-claim lock for an atomic email move. Keep all frontend applications untouched.

**Tech Stack:** Bun, TypeScript, Elysia, Better Auth 1.7.5, Drizzle ORM, PostgreSQL, Resend, Bun test runner.

**Spec:** `docs/superpowers/specs/2026-09-24-customer-account-api-design.md`

## Global Constraints

- Scope is `apps/api` only; no storefront or admin integration, order history, checkout, account deletion, or new auth provider.
- Customer self-service accepts an active `accountType: 'customer'` session even when the original email is unverified; staff sessions are rejected.
- Every new browser mutation uses JSON and `browserMutation('storefront')`; the API derives `userId` from the session.
- Email change uses an eight-digit code that expires after ten minutes, allows at most five wrong attempts, and is replaced by a new request.
- Request email-change limit is three per hour per customer/IP; confirmation limit is five per ten minutes per customer/IP.
- Email change must atomically move `user.email` and `identityEmailClaim`, consume the code, revoke all customer sessions, and write an audit event with no email or code metadata.
- Address country is `TH`; postal code is five digits; phone is a 9- or 10-digit domestic number; each customer stores at most 20 addresses.
- Each customer has at most one shipping default and one billing default; the first address gets both, and deletion promotes the oldest remaining address for each affected type.
- Use the repository's two-space indentation, single quotes, no semicolons, and generated Drizzle migrations. Preserve unrelated workspace changes.
- Run integration tests only with a dedicated `TEST_DATABASE_URL` ending in `_test`; they reset database schemas.

## Review Focus

1. A stale customer cookie or a staff cookie on a customer route must return an auth error before any private data is read (Task 1 test).
2. Concurrent creation or default changes must never exceed 20 addresses or create two defaults of one kind (Tasks 2 and 3 tests).
3. A malformed Thai phone/postal code, unknown address key, or another user's address ID must not persist or reveal data (Task 2 test).
4. A code for an earlier email-change request, an expired code, or a sixth guess must never change identity (Task 5 test).
5. A concurrent staff invitation/signup for the proposed email, or a revoked session at confirmation time, must leave the old email and claim intact (Task 5 test).

---

## File map and boundaries

| Unit | Files | Responsibility |
| --- | --- | --- |
| Customer auth macro | `apps/api/src/plugins/auth/index.ts` | Return only an active customer user/session; distinguish missing session and staff session. |
| Profile | `apps/api/src/modules/customer/profile/{index,model,service,repository}.ts` | Expose a narrow name-only update and current profile projection. |
| Addresses | `apps/api/src/modules/customer/addresses/{index,model,service,repository}.ts` | Validate Thai addresses, own records, and serialize defaults. |
| Email change | `apps/api/src/modules/customer/email-change/{index,model,service,repository,code}.ts` | Check current password, deliver and verify a code, then change identity atomically. |
| Persistence | `apps/api/src/database/schema/customer.ts`, `apps/api/src/database/schema/index.ts`, two generated migrations after the current `0004_*.sql` and their snapshots/journal entries | Customer addresses and pending email changes; constraints and indexes. |
| Shared composition | `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/plugins/openapi.ts`, `apps/api/src/shared/domain-error.ts`, `apps/api/src/modules/audit/model.ts`, `apps/api/src/modules/email/{sender,templates}.ts` | Wire dependencies, errors, documentation, audit, and email. |
| Verification | `apps/api/test/unit/customer-*.test.ts`, `apps/api/test/integration/customer-*.test.ts`, `apps/api/test/unit/api.test.ts`, `apps/api/README.md` | Unit and database proof, route contract, operator documentation. |

Keep profile, address, and email-change services separate. `app.ts` only composes their route modules. For each new module, follow `src/modules/auth/staff/`'s route/model/service/repository convention. `test/unit/api.test.ts` constructs `createApp` directly, so extend its dependency fixture whenever `AppDependencies` gains a required service.

### Task 1: Customer guard and narrow profile API

**Files:**
- Modify: `apps/api/src/plugins/auth/index.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/plugins/openapi.ts`, `apps/api/src/shared/domain-error.ts`, `apps/api/test/unit/api.test.ts`
- Create: `apps/api/src/modules/customer/profile/index.ts`, `model.ts`, `service.ts`, `repository.ts`
- Test: `apps/api/test/unit/customer-profile.test.ts`, `apps/api/test/integration/customer-profile.test.ts`

**Interfaces:**
- Consumes: `Auth` and `Database`; `auth.api.getSession({ headers })` supplies the projected user/session.
- Produces: `customerAuth: true` macro returning `{ user, session }`; `CustomerProfileService.get(userId)` and `.rename(userId, name)`; typed `/api/v1/customer/profile` routes.

- [ ] **Step 1: Write failing guard and profile tests.** In the test setup define `app` with the real route module, `config` from `testEnv`, and `staffCookie`/`customerCookie` from created Better Auth sessions. Use a fake `getSession` for no session, `accountType: 'staff'`, and `accountType: 'customer'`, and an integration row for a real customer. Pin exact responses and unknown-field rejection:

```ts
const guestResponse = await app.handle(new Request('http://localhost/api/v1/customer/profile'))
const staffResponse = await app.handle(new Request('http://localhost/api/v1/customer/profile', {
  headers: { cookie: staffCookie },
}))
const profileResponse = await app.handle(new Request('http://localhost/api/v1/customer/profile', {
  headers: { cookie: customerCookie },
}))
const badPatch = await app.handle(new Request('http://localhost/api/v1/customer/profile', {
  method: 'PATCH',
  headers: { cookie: customerCookie, origin: config.storefrontUrl, 'content-type': 'application/json' },
  body: JSON.stringify({ role: 'owner' }),
}))
expect((await guestResponse.json()).code).toBe('AUTHENTICATION_REQUIRED')
expect(guestResponse.status).toBe(401)
expect((await staffResponse.json()).code).toBe('CUSTOMER_ACCOUNT_REQUIRED')
expect(staffResponse.status).toBe(403)
expect((await profileResponse.json()).emailVerified).toBe(false)
expect(badPatch.status).toBe(422) // { role: 'owner' } must not be accepted
```

- [ ] **Step 2: Run the focused tests; confirm they fail for absent macro/route.**

```bash
bun test apps/api/test/unit/customer-profile.test.ts
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/suannn_test bun --filter api test:integration
```

The second command is conditional on a dedicated `_test` database being available; otherwise record that integration verification is pending without creating or targeting a non-test database.

- [ ] **Step 3: Add the customer macro and profile repository/service.** The macro must treat a failed session lookup as unauthenticated and must not substitute the existing `verifiedCustomer` macro. Model the service boundary as:

```ts
export interface CustomerProfile {
  id: string
  name: string
  email: string
  emailVerified: boolean
}
export class CustomerProfileService {
  constructor(private readonly repository: CustomerProfileRepository) {}
  get(userId: string): Promise<CustomerProfile> { return this.repository.get(userId) }
  rename(userId: string, name: string): Promise<CustomerProfile> {
    return this.repository.rename(userId, name.trim())
  }
}
```

Use `WHERE user.id = userId AND accountType = 'customer'` in both repository methods. The route model accepts only `{ name: string }`, min length after trim 1, max length 100, `additionalProperties: false`. Reuse `browserMutation('storefront')` for PATCH. Add `CUSTOMER_ACCOUNT_REQUIRED` to the stable error mapping.

- [ ] **Step 4: Wire routes into `createApp` and production/test dependencies, then rerun focused tests and API typecheck.** OpenAPI operations have a `Customer Profile` tag, `sessionCookie` security, and explicit 200/401/403/422 schemas.

```bash
bun --filter api test:unit
bun --filter api typecheck
```

- [ ] **Step 5: Commit the isolated profile slice.**

```bash
git add apps/api/src/plugins/auth/index.ts apps/api/src/modules/customer/profile apps/api/src/app.ts apps/api/src/index.ts apps/api/src/plugins/openapi.ts apps/api/src/shared/domain-error.ts apps/api/test/unit/customer-profile.test.ts apps/api/test/integration/customer-profile.test.ts apps/api/test/unit/api.test.ts
git commit -m 'Add customer profile API guard'
```

### Task 2: Owned Thai address CRUD and first-address defaults

**Files:**
- Create: `apps/api/src/database/schema/customer.ts`, `apps/api/src/modules/customer/addresses/{index,model,service,repository}.ts`, generated Drizzle migration and snapshot
- Modify: `apps/api/src/database/schema/index.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/shared/domain-error.ts`, `apps/api/src/plugins/openapi.ts`, `apps/api/test/unit/api.test.ts`
- Test: `apps/api/test/unit/customer-addresses.test.ts`, `apps/api/test/integration/customer-addresses.test.ts`

**Interfaces:**
- Consumes: Task 1 `customerAuth` macro and the existing `Database` transaction type.
- Produces: `CustomerAddressService.list/create/update/remove(userId, ...)`, `CustomerAddressRepository` with owner-scoped queries, and address CRUD routes. Task 3 extends the same service with `setDefault`.

- [ ] **Step 1: Write failing schema/service/route tests.** The fixture provides `service`, `customerId`, `otherCustomerId`, and `created`; preload 19 addresses for the concurrent-create assertion. Test a valid Thai address, a five-digit versus four-digit postal code, phone with 8 versus 9 digits, extra `userId` key, other customer's ID, and the 21st address. Include two simultaneous creates for the same customer's twentieth slot; only one may succeed.

```ts
const address = {
  label: 'Home', recipientName: 'Mali', phone: '0812345678',
  addressLine1: '99 ถนนสุขุมวิท', addressLine2: null,
  subdistrict: 'คลองเตย', district: 'คลองเตย', province: 'กรุงเทพมหานคร',
  postalCode: '10110',
}
expect(created.isDefaultShipping).toBe(true)
expect(created.isDefaultBilling).toBe(true)
await expect(service.update(otherCustomerId, created.id, { label: 'Stolen' }))
  .rejects.toThrow('ADDRESS_NOT_FOUND')
const results = await Promise.allSettled([
  service.create(customerId, address), service.create(customerId, address),
])
expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
```

- [ ] **Step 2: Run focused tests and confirm the missing schema/routes fail.**

```bash
bun test apps/api/test/unit/customer-addresses.test.ts
```

- [ ] **Step 3: Add address schema, constraints, and migration.** Define `customerAddress` with a cascading FK to `user.id`, required address fields, timestamps, and default booleans. Define partial unique indexes on `userId` for each true default and an index for ordered owner lookup:

```ts
uniqueIndex('customer_address_shipping_default_unique')
  .on(table.userId).where(sql`${table.isDefaultShipping} = true`)
uniqueIndex('customer_address_billing_default_unique')
  .on(table.userId).where(sql`${table.isDefaultBilling} = true`)
index('customer_address_owner_created_idx').on(table.userId, table.createdAt, table.id)
```

Generate and inspect the migration with `bun --filter api db:generate` only when `apps/api/.env.local` points to a safe development database. The generated SQL must contain both partial unique indexes and the FK; do not hand-edit generated Better Auth schema.

- [ ] **Step 4: Implement owner-scoped CRUD and routes.** Set explicit text limits: label 60, recipient 100, address lines 200 each, and subdistrict/district/province 100 each; all required strings must remain nonempty after trim. Repository method signatures are:

```ts
list(userId: string): Promise<CustomerAddress[]>
create(userId: string, input: CustomerAddressInput): Promise<CustomerAddress>
update(userId: string, id: string, input: Partial<CustomerAddressInput>): Promise<CustomerAddress>
remove(userId: string, id: string): Promise<void>
```

Lock the `user` row before counting/inserting so 20-address enforcement and the first default are serialized. All read/update/delete predicates include `userId`; unknown or foreign IDs throw `ADDRESS_NOT_FOUND`. The Elysia model rejects unknown keys, trims text, enforces `TH`, five postal digits, 9-10 phone digits, and a maximum of 20 addresses. GET/list requires `customerAuth`; POST/PATCH/DELETE also require storefront browser mutation policy. Deletion of a default must promote the oldest remaining address in the same transaction (Task 3 tests expand this matrix).

- [ ] **Step 5: Wire the module, run schema and route tests, typecheck, and commit.**

```bash
bun --filter api test:unit
bun --filter api typecheck
git add apps/api/src/database/schema apps/api/drizzle apps/api/src/modules/customer/addresses apps/api/src/app.ts apps/api/src/index.ts apps/api/src/shared/domain-error.ts apps/api/src/plugins/openapi.ts apps/api/test/unit/customer-addresses.test.ts apps/api/test/integration/customer-addresses.test.ts apps/api/test/unit/api.test.ts
git commit -m 'Add customer address CRUD'
```

### Task 3: Independent address defaults under concurrent mutation

**Files:**
- Modify: `apps/api/src/modules/customer/addresses/{index,model,service,repository}.ts`, `apps/api/src/plugins/openapi.ts`, `apps/api/test/unit/api.test.ts`
- Test: `apps/api/test/integration/customer-addresses.test.ts`

**Interfaces:**
- Consumes: Task 2 `CustomerAddressService` and `customerAddress` table.
- Produces: `CustomerAddressService.setDefault(userId, addressId, kind: 'shipping' | 'billing')` and `PUT /api/v1/customer/addresses/:id/default`.

- [ ] **Step 1: Write failing tests for independent defaults and deletion promotion.** Use three addresses with deterministic `createdAt` ordering. Set shipping to B, billing to C; delete B and assert shipping promotes A while billing stays C. Run simultaneous shipping changes to B/C and assert exactly one shipping default exists. Repeat for billing.

```ts
expect(addresses.filter((item) => item.isDefaultShipping)).toHaveLength(1)
expect(addresses.filter((item) => item.isDefaultBilling)).toHaveLength(1)
expect(addresses.find((item) => item.isDefaultBilling)?.id).toBe(c.id)
expect(await setDefault(otherUserId, a.id, 'shipping')).toBe(404)
```

- [ ] **Step 2: Run the focused integration test and observe the missing default route/failing matrix.**

```bash
bun test apps/api/test/integration/customer-addresses.test.ts
```

Use the established `_test` environment only.

- [ ] **Step 3: Add the idempotent default operation.** The route body is exactly `{ kind: 'shipping' | 'billing' }`. In a transaction, lock the owner `user` row, find the owned target, clear the chosen flag for this user, and set that flag on the target. Do not touch the other flag. Keep deletion promotion ordered by `createdAt, id` and inside the same owner-row lock. Rely on the partial unique index as a final invariant.

```ts
async setDefault(userId: string, id: string, kind: 'shipping' | 'billing') {
  return this.repository.setDefault(userId, id, kind)
}
```

- [ ] **Step 4: Run integration tests, API typecheck, and commit this behavior.**

```bash
bun --filter api test:integration
bun --filter api typecheck
git add apps/api/src/modules/customer/addresses apps/api/src/plugins/openapi.ts apps/api/test/integration/customer-addresses.test.ts apps/api/test/unit/api.test.ts
git commit -m 'Support independent customer address defaults'
```

### Task 4: Password-gated email-change request and code delivery

**Files:**
- Modify: `apps/api/src/database/schema/customer.ts`, `apps/api/src/database/schema/index.ts`, `apps/api/src/modules/email/{sender,templates}.ts`, `apps/api/src/shared/domain-error.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`, `apps/api/src/plugins/openapi.ts`, `apps/api/test/unit/api.test.ts`, generated Drizzle migration/snapshot
- Create: `apps/api/src/modules/customer/email-change/{index,model,service,repository,code}.ts`
- Test: `apps/api/test/unit/customer-email-change.test.ts`, `apps/api/test/integration/customer-email-change.test.ts`

**Interfaces:**
- Consumes: Task 1 `customerAuth`; existing `RateLimiter`, `EmailSender`, `Database`, `normalizeEmail` and Better Auth credential hash format.
- Produces: `CustomerEmailChangeService.request({ userId, sessionId, newEmail, currentPassword, clientIp, requestId })`, pending-change repository, code hashing helper, and request route. Task 5 uses the pending row and code helper.

- [ ] **Step 1: Write failing request tests.** The fixture supplies `service`, `userId`, `sessionId`, `sent`, `generatedCode`, and a fake clock, code generator, and email sender. Test wrong password, same address, normalized duplicate customer email, pending staff invitation, code replacement, three-per-hour limit, and failure to leak the code to HTTP response or logs. Test that request does not create another session.

```ts
const input = { userId, sessionId, currentPassword: 'correct horse battery staple',
  clientIp: '127.0.0.1', requestId: 'request-1' }
const response = await service.request({ ...input, newEmail: ' NEW@Example.com ' })
expect(response).toEqual({ accepted: true })
expect(sent[0]?.to).toBe('new@example.com')
expect(JSON.stringify(response)).not.toContain(generatedCode)
await expect(service.request({ ...input, newEmail: 'other@example.com',
  currentPassword: 'wrong password' })).rejects.toThrow('INVALID_CURRENT_PASSWORD')
```

- [ ] **Step 2: Run the focused tests and verify failure for absent service.**

```bash
bun test apps/api/test/unit/customer-email-change.test.ts
```

- [ ] **Step 3: Add the pending table, code helper, and generated migration.** Use one pending row per `userId`, a FK with cascade delete, normalized new email, keyed digest, `expiresAt`, `createdAt`, and `failedAttempts`. Generate an eight-digit decimal code with `randomInt(0, 100_000_000).toString().padStart(8, '0')` from `node:crypto`; hash using HMAC-SHA-256 with `config.betterAuthSecret` and compare with `timingSafeEqual`. Never persist the code itself. Run `bun --filter api db:generate` against a safe local configuration and inspect the second new migration's SQL and snapshot.

```ts
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

export interface PendingEmailChange {
  userId: string
  newEmail: string
  codeDigest: string
  expiresAt: Date
  failedAttempts: number
}
export function digestEmailChangeCode(secret: string, userId: string, code: string): string {
  return createHmac('sha256', secret).update(`${userId}:${code}`).digest('hex')
}
export function createEmailChangeCode(): string {
  return randomInt(0, 100_000_000).toString().padStart(8, '0')
}
```

- [ ] **Step 4: Implement request service and route.** Query the customer's credential account row and verify the password with Better Auth's matching verifier (`verifyPassword` from `better-auth/crypto`); do not call sign-in. Use `normalizeEmail`, check both `user` and claims under the existing new-email lock, upsert the pending row, and queue the new `change-email` email template. Add customer/IP rate limiting in the customer-only route before calling the service (the generic path/IP macro alone does not satisfy the spec) and storefront CSRF policy at the route. Preserve the existing background email failure policy.

```ts
const limited = await limiter.consume({
  namespace: 'customer-email-change-request',
  subjectHash: hashToken(userId), ip: clientIp,
  limit: 3, windowSeconds: 60 * 60,
})
if (!limited.allowed) {
  const rejected = rateLimitResponse(limited)
  set.status = rejected.status
  Object.assign(set.headers, rejected.headers)
  return rejected.body
}
```

- [ ] **Step 5: Wire composition, inspect the generated migration, run focused tests/typecheck, and commit.**

```bash
bun --filter api test:unit
bun --filter api typecheck
git add apps/api/src/database/schema apps/api/drizzle apps/api/src/modules/customer/email-change apps/api/src/modules/email apps/api/src/shared/domain-error.ts apps/api/src/app.ts apps/api/src/index.ts apps/api/src/plugins/openapi.ts apps/api/test/unit/customer-email-change.test.ts apps/api/test/integration/customer-email-change.test.ts apps/api/test/unit/api.test.ts
git commit -m 'Add customer email change request'
```

### Task 5: Atomic email confirmation and identity transfer

**Files:**
- Modify: `apps/api/src/modules/identity-claims/service.ts`, `apps/api/src/modules/customer/email-change/{index,model,service,repository,code}.ts`, `apps/api/src/modules/audit/model.ts`, `apps/api/src/shared/domain-error.ts`, `apps/api/src/plugins/openapi.ts`
- Test: `apps/api/test/unit/customer-email-change.test.ts`, `apps/api/test/integration/customer-email-change.test.ts`, `apps/api/test/integration/identity-claims.test.ts`

**Interfaces:**
- Consumes: Task 4 pending-change row and code digest; existing `IdentityClaimService` and `AuditService`.
- Produces: `IdentityClaimService.withEmailOperations(emails, callback)` acquiring distinct normalized email locks in sorted order, and `CustomerEmailChangeService.confirm({ userId, sessionId, code, clientIp, requestId })`.

- [ ] **Step 1: Write failing confirmation tests.** The fixture supplies `service`, `userId`, `sessionId`, `oldCode`, `expiredCode`, and a database read helper returning `after`. Pin an expired code, old code after replacement, repeated code, five wrong attempts then sixth rejection, occupied new address, concurrent staff invitation/signup, revoked session, and successful old-claim/new-claim transfer with all sessions removed and a metadata-empty audit row.

```ts
const input = { userId, sessionId, clientIp: '127.0.0.1', requestId: 'request-2' }
await expect(service.confirm({ ...input, code: oldCode }))
  .rejects.toThrow('EMAIL_CHANGE_CODE_INVALID')
await expect(service.confirm({ ...input, code: expiredCode }))
  .rejects.toThrow('EMAIL_CHANGE_CODE_EXPIRED')
expect(after.user.email).toBe('new@example.com')
expect(after.oldClaim).toBeNull()
expect(after.newClaim?.userId).toBe(userId)
expect(after.sessions).toHaveLength(0)
expect(after.audit.metadata).toEqual({})
```

- [ ] **Step 2: Run focused tests and confirm failure before implementation.**

```bash
bun test apps/api/test/unit/customer-email-change.test.ts
```

- [ ] **Step 3: Extend the identity lock without changing existing single-email behavior.** Factor the existing connection/timeout logic into `withEmailOperations`. Normalize, deduplicate, sort the emails, acquire the same advisory-lock keys in that order, and release in reverse order. `withEmailOperation(email, callback)` delegates to the new method so signup/invitation callers keep one lock protocol. Keep the existing eight-slot global throttle and ten-second lock deadline. Add tests for reversed email pair order and a concurrent single-email caller.

```ts
withEmailOperation<T>(email: string, callback: () => Promise<T>): Promise<T> {
  return this.withEmailOperations([email], callback)
}
withEmailOperations<T>(emails: string[], callback: () => Promise<T>): Promise<T>
```

- [ ] **Step 4: Implement confirmation in one transaction.** Rate-limit by user/IP with namespace `customer-email-change-confirm`, limit 5, window 600 seconds, using the same route response pattern from Task 4. Acquire current and proposed email locks, lock the user and pending row, recheck that `session.id` still belongs to the customer and is unexpired, and compare the keyed digest in constant time. On a wrong code, increment attempts in a separate committed transaction so failure cannot roll it back. On success, check the new email is free in both claim and user tables, delete the old customer claim, update user email and verified flag, insert the new claim, delete pending row and all user sessions, and record `customer.email-changed` with empty metadata. A conflict or revoked session rolls back the entire identity transfer. Map invalid, expired, and unavailable results to the named safe errors.

```ts
await tx.delete(identityEmailClaim).where(and(
  eq(identityEmailClaim.normalizedEmail, oldEmail),
  eq(identityEmailClaim.userId, userId),
  eq(identityEmailClaim.state, 'customer'),
))
await tx.update(user).set({ email: newEmail, emailVerified: true }).where(eq(user.id, userId))
await tx.insert(identityEmailClaim).values({ normalizedEmail: newEmail, state: 'customer', userId })
await tx.delete(session).where(eq(session.userId, userId))
```

- [ ] **Step 5: Run identity and customer integration tests, typecheck, then commit.**

```bash
bun --filter api test:integration
bun --filter api typecheck
git add apps/api/src/modules/identity-claims/service.ts apps/api/src/modules/customer/email-change apps/api/src/modules/audit/model.ts apps/api/src/shared/domain-error.ts apps/api/src/plugins/openapi.ts apps/api/test/unit/customer-email-change.test.ts apps/api/test/integration/customer-email-change.test.ts apps/api/test/integration/identity-claims.test.ts
git commit -m 'Confirm customer email changes atomically'
```

### Task 6: Public contract and full API verification

**Files:**
- Modify: `apps/api/README.md`, `apps/api/test/unit/api.test.ts`, and only the API source files needed to correct a concrete test failure
- Test: Existing API unit and integration suites

**Interfaces:**
- Consumes: Tasks 1-5 completed routes.
- Produces: documented, typechecked API with no storefront changes.

- [ ] **Step 1: Write a route-contract test for every customer endpoint.** Assert OpenAPI paths/methods, request/response schema presence, `sessionCookie` security, and customer tags; assert raw Better Auth `/change-email` remains absent. Assert `apps/storefront` and `apps/admin` have no tracked changes.

```ts
expect(spec.paths['/api/v1/customer/profile'].get.security).toEqual([{ sessionCookie: [] }])
expect(spec.paths['/api/v1/customer/addresses/{id}/default'].put).toBeDefined()
expect(spec.paths['/api/v1/customer/email-change/confirm'].post).toBeDefined()
expect(spec.paths['/api/v1/auth/change-email']).toBeUndefined()
```

- [ ] **Step 2: Run the contract test and repair only missing route metadata/contracts.**

```bash
bun --filter api test:unit
```

- [ ] **Step 3: Document exact request/confirm and address endpoints in the API README.** Include `Origin: STOREFRONT_URL`, JSON bodies, cookie session, the ten-minute code expiry, required re-login after confirmation, 20-address limit, and the `_test` database reset warning. Do not document a storefront screen as implemented.

- [ ] **Step 4: Run full verification and inspect the diff.**

```bash
bun --filter api test:unit
bun --filter api test:integration
bun --filter api typecheck
bun --filter api lint
git diff --check
git status --short
```

If the dedicated `_test` database is unavailable, report the integration suite as unrun with that exact reason; never point it at the development database. Re-run only failing checks after a fix.

- [ ] **Step 5: Commit documentation/contract changes separately.**

```bash
git add apps/api/README.md apps/api/test/unit/api.test.ts
git commit -m 'Document customer account API'
```

## Spec coverage check

- Existing signup/sign-in/verification/password/session flows are protected by existing regression tests and Task 6 contract verification; no duplicate provider code is introduced.
- Customer authorization and profile projection: Task 1.
- Thai address CRUD, ownership, 20-address cap, first defaults: Task 2.
- Independent defaults, concurrent changes, deletion promotion: Task 3.
- Password check, code storage/delivery, normalization, resend and rate limit: Task 4.
- Atomic identity move, code expiry/replay/attempts, conflict handling, session revocation and audit: Task 5.
- OpenAPI, README, lint/typecheck/integration verification and frontend exclusion: Task 6.
