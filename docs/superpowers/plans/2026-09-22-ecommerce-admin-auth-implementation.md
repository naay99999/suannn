# Ecommerce and Admin Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the API-side authentication and authorization subsystem for customer email/password accounts and invite-only, MFA-protected staff accounts.

**Architecture:** Better Auth remains the credential, session, reset, verification, and TOTP engine. Elysia owns the public HTTP allowlist, browser-mutation CSRF policy, typed auth macros, and application routes; Drizzle/PostgreSQL owns email-identity serialization, fixed-role constraints, rate limits, invitations, and audit persistence. Domain services call documented Better Auth server APIs but never expose raw Admin or unsafe 2FA endpoints.

**Tech Stack:** Bun 1.3, TypeScript 6, Elysia 1.4, Better Auth 1.7.5, Drizzle ORM 0.45, PostgreSQL, Resend, Bun test.

**Spec:** `docs/superpowers/specs/2026-09-22-ecommerce-admin-auth-design.md`

## Global Constraints

- Keep the implementation inside the spec's API scope; storefront/admin screens and route UX require a separate plan after this API contract is stable.
- Preserve `App = Awaited<ReturnType<typeof createApp>>` in `apps/api/src/app.ts` so Eden Treaty clients infer application-owned routes.
- Use Better Auth 1.7.5 APIs and regenerate `apps/api/src/database/schema/auth.ts` after plugin/schema changes.
- Keep `apps/api/src/plugins/auth/access-control.ts` as the only manually maintained RBAC matrix.
- Use one Better Auth instance, one user table, and exactly one account type and one role per user.
- Keep raw Better Auth Admin, sign-up, email-change, 2FA enrollment/disable/regeneration, and session-update HTTP endpoints denied.
- Use `normalizeEmail()` exactly as specified: ASCII whitespace trim plus lowercase; do not remove dots, plus tags, or provider aliases.
- Staff invitations reserve normalized email addresses atomically through PostgreSQL transaction-scoped advisory locks.
- Staff must complete TOTP enrollment; `trustDevice: true` is rejected for TOTP and backup-code verification.
- Customer sessions last 30 days; staff sessions additionally have a 30-minute idle limit and a non-sliding eight-hour absolute limit.
- Keep `session.cookieCache.enabled = false`; authorization-sensitive staff state comes from server-side storage on every request.
- Application-owned browser mutations accept JSON only and require the exact configured Origin before authentication or business logic.
- Authentication and invitation email uses Resend through injected interfaces; tests use a fake sender and never make network calls.
- Audit metadata is allowlisted and must never contain passwords, cookies, tokens, complete auth URLs, TOTP secrets, or backup codes.
- Match repository style: two spaces, single quotes, no semicolons, and focused feature modules.
- Every task follows red-green-refactor and ends with a focused commit. Never stage the unrelated user edit in `apps/admin/src/pages/login/_components/login-form.tsx`.

## Review Focus

1. A raw email-change request must remain denied because changing an identity email without the claim service would bypass the canonical namespace; Task 7 pins this in the endpoint snapshot.
2. Invite, signup, and acceptance requests for the same normalized email must produce exactly one owner even when no claim row existed initially; Tasks 8 and 9 exercise real concurrent transactions.
3. Session refresh, MFA completion, and backup-code regeneration must preserve an existing absolute deadline exactly; Task 10 tests clock advancement and rotation paths.
4. Browser mutation protection must reject missing, `null`, malformed, untrusted, cross-site, and simple-content-type requests before a route service runs; Task 6 tests every class.
5. A Better Auth upgrade must fail tests if server-owned fields become writable, `createUser({ data })` stops persisting them, or a new raw endpoint becomes public; Tasks 3, 7, and 9 provide compatibility tests.

---

## File Map

### Configuration and shared primitives

- Modify `apps/api/package.json` — add Resend and bootstrap-owner commands.
- Modify `apps/api/.env.example` — document storefront, admin, and mail configuration.
- Modify `apps/api/src/config/env.ts` — validate exact origins and production email settings.
- Create `apps/api/src/shared/clock.ts` — injectable clock for expiry tests.
- Create `apps/api/src/shared/crypto.ts` — random opaque tokens and SHA-256 hashing.
- Create `apps/api/src/shared/email.ts` — the single canonical email normalization function.
- Create `apps/api/src/shared/client-ip.ts` — one trusted-proxy-aware IP resolver shared by both rate limiters.
- Modify `apps/api/src/shared/logger.ts` — sanitized email/audit logging helpers.

### Database

- Keep generated Better Auth tables in `apps/api/src/database/schema/auth.ts`.
- Create `apps/api/src/database/schema/application-auth.ts` — claims, invitations, rate-limit counters, and audit log.
- Create `apps/api/src/database/schema/index.ts` — aggregate schema exports for Drizzle.
- Modify `apps/api/src/database/client.ts` and `apps/api/drizzle.config.ts` — consume the aggregate schema.
- Create the generated Drizzle migration under `apps/api/drizzle/` — plugin columns/tables, application tables, constraints, indexes, and customer backfill.

### Better Auth and Elysia policy

- Create `apps/api/src/plugins/auth/access-control.ts` — permission statement, roles, validators, and derived capability helpers.
- Create `apps/api/src/plugins/auth/http-policy.ts` — version-controlled method/path allowlist.
- Create `apps/api/src/plugins/auth/session-policy.ts` — staff session validation and activity updates.
- Modify `apps/api/src/plugins/auth/auth.ts` — Better Auth plugins, fields, hooks, email callbacks, and session projection.
- Modify `apps/api/src/plugins/auth/index.ts` — raw handler gate and `auth`, `verifiedCustomer`, `staffAuth`, and `permission` macros.
- Create `apps/api/src/plugins/browser-mutation.ts` — JSON, Origin, and Fetch Metadata enforcement.
- Create `apps/api/src/plugins/request-context.ts` — server-generated request IDs and sanitized request metadata for logs/audits.

### Application modules

- Create `apps/api/src/modules/rate-limit/{repository,service}.ts` — PostgreSQL application limiter.
- Create `apps/api/src/modules/audit/{model,repository,service,index}.ts` — append-only audit writes and authorized reads.
- Create `apps/api/src/modules/identity-claims/{repository,service}.ts` — advisory-lock serialization and state transitions.
- Create `apps/api/src/modules/customer-auth/{model,service,index}.ts` — generic application-owned signup.
- Create `apps/api/src/modules/staff-invitations/{model,repository,service,index}.ts` — invitation lifecycle and acceptance.
- Create `apps/api/src/modules/staff/{model,repository,service,index}.ts` — staff management and owner invariants.
- Create `apps/api/src/modules/staff-mfa/{model,service,index}.ts` — onboarding, recovery, and backup-code operations.
- Create `apps/api/src/modules/email/{sender,templates}.ts` — Resend adapter and message builders.
- Create `apps/api/src/cli/bootstrap-owner.ts` and `apps/api/src/cli/recover-owner-mfa.ts` — audited emergency workflows.
- Modify `apps/api/src/app.ts` and `apps/api/src/index.ts` — dependency composition, modules, and approved OpenAPI paths.

### Tests

- Create `apps/api/test/helpers/{database,http,fakes}.ts` — safe test database setup, cookie requests, fake clock, and fake email.
- Add focused suites: `access-control.test.ts`, `auth-config.test.ts`, `auth-config.integration.test.ts`, `auth-http-policy.test.ts`, `browser-mutation.test.ts`, `identity-claims.test.ts`, `customer-auth.test.ts`, `staff-invitations.test.ts`, `staff-session.test.ts`, `staff-mfa.test.ts`, `staff-admin.test.ts`, `audit.test.ts`, and `rate-limit.test.ts`.
- Modify `apps/api/test/api.test.ts`, `apps/api/test/config.test.ts`, and `apps/api/test/fixtures.ts` for composition and regression coverage.

## Task 1: Configuration, Dependencies, and Deterministic Primitives

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/.env.example`
- Modify: `apps/api/src/config/env.ts`
- Create: `apps/api/src/shared/clock.ts`
- Create: `apps/api/src/shared/crypto.ts`
- Create: `apps/api/src/shared/email.ts`
- Create: `apps/api/src/shared/client-ip.ts`
- Modify: `apps/api/test/config.test.ts`
- Modify: `apps/api/test/fixtures.ts`
- Test: `apps/api/test/primitives.test.ts`

**Interfaces:**
- Produces: `Clock`, `systemClock`, `normalizeEmail(email: string): string`, `createOpaqueToken(bytes?: number): string`, and `hashToken(token: string): string`.
- Produces: `AppConfig.storefrontUrl`, `adminUrl`, `resendApiKey`, `authEmailFrom`, `auditRetentionDays`, and `trustedProxyHeaders`.
- Produces: `resolveClientIp(request, trustedProxyHeaders): string` with the same proxy-header rule used by Better Auth and application limiting.
- Consumes: no new interfaces.

- [ ] **Step 1: Add failing configuration and primitive tests**

```ts
expect(normalizeEmail('\t Alice+shop@Example.COM \r')).toBe('alice+shop@example.com')
expect(normalizeEmail('john.smith@gmail.com')).not.toBe(normalizeEmail('johnsmith@gmail.com'))
expect(hashToken('secret')).toHaveLength(64)

expect(() => loadConfig({ ...productionEnv, ADMIN_URL: undefined })).toThrow('ADMIN_URL')
expect(() => loadConfig({ ...productionEnv, RESEND_API_KEY: undefined })).toThrow('RESEND_API_KEY')
expect(loadConfig(testEnv).auditRetentionDays).toBe(365)
expect(resolveClientIp(spoofedRequest, [])).not.toBe('203.0.113.8')
expect(resolveClientIp(overwrittenProxyRequest, ['x-forwarded-for'])).toBe('203.0.113.8')
```

- [ ] **Step 2: Run the focused tests and confirm the new exports/configuration are missing**

Run: `bun --filter api test test/config.test.ts test/primitives.test.ts`

Expected: FAIL because the new config fields and primitive modules do not exist.

- [ ] **Step 3: Add Resend and implement the exact primitives**

Run: `bun add resend --filter api`

Implement:

```ts
export interface Clock {
  now(): Date
}

export const systemClock: Clock = {
  now: () => new Date(),
}

export const normalizeEmail = (email: string) =>
  email.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').toLowerCase()

export function createOpaqueToken(bytes = 32) {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url')
}

export function hashToken(token: string) {
  return new Bun.CryptoHasher('sha256').update(token).digest('hex')
}
```

Parse `STOREFRONT_URL` and `ADMIN_URL` as HTTP(S) origins without paths, require mail settings in production, default `AUDIT_RETENTION_DAYS` to `365`, and expose safe non-production fake values in `testEnv`. Reject a production storefront/admin origin absent from `CORS_ORIGINS`. Parse `TRUSTED_PROXY_HEADERS` as an explicit lowercase allowlist; the empty default ignores caller-supplied forwarding headers.

- [ ] **Step 4: Document every environment variable**

Add `STOREFRONT_URL`, `ADMIN_URL`, `RESEND_API_KEY`, `AUTH_EMAIL_FROM`, optional `AUDIT_RETENTION_DAYS`, and optional `TRUSTED_PROXY_HEADERS` to `.env.example`. State that production origins must also appear in `CORS_ORIGINS` and that forwarding headers may be enabled only when the deployment proxy overwrites them.

- [ ] **Step 5: Run focused validation**

Run: `bun --filter api test test/config.test.ts test/primitives.test.ts && bun --filter api typecheck && bun --filter api lint`

Expected: all commands PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json bun.lock apps/api/.env.example apps/api/src/config/env.ts apps/api/src/shared/clock.ts apps/api/src/shared/crypto.ts apps/api/src/shared/email.ts apps/api/src/shared/client-ip.ts apps/api/test/config.test.ts apps/api/test/fixtures.ts apps/api/test/primitives.test.ts
git commit -m "Add auth configuration primitives"
```

## Task 2: Canonical Fixed-Role Access Control

**Files:**
- Create: `apps/api/src/plugins/auth/access-control.ts`
- Test: `apps/api/test/access-control.test.ts`

**Interfaces:**
- Produces: `permissions`, `roles`, `AccountType`, `StaffRole`, `Role`, `Permission`, `isStaffRole(value)`, `parseSingleRole(value)`, `hasPermissions(role, requirement)`, and `capabilitiesFor(role)`.
- Consumes: Better Auth `createAccessControl` and `defaultStatements` from the installed Admin plugin.

- [ ] **Step 1: Write table-driven failing tests for every allowed and denied role/action pair**

```ts
const cases: Array<[Role, Permission, boolean]> = [
  ['owner', 'settings:manage-owner', true],
  ['admin', 'settings:manage-owner', false],
  ['catalog_manager', 'catalog:publish', true],
  ['catalog_manager', 'order:refund', false],
  ['fulfillment', 'order:fulfill', true],
  ['fulfillment', 'order:refund', false],
  ['support', 'order:cancel', true],
  ['support', 'order:refund', false],
  ['customer', 'catalog:read', false],
]

expect(() => parseSingleRole(['admin'])).toThrow('INVALID_ROLE')
expect(() => parseSingleRole('admin,owner')).toThrow('INVALID_ROLE')
expect(() => parseSingleRole('unknown')).toThrow('INVALID_ROLE')
```

Also iterate the exported permission statement so every role/permission pair is asserted, not only the examples.

- [ ] **Step 2: Run the test to verify failure**

Run: `bun --filter api test test/access-control.test.ts`

Expected: FAIL because the access-control module does not exist.

- [ ] **Step 3: Implement one source of truth and derive all helpers from it**

```ts
export const permissions = {
  catalog: ['read', 'create', 'update', 'delete', 'publish'],
  inventory: ['read', 'adjust'],
  order: ['read', 'update-address', 'add-note', 'cancel', 'fulfill', 'refund'],
  customer: ['read'],
  staff: ['read', 'invite', 'change-role', 'suspend', 'revoke-session', 'reset-mfa'],
  audit: ['read'],
  settings: ['read', 'update', 'manage-owner'],
} as const
```

Build Better Auth role objects, flat UI capability strings, validation, and Elysia checks from this object. Do not hand-copy the permission matrix into a second file.

- [ ] **Step 4: Run focused validation**

Run: `bun --filter api test test/access-control.test.ts && bun --filter api typecheck && bun --filter api lint`

Expected: PASS with exhaustive matrix coverage.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/plugins/auth/access-control.ts apps/api/test/access-control.test.ts
git commit -m "Define fixed staff access control"
```

## Task 3: Better Auth Security Configuration and Generated Schema

**Files:**
- Modify: `apps/api/src/plugins/auth/auth.ts`
- Modify: `apps/api/src/plugins/auth/cli.ts`
- Modify generated: `apps/api/src/database/schema/auth.ts`
- Create: `apps/api/test/auth-config.test.ts`
- Modify: `apps/api/test/fixtures.ts`

**Interfaces:**
- Consumes: Task 1 config/clock and Task 2 `accessControl`, role objects, and role types.
- Produces: `AuthDependencies`, `createAuth(config, db, dependencies)`, `Auth`, and the generated Admin/2FA/custom user/session schema.
- Defers: migrated-database behavior moves to Task 4; email sender callbacks use an injected interface completed in Task 5.

- [ ] **Step 1: Write failing schema/OpenAPI compatibility tests that need no migrated tables**

Instantiate Better Auth without making a database request, generate its OpenAPI schema, and inspect the generated Drizzle table definitions:

```ts
expect(authSchema.user.accountType).toBeDefined()
expect(authSchema.user.staffActivatedAt).toBeDefined()
expect(authSchema.session.lastActivityAt).toBeDefined()
expect(authSchema.session.absoluteExpiresAt).toBeDefined()
expect(openApi.paths['/two-factor/verify-totp']).toBeDefined()
expect(openApi.paths['/admin/create-user']).toBeDefined()
```

Assert the public sign-up and update-session request schemas omit account type, role, activation, invitation, ban, MFA, idle, and absolute-time fields. Runtime assertions for auto-sign-in, session expiry, reset behavior, callback-origin rejection, and synthetic responses belong in Task 4 after migration.

- [ ] **Step 2: Run the new suite and verify it fails against the current minimal configuration**

Run: `bun --filter api test test/auth-config.test.ts`

Expected: FAIL because Admin, 2FA, Custom Session, additional fields, and hardened email/password options are absent.

- [ ] **Step 3: Configure Better Auth 1.7.5**

Use dedicated plugin imports and these pinned decisions:

```ts
emailAndPassword: {
  enabled: true,
  autoSignIn: false,
  requireEmailVerification: false,
  resetPasswordTokenExpiresIn: 60 * 60,
  revokeSessionsOnPasswordReset: true,
  minPasswordLength: 12,
  maxPasswordLength: 256,
},
session: {
  expiresIn: 60 * 60 * 24 * 30,
  cookieCache: { enabled: false },
  additionalFields: {
    lastActivityAt: { type: 'date', required: false, input: false, returned: false },
    absoluteExpiresAt: { type: 'date', required: false, input: false, returned: false },
  },
},
user: {
  additionalFields: {
    accountType: { type: ['customer', 'staff'], defaultValue: 'customer', input: false, returned: true },
    staffActivatedAt: { type: 'date', required: false, input: false, returned: false },
    sourceInvitationId: { type: 'string', required: false, unique: true, input: false, returned: false },
  },
},
rateLimit: { enabled: true, storage: 'database' },
```

Add `admin({ ac, roles, defaultRole: 'customer' })`, `twoFactor({ issuer: 'Suannn' })`, Custom Session, and OpenAPI. Keep CSRF/origin checks enabled. Configure tighter Better Auth custom rules for sign-in, password-reset request, verification resend, TOTP verification, and backup-code verification. Feed Task 1's same trusted proxy-header allowlist into Better Auth IP handling. Configure host-only, HttpOnly, Secure-in-production cookies with explicit `sameSite: 'lax'` and no cross-subdomain cookies.

Define a complete synthetic user with the same returned shape as a real signup response:

```ts
{
  id: syntheticId,
  name: '',
  email: normalizedEmail,
  emailVerified: false,
  image: null,
  createdAt: fixedSyntheticDate,
  updatedAt: fixedSyntheticDate,
  accountType: 'customer',
  role: 'customer',
  banned: false,
  banReason: null,
  banExpires: null,
  twoFactorEnabled: false,
}
```

- [ ] **Step 4: Regenerate the Better Auth schema and inspect it**

Run: `bun --filter api auth:generate`

Expected generated changes:

- `user`: role, ban fields, `twoFactorEnabled`, `accountType`, `staffActivatedAt`, `sourceInvitationId`.
- `session`: impersonation/admin fields plus `lastActivityAt`, `absoluteExpiresAt`.
- 2FA supporting table.
- Better Auth database rate-limit table.

Reject the generation if `sourceInvitationId` is not unique in the generated table definition; add the uniqueness in the application migration in Task 4 without hand-editing generated output beyond what the generator supports.

- [ ] **Step 5: Make CLI generation use non-network dependencies**

`cli.ts` must instantiate `createAuth` with an email sender that throws only if called and a background handler that attaches a rejection logger. Schema generation must not require a working Resend account.

- [ ] **Step 6: Run focused validation**

Run: `bun --filter api test test/auth-config.test.ts && bun --filter api typecheck && bun --filter api lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/plugins/auth/auth.ts apps/api/src/plugins/auth/cli.ts apps/api/src/database/schema/auth.ts apps/api/test/auth-config.test.ts apps/api/test/fixtures.ts
git commit -m "Harden Better Auth configuration"
```

## Task 4: Application Auth Schema, Migration, and Safe Database Test Harness

**Files:**
- Create: `apps/api/src/database/schema/application-auth.ts`
- Create: `apps/api/src/database/schema/index.ts`
- Modify: `apps/api/src/database/client.ts`
- Modify: `apps/api/drizzle.config.ts`
- Create generated: `apps/api/drizzle/0001_*.sql`
- Create: `apps/api/test/helpers/database.ts`
- Test: `apps/api/test/database-schema.test.ts`
- Test: `apps/api/test/auth-config.integration.test.ts`

**Interfaces:**
- Produces: `identityEmailClaim`, `staffInvitation`, `applicationRateLimit`, `auditLog`, and aggregate `schema` exports.
- Produces: `createTestDatabase()`, `migrateTestDatabase()`, `resetTestDatabase()` guarded to `_test` database names.
- Consumes: generated Better Auth `user` and `session` tables.

- [ ] **Step 1: Write failing database constraint tests**

Test real PostgreSQL behavior for:

```text
customer claim -> user_id required, invitation_id null
pending_staff claim -> invitation_id required, user_id null
staff claim -> user_id required, invitation_id null
only one pending invitation per normalized email
sourceInvitationId uniqueness
customer accountType -> role customer
staff accountType -> one known staff role
comma-separated role rejected
audit rows insert/select successfully
preflight rejects two legacy emails that collapse to one normalized value
```

The helper must abort before any cleanup when `current_database()` does not end in `_test`.

Add migrated-database Better Auth behavior tests here: signup does not issue a session, real and duplicate signup responses have the same public shape, hostile server-owned signup fields do not persist, `update-session` cannot change custom timeout columns, customer sessions use a 30-day expiry, password reset tokens expire after one hour, reset completion revokes existing sessions, and verification/reset callbacks reject origins outside the exact storefront/admin allowlist.

- [ ] **Step 2: Run the schema test and verify it fails**

Run: `bun --filter api test test/database-schema.test.ts test/auth-config.integration.test.ts`

Expected: FAIL because the application tables and migration do not exist.

- [ ] **Step 3: Define application tables with explicit indexes and checks**

Use string enums/check constraints matching exported application types. `staffInvitation.tokenHash` is unique; `acceptedAt` and `revokedAt` are mutually exclusive. Store rate-limit keys as hashes/namespaced opaque strings. Store audit metadata as `jsonb` and timestamp every table in UTC-compatible PostgreSQL timestamps.

- [ ] **Step 4: Aggregate schema imports**

```ts
export * from './auth'
export * from './application-auth'
```

Update `createDatabase()` and `drizzle.config.ts` to use the directory/index instead of only `auth.ts`.

- [ ] **Step 5: Generate and inspect the migration**

Run: `bun --filter api db:generate`

Add explicit SQL where Drizzle cannot express cross-column checks cleanly. Include a safe backfill before `NOT NULL`/check enforcement:

```sql
UPDATE "user"
SET "account_type" = 'customer', "role" = 'customer'
WHERE "account_type" IS NULL OR "role" IS NULL;
```

Before canonicalizing legacy email values, add a migration preflight block that raises when two rows collapse to the same `normalizeEmail()` value. If clean, update stored user emails to the same ASCII-trim/lowercase representation and insert one `customer` identity claim per existing user. The migration must not promote any user to staff.

- [ ] **Step 6: Apply to the test database and run constraint/compatibility tests**

Run: `bun --filter api test test/database-schema.test.ts test/auth-config.integration.test.ts`

Expected: `migrateTestDatabase()` applies committed migrations only to the guarded `_test` database, and both suites PASS. Do not run the normal `db:migrate` script here because it reads the developer's `.env.local` database.

- [ ] **Step 7: Run focused static checks**

Run: `bun --filter api typecheck && bun --filter api lint`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/database apps/api/drizzle.config.ts apps/api/drizzle apps/api/test/helpers/database.ts apps/api/test/database-schema.test.ts apps/api/test/auth-config.integration.test.ts
git commit -m "Add authentication domain schema"
```

## Task 5: Resend Email Adapter and Safe Background Delivery

**Files:**
- Create: `apps/api/src/modules/email/sender.ts`
- Create: `apps/api/src/modules/email/templates.ts`
- Modify: `apps/api/src/plugins/auth/auth.ts`
- Modify: `apps/api/src/shared/logger.ts`
- Create: `apps/api/test/helpers/fakes.ts`
- Test: `apps/api/test/email.test.ts`

**Interfaces:**
- Produces: `EmailSender.send(message): Promise<{ id: string | null }>`, `createResendEmailSender(config)`, `scheduleBackground(task, context)`, and verification/reset/invitation template builders.
- Consumes: Task 1 configuration and Better Auth `advanced.backgroundTasks.handler`.

- [ ] **Step 1: Write failing fake-sender and redaction tests**

```ts
const sender = new FakeEmailSender()
await auth.api.sendVerificationEmail({ body: { email, callbackURL } })
expect(sender.messages[0]).toMatchObject({ to: email, template: 'verify-email' })
expect(JSON.stringify(logger.entries)).not.toContain('token=')
expect(JSON.stringify(logger.entries)).not.toContain(callbackURL)
```

Also reject logs containing `password`, `cookie`, `sessionToken`, `totpSecret`, or `backupCodes`; assert a rejected sender promise is logged once without rejecting the HTTP response.

- [ ] **Step 2: Run tests and verify failure**

Run: `bun --filter api test test/email.test.ts`

Expected: FAIL because no sender/templates exist.

- [ ] **Step 3: Implement the injectable sender and templates**

Templates accept only display values and a URL and return `{ subject, text, html }`. The Resend adapter sends from `AUTH_EMAIL_FROM`. Logs contain only template name, provider message ID after acceptance, and sanitized error category/message.

- [ ] **Step 4: Wire Better Auth email hooks without awaiting delivery**

Use `emailVerification.sendVerificationEmail`, `sendOnSignUp: true`, and `emailAndPassword.sendResetPassword`. Pass each send promise to Better Auth's configured background handler and attach an explicit rejection handler. Do not build a shutdown tracker or imply delivery durability.

- [ ] **Step 5: Run focused validation**

Run: `bun --filter api test test/email.test.ts && bun --filter api typecheck && bun --filter api lint`

Expected: PASS without network access.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/email apps/api/src/plugins/auth/auth.ts apps/api/src/shared/logger.ts apps/api/test/helpers/fakes.ts apps/api/test/email.test.ts
git commit -m "Send authentication email through Resend"
```

## Task 6: Browser Mutation CSRF Policy, Audit Core, and Application Rate Limiter

**Files:**
- Create: `apps/api/src/plugins/browser-mutation.ts`
- Create: `apps/api/src/plugins/request-context.ts`
- Modify: `apps/api/src/plugins/request-logging.ts`
- Create: `apps/api/src/modules/audit/model.ts`
- Create: `apps/api/src/modules/audit/repository.ts`
- Create: `apps/api/src/modules/audit/service.ts`
- Create: `apps/api/src/modules/rate-limit/repository.ts`
- Create: `apps/api/src/modules/rate-limit/service.ts`
- Test: `apps/api/test/browser-mutation.test.ts`
- Test: `apps/api/test/audit.test.ts`
- Test: `apps/api/test/rate-limit.test.ts`

**Interfaces:**
- Produces: Elysia macro `browserMutation: 'storefront' | 'admin'`.
- Produces: `requestContext: { requestId, clientIp, userAgent }` and response `X-Request-ID`; IDs are generated server-side, never trusted from arbitrary browser input.
- Produces: `AuditService.record(tx, event)` and `AuditService.listAuthorized(query)`; no update/delete methods.
- Produces: `RateLimiter.consume({ namespace, subjectHash, ip, limit, windowSeconds }): Promise<RateLimitResult>` and `rateLimitResponse(result)` that sets `Retry-After` on rejection.
- Consumes: Task 1 clock/hash utilities and Task 4 tables.

- [ ] **Step 1: Write failing CSRF tests for every review-focus input**

Create a probe route whose handler increments a counter. Assert the counter stays zero for:

```text
missing Origin
Origin: null
malformed Origin
untrusted Origin
storefront Origin sent to admin route
Content-Type: text/plain
Content-Type: application/x-www-form-urlencoded
Content-Type: multipart/form-data
Sec-Fetch-Site: cross-site
```

Assert exact trusted origin plus `application/json` reaches the handler, and all GET/HEAD probes remain read-only.

- [ ] **Step 2: Write failing audit and rate-limit tests**

Assert metadata rejects forbidden keys recursively, repositories expose no mutation API, transactional rollback removes both domain and audit writes, fixed-window counters work across two service instances, hashed email keys never persist plaintext, and `Retry-After` is deterministic under a fake clock.

- [ ] **Step 3: Run the three suites and verify failure**

Run: `bun --filter api test test/browser-mutation.test.ts test/audit.test.ts test/rate-limit.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement browser mutation enforcement as a named Elysia macro**

Parse `new URL(origin).origin` and require equality with exactly `config.storefrontUrl` or `config.adminUrl`. Require the parsed `Content-Type` media type to equal `application/json`. Return `{ code: 'CSRF_REJECTED', message: 'Request rejected' }` with 403 before authentication or handler execution.

- [ ] **Step 5: Implement append-only audit and atomic PostgreSQL limiting**

Use `INSERT ... ON CONFLICT ... DO UPDATE` for the limiter with a window start and expiry; the update must be atomic. Derive its IP with Task 1's shared resolver. Audit metadata uses a positive allowlist per action, not only a blacklist. Export insert and authorized select operations only. Add request context before logging/routes so auth/security audit events receive request ID, resolved IP, and sanitized user agent; ordinary business events omit IP/user agent unless their event schema explicitly permits them.

- [ ] **Step 6: Run focused validation**

Run: `bun --filter api test test/browser-mutation.test.ts test/audit.test.ts test/rate-limit.test.ts && bun --filter api typecheck && bun --filter api lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/plugins/browser-mutation.ts apps/api/src/plugins/request-context.ts apps/api/src/plugins/request-logging.ts apps/api/src/modules/audit apps/api/src/modules/rate-limit apps/api/test/browser-mutation.test.ts apps/api/test/audit.test.ts apps/api/test/rate-limit.test.ts
git commit -m "Add API security infrastructure"
```

## Task 7: Default-Deny Better Auth HTTP Surface and Typed Session Guards

**Files:**
- Create: `apps/api/src/plugins/auth/http-policy.ts`
- Create: `apps/api/src/plugins/auth/session-policy.ts`
- Modify: `apps/api/src/plugins/auth/auth.ts`
- Modify: `apps/api/src/plugins/auth/index.ts`
- Test: `apps/api/test/auth-http-policy.test.ts`
- Test: `apps/api/test/staff-session.test.ts`

**Interfaces:**
- Produces: `isAllowedAuthRequest(request): boolean`, `validateStaffSession(context)`, `touchStaffSession(sessionId)`, and Elysia macros `auth`, `verifiedCustomer`, `staffAuth`, and `permission`.
- Produces: `IdentityReservationLookup.findState(normalizedEmail)` dependency contract; Task 8's claim service supplies the production implementation while this task uses a fake.
- Consumes: Task 2 permissions, Task 3 Auth, Task 4 database schema, Task 6 audit service.

- [ ] **Step 1: Write the failing endpoint-policy snapshot**

Pin the approved method/path pairs:

```text
GET  /ok
GET  /get-session
POST /sign-in/email
POST /sign-out
GET  /verify-email
POST /send-verification-email
POST /request-password-reset
GET  /reset-password/:token
POST /reset-password
POST /change-password
POST /update-user
GET  /list-sessions
POST /revoke-session
POST /revoke-other-sessions
POST /revoke-sessions
POST /two-factor/verify-totp
POST /two-factor/verify-backup-code
```

Assert 404/denial for `/sign-up/email`, `/change-email`, `/update-session`, `/delete-user`, every `/admin/*`, raw enable/disable/TOTP URI/backup generation, social/account linking, impersonation, and an invented future plugin route. Assert route parameters match only the intended reset callback.

- [ ] **Step 2: Write failing guard/session tests**

Cover unauthenticated, customer-on-staff-route, inactive staff, unverified staff, banned staff, missing timeout fields, idle expiry, absolute expiry, exact permission allow/deny, and activity writes only when at least 60 seconds old. Every invalid staff session is revoked and returns the stable error envelope.

- [ ] **Step 3: Run the two suites and verify failure**

Run: `bun --filter api test test/auth-http-policy.test.ts test/staff-session.test.ts`

Expected: FAIL against the unrestricted catch-all and basic macro.

- [ ] **Step 4: Implement the raw handler gate before `auth.handler`**

Normalize the URL to a path relative to `/api/v1/auth`, match method plus explicit static/template pattern, and return the standard not-found envelope for denied endpoints. Do not authorize by prefix. Before forwarding sign-in, clone/rebuild the JSON request with canonical email and reject `pending_staff` generically through the injected `IdentityReservationLookup`. Before forwarding 2FA challenge verification, reject `trustDevice: true` and require Better Auth's pending sign-in challenge cookie with no active full session. For every other allowlisted endpoint that receives a full staff session, apply the same active-account and timeout policy before forwarding; keep sign-out available so an expired session can still be cleared.

- [ ] **Step 5: Implement staff session policy, macros, and supported auth audit hooks**

Return typed context only after all checks. `permission` accepts the structured declaration used by the route and requires every action. On valid staff activity, perform a compare-and-update so concurrent requests do not generate repeated writes. Use the same policy function from the Custom Session projection. Use Better Auth supported hooks to record session creation/revocation, email verification, password reset, and useful denied authentication/security events through the redacted audit service; hooks may never record credentials, tokens, URLs, TOTP material, or backup codes.

- [ ] **Step 6: Implement the explicit Custom Session projection**

Return only:

```ts
type PublicSession = {
  session: { id: string, expiresAt: Date }
  user: {
    id: string
    name: string
    email: string
    emailVerified: boolean
    image: string | null
    accountType: 'customer' | 'staff'
  }
  staff?: { role: StaffRole, permissions: readonly Permission[] }
}
```

For invalid staff state, revoke and return `401 SESSION_EXPIRED` with no staff projection. Add tests that enumerate forbidden plugin/security fields and ensure none are serialized.

- [ ] **Step 7: Run focused validation**

Run: `bun --filter api test test/auth-http-policy.test.ts test/staff-session.test.ts && bun --filter api typecheck && bun --filter api lint`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/plugins/auth apps/api/test/auth-http-policy.test.ts apps/api/test/staff-session.test.ts
git commit -m "Guard the authentication HTTP surface"
```

## Task 8: Serialized Customer Signup and Verified-Customer Guard

**Files:**
- Create: `apps/api/src/modules/identity-claims/repository.ts`
- Create: `apps/api/src/modules/identity-claims/service.ts`
- Create: `apps/api/src/modules/customer-auth/model.ts`
- Create: `apps/api/src/modules/customer-auth/service.ts`
- Create: `apps/api/src/modules/customer-auth/index.ts`
- Modify: `apps/api/src/plugins/auth/index.ts`
- Test: `apps/api/test/identity-claims.test.ts`
- Test: `apps/api/test/customer-auth.test.ts`

**Interfaces:**
- Produces: `IdentityClaimService.withEmailClaim(email, callback)`, `signupCustomer(command)`, and the reusable `verifiedCustomer` macro.
- Consumes: Task 1 normalization/hash, Task 3 `auth.api.signUpEmail`, Task 4 claim table, Task 6 limiter, Task 7 auth plugin.

- [ ] **Step 1: Write failing advisory-lock and normalization tests**

Capture the SQL parameters and assert the lock key is derived from normalized email. Prove all of these normalize identically: signup, claim lookup, sign-in reservation lookup, and rate-limit subject. Prove Gmail dots and plus tags remain distinct.

- [ ] **Step 2: Write failing public signup tests**

Assert a new customer, existing customer, existing staff, and pending invitation all return the same status/body shape with no token. Assert hostile server-owned fields are discarded. Assert the occupied paths execute the configured dummy password hash. Assert successful signup creates one `customer` claim and verification email.

- [ ] **Step 3: Add real concurrency tests**

Use two database connections and `Promise.allSettled()` to issue same-email signup attempts. Assert one user, one claim, no inconsistent references, and indistinguishable public responses.

- [ ] **Step 4: Run suites and verify failure**

Run: `bun --filter api test test/identity-claims.test.ts test/customer-auth.test.ts`

Expected: FAIL because the services/routes do not exist.

- [ ] **Step 5: Implement the claim transaction boundary**

Within one PostgreSQL transaction, acquire `pg_advisory_xact_lock` using a stable 64-bit hash of normalized email, lazily expire overdue pending invitations, inspect both claim and user tables, and invoke the transition callback. Repair a missing claim for an already-created user instead of making the address available.

- [ ] **Step 6: Implement `POST /api/v1/customer-auth/sign-up`**

Apply `browserMutation: 'storefront'`, application rate limit, strict body/response schemas, and the claim lock before the Better Auth server call. Always return a constant public response such as:

```ts
{ accepted: true, next: 'sign-in' as const }
```

Do not forward caller headers to the server-side sign-up API. Preserve Better Auth's hashing and hooks. Insert the customer claim after successful creation while the lock is held.

- [ ] **Step 7: Complete verified-customer behavior**

The macro requires a current customer session and `emailVerified=true`; otherwise return `401 AUTHENTICATION_REQUIRED` or `403 EMAIL_VERIFICATION_REQUIRED`. It exposes only the typed public user/session context for future order claiming.

- [ ] **Step 8: Run focused validation**

Run: `bun --filter api test test/identity-claims.test.ts test/customer-auth.test.ts && bun --filter api typecheck && bun --filter api lint`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/identity-claims apps/api/src/modules/customer-auth apps/api/src/plugins/auth/index.ts apps/api/test/identity-claims.test.ts apps/api/test/customer-auth.test.ts
git commit -m "Add serialized customer signup"
```

## Task 9: Staff Invitation Lifecycle, Acceptance, and Owner Bootstrap

**Files:**
- Create: `apps/api/src/modules/staff-invitations/model.ts`
- Create: `apps/api/src/modules/staff-invitations/repository.ts`
- Create: `apps/api/src/modules/staff-invitations/service.ts`
- Create: `apps/api/src/modules/staff-invitations/index.ts`
- Create: `apps/api/src/cli/bootstrap-owner.ts`
- Modify: `apps/api/package.json`
- Test: `apps/api/test/staff-invitations.test.ts`
- Test: `apps/api/test/bootstrap-owner.test.ts`

**Interfaces:**
- Produces: `StaffInvitationService.create`, `.resend`, `.cancel`, `.accept`, and CLI command `auth:bootstrap-owner`.
- Consumes: claim service, `auth.api.createUser`, `auth.api.signInEmail`, email sender, audit, limiter, clock, crypto, and staff role validation.

- [ ] **Step 1: Write failing invitation lifecycle tests**

Cover creation, 48-hour expiry, token hashing, one pending invite, resend token rotation, old-token invalidation, cancellation and expiry releasing the claim, role validation, and sanitized email output. Test actor/target audit rows in the same transaction.

- [ ] **Step 2: Write failing acceptance and compatibility tests**

Call documented `auth.api.createUser()` without browser headers and assert:

```text
accountType=staff persists
exactly one role persists
email is verified
sourceInvitationId persists and is unique
credential password authenticates
supported Better Auth hooks run
no session exists until the acceptance flow explicitly signs in
raw /admin/create-user remains denied
```

Retry after a simulated failure between user creation and invitation transition; recognize the user by `sourceInvitationId`, finish the claim/invite transition, and never create a duplicate.

- [ ] **Step 3: Add cross-flow concurrency tests**

Run invite vs customer signup and invitation acceptance vs customer signup concurrently on separate database connections. Also run double acceptance. Assert exactly one identity owner and at most one successful transition in every case.

- [ ] **Step 4: Run suites and verify failure**

Run: `bun --filter api test test/staff-invitations.test.ts test/bootstrap-owner.test.ts`

Expected: FAIL because invitation services/routes/CLI do not exist.

- [ ] **Step 5: Implement invitation services and routes**

Routes:

```text
GET  /api/v1/staff/invitations                staffAuth + staff:read
POST /api/v1/staff/invitations                staffAuth + staff:invite + admin CSRF
POST /api/v1/staff/invitations/:id/resend     staffAuth + staff:invite + admin CSRF
POST /api/v1/staff/invitations/:id/cancel     staffAuth + staff:invite + admin CSRF
POST /api/v1/staff/invitations/accept         public + admin CSRF + token rate limit
```

Never store or log the raw token. Acceptance uses the documented server API with exactly `{ email, password, name, role, data }`, marks the invitation/claim after user creation, then calls `auth.api.signInEmail({ returnHeaders: true })` to establish the restricted session and forwards only the resulting `Set-Cookie` headers.

- [ ] **Step 6: Implement the first-owner bootstrap command through the same service**

The command accepts an email, requires there to be no existing owner, creates an owner invitation, schedules the same email, and writes a system audit event. It must not accept a password or write directly to user/auth tables.

- [ ] **Step 7: Run focused validation**

Run: `bun --filter api test test/staff-invitations.test.ts test/bootstrap-owner.test.ts && bun --filter api typecheck && bun --filter api lint`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/staff-invitations apps/api/src/cli/bootstrap-owner.ts apps/api/package.json apps/api/test/staff-invitations.test.ts apps/api/test/bootstrap-owner.test.ts
git commit -m "Add invite-only staff provisioning"
```

## Task 10: Mandatory MFA, Restricted Onboarding, and Non-Sliding Staff Sessions

**Files:**
- Create: `apps/api/src/modules/staff-mfa/model.ts`
- Create: `apps/api/src/modules/staff-mfa/service.ts`
- Create: `apps/api/src/modules/staff-mfa/index.ts`
- Modify: `apps/api/src/plugins/auth/session-policy.ts`
- Modify: `apps/api/src/plugins/auth/auth.ts`
- Create: `apps/api/src/cli/recover-owner-mfa.ts`
- Modify: `apps/api/package.json`
- Test: `apps/api/test/staff-mfa.test.ts`
- Expand: `apps/api/test/staff-session.test.ts`

**Interfaces:**
- Produces: onboarding/recovery guards, `StaffMfaService.beginEnrollment`, `.verifyEnrollment`, `.regenerateBackupCodes`, `.resetForRecovery`, and CLI `auth:recover-owner-mfa`.
- Consumes: Better Auth `auth.api.enableTwoFactor`, `verifyTOTP`, `generateBackupCodes`, session repository, audit, and fake clock.

- [ ] **Step 1: Write failing onboarding-scope tests**

An inactive authenticated staff session may only call onboarding state, enrollment, enrollment verification, and sign-out. Assert it cannot call normal staff, invitation, audit, or admin operations. Active/customer/anonymous sessions cannot use onboarding endpoints.

- [ ] **Step 2: Write failing trusted-device and backup-code tests**

Assert both raw challenge endpoints reject `trustDevice: true`, accept omitted/false only for a pending sign-in challenge, and never set a trusted-device cookie. Assert a backup code is single-use and initial backup codes are returned only once. Assert raw enable/disable/generation/view paths stay denied and spy on the server API to prove application code never calls `viewBackupCodes`.

- [ ] **Step 3: Write failing absolute-time tests with a fake clock**

```text
10:00 password + MFA completes -> absolute 18:00
14:00 refresh/rotation -> absolute remains 18:00
17:50 backup regeneration/rotation -> absolute remains 18:00
18:00 request -> reject and revoke
30 minutes idle -> reject and revoke
null lastActivityAt or absoluteExpiresAt -> reject and revoke
new full password + MFA after sign-out -> new eight-hour window
```

- [ ] **Step 4: Run suites and verify failure**

Run: `bun --filter api test test/staff-mfa.test.ts test/staff-session.test.ts`

Expected: FAIL because application-owned MFA routes and lifecycle hooks are missing.

- [ ] **Step 5: Implement purpose-specific MFA routes**

```text
GET  /api/v1/staff/onboarding
POST /api/v1/staff/onboarding/totp
POST /api/v1/staff/onboarding/totp/verify
POST /api/v1/staff/mfa/backup-codes/regenerate
```

All mutations use admin CSRF and application rate limiting. Forward session headers only to the documented server API that needs them; always force `trustDevice: false`. Filter responses so TOTP secrets/URIs and backup codes are returned only on their intended one-time screen and never logged/audited.

- [ ] **Step 6: Anchor and preserve staff session deadlines**

On completion of password-plus-MFA, set `lastActivityAt=now` and `absoluteExpiresAt=now+8h`. For rotations, locate the predecessor and copy its absolute value exactly. If the predecessor cannot be proven, revoke/reject instead of calculating a new deadline. Keep idle touching independent and at most once per minute.

- [ ] **Step 7: Implement audited final-owner recovery CLI**

Require an explicit owner user ID, verify it is the active final owner, clear MFA state, revoke sessions, send recovery enrollment mail, and insert a system audit event. Never reveal the previous secret/codes and never create a bypass session.

- [ ] **Step 8: Run focused validation**

Run: `bun --filter api test test/staff-mfa.test.ts test/staff-session.test.ts && bun --filter api typecheck && bun --filter api lint`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/staff-mfa apps/api/src/plugins/auth apps/api/src/cli/recover-owner-mfa.ts apps/api/package.json apps/api/test/staff-mfa.test.ts apps/api/test/staff-session.test.ts
git commit -m "Require MFA for staff sessions"
```

## Task 11: Staff Administration and Owner Invariants

**Files:**
- Create: `apps/api/src/modules/staff/model.ts`
- Create: `apps/api/src/modules/staff/repository.ts`
- Create: `apps/api/src/modules/staff/service.ts`
- Create: `apps/api/src/modules/staff/index.ts`
- Create: `apps/api/src/modules/audit/index.ts`
- Test: `apps/api/test/staff-admin.test.ts`
- Expand: `apps/api/test/audit.test.ts`

**Interfaces:**
- Produces: list staff, change one role, suspend/reactivate, revoke sessions, reset MFA, own-session list/revoke, and authorized audit query routes.
- Consumes: `staffAuth`, permissions, Better Auth server APIs/repositories, audit, and PostgreSQL transactions.

- [ ] **Step 1: Write failing target-invariant tests**

Cover self role-change denial, admin acting on owner denial, only owner assigning/transferring owner, final active owner protection, one-role validation, session revocation after role/suspension/MFA reset, and admin reset-MFA rules.

- [ ] **Step 2: Write real concurrent owner tests**

Using two database connections, concurrently suspend/demote two owners. Lock active owner rows in a deterministic order and assert at least one owner remains active. The losing request returns `409 OWNER_INVARIANT` and leaves no audit success row.

- [ ] **Step 3: Write failing permission and audit-query route tests**

Assert every endpoint declares its structured permission, customers cannot call routes directly, support/catalog/fulfillment are denied, admins cannot target owners, audit reads require `audit:read`, and denied security-significant attempts produce redacted audit entries.

- [ ] **Step 4: Run the suite and verify failure**

Run: `bun --filter api test test/staff-admin.test.ts test/audit.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 5: Implement routes through domain services**

```text
GET   /api/v1/staff
PATCH /api/v1/staff/:id/role
POST  /api/v1/staff/:id/suspend
POST  /api/v1/staff/:id/reactivate
POST  /api/v1/staff/:id/sessions/revoke
POST  /api/v1/staff/:id/mfa/reset
GET   /api/v1/staff/sessions
POST  /api/v1/staff/sessions/:id/revoke
GET   /api/v1/audit
```

Every mutation applies admin browser policy, application limiter, staff guard, permission, target invariant, transaction, session revocation, and audit in that order. Use Better Auth documented APIs when they preserve the transaction/invariant; otherwise use a narrowly scoped repository transition already represented in tests—never expose an internal adapter or raw Admin route.

Register static `/staff/sessions` routes before parameterized `/staff/:id` routes and pin both paths in route tests so `sessions` can never be interpreted as a staff ID.

- [ ] **Step 6: Run focused validation**

Run: `bun --filter api test test/staff-admin.test.ts test/audit.test.ts && bun --filter api typecheck && bun --filter api lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/staff apps/api/src/modules/audit/index.ts apps/api/test/staff-admin.test.ts apps/api/test/audit.test.ts
git commit -m "Add guarded staff administration"
```

## Task 12: Application Composition, Approved OpenAPI, Documentation, and Full Verification

**Files:**
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/test/api.test.ts`
- Modify: `apps/api/README.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: all prior modules and dependencies.
- Produces: final `createApp(config, dependencies)` composition and exported Eden `App` type.

- [ ] **Step 1: Update composition tests before wiring modules**

Assert all application routes appear in OpenAPI with stable tags, only allowlisted Better Auth operations are documented, internal/raw Admin and 2FA routes are absent, health/CORS/not-found behavior is unchanged, and no legacy path reappears.

- [ ] **Step 2: Run the API test and verify failure**

Run: `bun --filter api test test/api.test.ts`

Expected: FAIL because modules and filtered auth documentation are not composed yet.

- [ ] **Step 3: Compose dependencies explicitly**

Create the database, email sender, clock, audit service, limiter, identity claims, invitation/customer/staff/MFA services, and Better Auth once in `index.ts`; pass a dependency object to `createApp`. In tests, pass the fake clock/sender and test database. Keep Elysia chaining intact so the exported `App` retains every route type.

- [ ] **Step 4: Filter Better Auth OpenAPI with the same policy source**

Generate Better Auth schema, retain only operations accepted by `http-policy.ts`, prefix with `/api/v1/auth`, and tag them `Authentication`. Do not maintain a second endpoint list in `app.ts`.

- [ ] **Step 5: Update operational documentation**

Document:

- required environment variables and verified Resend sender;
- `auth:generate`, `db:generate`, `db:migrate`, `auth:bootstrap-owner`, and `auth:recover-owner-mfa` commands;
- exact customer signup and staff onboarding route sequence;
- application-append-only audit semantics and 365-day operational retention;
- V1 best-effort email limitation;
- requirement that proxy headers are trusted only when the proxy overwrites them;
- migration order and the fact that no existing user is promoted to staff.

- [ ] **Step 6: Run the complete API suite**

Run: `bun --filter api test`

Expected: PASS, including real database races and fake email/time tests.

- [ ] **Step 7: Run all API static validation**

Run: `bun --filter api typecheck && bun --filter api lint`

Expected: PASS.

- [ ] **Step 8: Inspect migration and public surface manually**

Run:

```bash
git diff --check
git diff -- apps/api/drizzle
rg -n "password|sessionToken|inviteToken|totpSecret|backupCodes" apps/api/src/modules/audit apps/api/src/shared/logger.ts
```

Expected: no whitespace errors; migration contains only intended auth/application schema changes and customer backfill; any secret-related matches are rejection/redaction rules, not logged values.

- [ ] **Step 9: Run workspace regression checks**

Run: `bun run check`

Expected: API tests/typecheck/lint and both frontend builds pass. If the pre-existing admin login file fails independently, report it without modifying or staging that user-owned change.

- [ ] **Step 10: Commit the composition and docs**

```bash
git add apps/api/src/app.ts apps/api/src/index.ts apps/api/test/api.test.ts apps/api/README.md README.md
git commit -m "Complete authentication subsystem"
```

## Execution Notes

- Before Task 1 execution, use `superpowers:using-git-worktrees` to isolate the feature from the current dirty admin-login worktree.
- During execution, use `superpowers:test-driven-development` for every task and `superpowers:verification-before-completion` before each completion claim.
- Keep migrations generated and reviewed, not handwritten from scratch; only add explicit SQL needed for backfill/checks the generator cannot express.
- If Better Auth 1.7.5's documented server API cannot preserve a required field or lifecycle invariant, stop and write a version-pinned compatibility decision for review. Do not silently switch to `internalAdapter`.
- This plan intentionally denies email change in V1. A future email-change feature must atomically move the `identityEmailClaim`, re-verify ownership, handle pending invitations, and revoke sessions; it needs its own design amendment.
- Frontend auth clients, customer screens, admin onboarding screens, route loaders, and permission-based navigation are a separate implementation plan built against the final Eden/Custom Session contract.
