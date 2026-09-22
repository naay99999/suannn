# API Hardening and Structure Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Bun/Elysia API fail closed in production, preserve correct Better Auth HTTP semantics, publish explicit route contracts, and provide portable test workflows without changing existing endpoints or successful response payloads.

**Architecture:** Keep `src/app.ts` as the composition root and each Elysia module as its HTTP controller. Add small shared adapters for configuration, Better Auth errors, and common HTTP schemas; split the Better Auth factory by responsibility only after behavioral hardening is covered. Keep database-backed integration tests explicit and separate from unit tests.

**Tech Stack:** Bun 1.3, TypeScript 6, Elysia 1.4, Better Auth 1.7.5, Drizzle ORM/PostgreSQL, Bun test, Oxlint.

**Spec:** `docs/superpowers/specs/2026-09-22-api-hardening-refactor-design.md`

## Global Constraints

- Preserve every existing `/api/v1` URL and HTTP method.
- Preserve successful frontend-facing payloads, cookie names, staff authorization rules, and the `App` export from `src/app.ts`.
- Do not accept a Better Auth or application database schema change; generated `src/database/schema/auth.ts` must remain unchanged.
- Do not add dependencies.
- Keep strict TypeScript, two-space indentation, single quotes, no semicolons, and existing import conventions.
- Never expose raw Better Auth messages, exception messages, stack traces, credentials, cookies, tokens, TOTP secrets, or backup codes.
- Do not touch the user's existing `apps/admin/src/pages/login/_components/login-form.tsx` change.
- Follow RED-GREEN TDD for every behavioral change.

## Review Focus

- A production `BETTER_AUTH_URL` containing credentials, a path, query, fragment, or HTTP must fail during configuration loading; Task 1 tests every shape.
- An unrecognized Better Auth `APIError` status must fall through to the sanitized 500 path rather than being mislabeled as a client error; Task 2 tests it.
- Missing session, customer session, active staff without permission, and authorized staff must remain distinct; Task 2 tests all four cases.
- Date and nullable fields returned by repositories must satisfy Elysia response validation and serialize with the existing JSON shape; Task 3 route tests exercise representative null and date values.
- A `TEST_DATABASE_URL` pointing at a database without an `_test` suffix must still be rejected before any destructive reset; Task 5 preserves and tests this guard.

---

### Task 1: Fail-closed auth configuration and correct local origins

**Files:**
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/plugins/auth/auth.ts`
- Modify: `apps/api/test/config.test.ts`
- Modify: `apps/api/test/api.test.ts`
- Modify: `apps/api/test/fixtures.ts`

**Interfaces:**
- Consumes: existing `loadConfig(env): AppConfig` and `createAuth(config, db, dependencies)`.
- Produces: `AppConfig.secureCookies: boolean`; corrected `developmentCorsOrigins`; origin-only `betterAuthUrl`.

- [ ] **Step 1: Add failing configuration and CORS tests**

Add these cases to `test/config.test.ts` and update existing expected `AppConfig` objects with `secureCookies: false` for `testEnv` and `secureCookies: true` for production:

```ts
it('rejects insecure or non-origin Better Auth URLs in production', () => {
  const productionEnv = {
    ...testEnv,
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://store.example.com,https://admin.example.com',
    STOREFRONT_URL: 'https://store.example.com',
    ADMIN_URL: 'https://admin.example.com',
  }

  expect(() => loadConfig({ ...productionEnv, BETTER_AUTH_URL: 'http://api.example.com' }))
    .toThrow('BETTER_AUTH_URL must use HTTPS in production')
  expect(() => loadConfig({ ...productionEnv, BETTER_AUTH_URL: 'https://user@api.example.com' }))
    .toThrow('BETTER_AUTH_URL must be an HTTP(S) origin without a path')
  expect(() => loadConfig({ ...productionEnv, BETTER_AUTH_URL: 'https://api.example.com/auth' }))
    .toThrow('BETTER_AUTH_URL must be an HTTP(S) origin without a path')
  expect(() => loadConfig({ ...productionEnv, BETTER_AUTH_URL: 'https://api.example.com?mode=test' }))
    .toThrow('BETTER_AUTH_URL must be an HTTP(S) origin without a path')
  expect(() => loadConfig({ ...productionEnv, BETTER_AUTH_URL: 'https://api.example.com#auth' }))
    .toThrow('BETTER_AUTH_URL must be an HTTP(S) origin without a path')
})

it('allows local HTTP auth while deriving secure cookies from HTTPS', () => {
  expect(loadConfig(testEnv).secureCookies).toBe(false)
  expect(loadConfig({ ...testEnv, BETTER_AUTH_URL: 'https://api.example.com' }).secureCookies).toBe(true)
})
```

Extend `test/api.test.ts` CORS coverage:

```ts
it('allows every configured local preview origin', async () => {
  for (const origin of [
    'http://localhost:4183',
    'http://127.0.0.1:4183',
    'http://localhost:4184',
    'http://127.0.0.1:4184',
  ]) {
    const response = await app.handle(new Request('http://localhost/api/v1/health', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
    }))

    expect(response.headers.get('access-control-allow-origin')).toBe(origin)
  }
})
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `cd apps/api && bun test test/config.test.ts test/api.test.ts`

Expected: FAIL because `secureCookies` does not exist, production HTTP is accepted, and `127.0.0.1:4183`/`:4184` are absent.

- [ ] **Step 3: Implement strict origin parsing and cookie selection**

In `AppConfig`, add:

```ts
secureCookies: boolean
```

Correct `developmentCorsOrigins` to use `4183` and `4184` for both host forms. Parse `BETTER_AUTH_URL` with `parseOrigin`, reject non-HTTPS production values, and return the derived flag:

```ts
const betterAuthUrl = parseOrigin(
  'BETTER_AUTH_URL',
  requiredValue('BETTER_AUTH_URL', env.BETTER_AUTH_URL),
)

if (isProduction && !betterAuthUrl.startsWith('https://')) {
  throw new Error('BETTER_AUTH_URL must use HTTPS in production')
}

return {
  host: env.HOST?.trim() || '0.0.0.0',
  port: parsePort(env.PORT),
  corsOrigins: corsOrigins.length > 0 ? corsOrigins : developmentCorsOrigins,
  databaseUrl,
  betterAuthSecret,
  betterAuthUrl,
  secureCookies: isProduction || betterAuthUrl.startsWith('https://'),
  storefrontUrl,
  adminUrl,
  resendApiKey: requiredValue('RESEND_API_KEY', env.RESEND_API_KEY),
  authEmailFrom: requiredValue('AUTH_EMAIL_FROM', env.AUTH_EMAIL_FROM),
  auditRetentionDays: parsePositiveInteger('AUDIT_RETENTION_DAYS', env.AUDIT_RETENTION_DAYS, 365),
  trustedProxyHeaders: parseTrustedProxyHeaders(env.TRUSTED_PROXY_HEADERS),
}
```

In `plugins/auth/auth.ts`, remove the local URL check and use the validated setting for both Better Auth options:

```ts
advanced: {
  useSecureCookies: config.secureCookies,
  defaultCookieAttributes: {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'lax',
  },
}
```

- [ ] **Step 4: Run focused and static verification**

Run: `cd apps/api && bun test test/config.test.ts test/api.test.ts && bun run typecheck && bun run lint`

Expected: all selected tests pass; typecheck and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/config/env.ts apps/api/src/plugins/auth/auth.ts apps/api/test/config.test.ts apps/api/test/api.test.ts apps/api/test/fixtures.ts
git commit -m "Harden API auth configuration"
```

### Task 2: Normalize Better Auth failures and authorization statuses

**Files:**
- Create: `apps/api/src/plugins/auth/api-error.ts`
- Modify: `apps/api/src/plugins/error-handling.ts`
- Modify: `apps/api/src/plugins/auth/index.ts`
- Modify: `apps/api/test/api.test.ts`
- Modify: `apps/api/test/staff-session.test.ts`

**Interfaces:**
- Consumes: Better Auth `isAPIError(error)` and `APIError.statusCode`.
- Produces: `mapAuthApiError(error): { status: 400 | 401 | 403 | 404 | 409 | 422 | 429; body: { code: string; message: string }; headers?: Record<string, string> } | null`.

- [ ] **Step 1: Add failing API-error mapping tests**

In `test/api.test.ts`, import `APIError` and add:

```ts
it('maps expected Better Auth API errors without exposing their messages', async () => {
  const authErrorApp = new Elysia()
    .use(createErrorHandlingPlugin())
    .get('/invalid', () => {
      throw new APIError('BAD_REQUEST', { code: 'INVALID_PASSWORD', message: 'sensitive detail' })
    })
    .get('/limited', () => {
      throw new APIError('TOO_MANY_REQUESTS', {
        code: 'LOCKED',
        message: 'sensitive detail',
      }, { 'Retry-After': '30' })
    })

  const invalid = await authErrorApp.handle(new Request('http://localhost/invalid'))
  const limited = await authErrorApp.handle(new Request('http://localhost/limited'))

  expect(invalid.status).toBe(400)
  expect(await invalid.json()).toEqual({
    code: 'AUTH_REQUEST_INVALID',
    message: 'Authentication request is invalid',
  })
  expect(limited.status).toBe(429)
  expect(limited.headers.get('retry-after')).toBe('30')
  expect(await limited.json()).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests' })
})

it('treats unknown Better Auth statuses as internal errors', async () => {
  const app = new Elysia()
    .use(createErrorHandlingPlugin())
    .get('/', () => {
      throw new APIError('IM_A_TEAPOT' as never, { message: 'do not expose me' })
    })
  const response = await app.handle(new Request('http://localhost/'))

  expect(response.status).toBe(500)
  expect(await response.json()).toEqual({ code: 'INTERNAL_ERROR', message: 'Internal server error' })
})
```

- [ ] **Step 2: Add failing permission-macro tests**

In `test/staff-session.test.ts`, build small Elysia apps using `createAuthMacros` and stubbed `auth.api.getSession`. Assert:

```ts
expect(unauthenticated.status).toBe(401)
expect(await unauthenticated.json()).toEqual({ code: 'SESSION_EXPIRED', message: 'Session expired' })
expect(customer.status).toBe(403)
expect(activeWithoutPermission.status).toBe(403)
expect(authorized.status).toBe(200)
```

Use `{ permission: { audit: ['read'] } }` on the test route. The authorized stub uses `staff: { role: 'owner', permissions: [] }`; the insufficient stub uses role `support`.

- [ ] **Step 3: Run focused tests and confirm RED**

Run: `cd apps/api && bun test test/api.test.ts test/staff-session.test.ts`

Expected: FAIL because `APIError` is treated as 500 and a missing session receives 403.

- [ ] **Step 4: Implement the safe mapper**

Create `plugins/auth/api-error.ts` with the exact public mapping:

```ts
import { isAPIError } from 'better-auth/api'

const mappedErrors = {
  400: { code: 'AUTH_REQUEST_INVALID', message: 'Authentication request is invalid' },
  401: { code: 'AUTHENTICATION_FAILED', message: 'Authentication failed' },
  403: { code: 'AUTHORIZATION_FAILED', message: 'Authentication request is not allowed' },
  404: { code: 'AUTH_RESOURCE_NOT_FOUND', message: 'Authentication resource not found' },
  409: { code: 'AUTH_CONFLICT', message: 'Authentication request conflicts with current state' },
  422: { code: 'AUTH_REQUEST_INVALID', message: 'Authentication request is invalid' },
  429: { code: 'RATE_LIMITED', message: 'Too many requests' },
} as const

export function mapAuthApiError(error: unknown) {
  if (!isAPIError(error)) return null

  const status = error.statusCode as keyof typeof mappedErrors
  const body = mappedErrors[status]
  if (!body) return null

  const headers = error.headers as Headers | Record<string, string> | undefined
  const retryAfter = headers instanceof Headers
    ? headers.get('retry-after')
    : headers?.['Retry-After'] ?? headers?.['retry-after']

  return {
    status,
    body,
    ...(retryAfter ? { headers: { 'Retry-After': retryAfter } } : {}),
  }
}
```

If the installed `APIError.headers` type is a plain record rather than `Headers`, adjust only the header-read expression while preserving this function signature and behavior.

Call `mapAuthApiError` before the generic logging branch in `error-handling.ts`; copy returned headers into `set.headers`, set the status, and return the mapped body.

In the `permission` macro, split the checks:

```ts
if (!current?.staff) {
  return current
    ? status(403, { code: 'FORBIDDEN', message: 'Forbidden' })
    : status(401, { code: 'SESSION_EXPIRED', message: 'Session expired' })
}

if (!hasPermissions(current.staff.role as Role, requirement)) {
  return status(403, { code: 'FORBIDDEN', message: 'Forbidden' })
}
```

- [ ] **Step 5: Run focused and static verification**

Run: `cd apps/api && bun test test/api.test.ts test/staff-session.test.ts test/staff-mfa.test.ts && bun run typecheck && bun run lint`

Expected: all selected tests pass; typecheck and lint exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/plugins/auth/api-error.ts apps/api/src/plugins/error-handling.ts apps/api/src/plugins/auth/index.ts apps/api/test/api.test.ts apps/api/test/staff-session.test.ts
git commit -m "Normalize Better Auth API errors"
```

### Task 3: Complete Elysia request and response contracts

**Files:**
- Create: `apps/api/src/shared/http-model.ts`
- Create: `apps/api/src/plugins/auth/model.ts`
- Modify: `apps/api/src/plugins/auth/access-control.ts`
- Modify: `apps/api/src/modules/audit/model.ts`
- Modify: `apps/api/src/modules/audit/index.ts`
- Modify: `apps/api/src/modules/customer-auth/model.ts`
- Modify: `apps/api/src/modules/staff/model.ts`
- Modify: `apps/api/src/modules/staff/index.ts`
- Modify: `apps/api/src/modules/staff-invitations/model.ts`
- Modify: `apps/api/src/modules/staff-invitations/index.ts`
- Modify: `apps/api/src/modules/staff-mfa/model.ts`
- Modify: `apps/api/src/modules/staff-mfa/index.ts`
- Modify: `apps/api/test/api.test.ts`
- Create: `apps/api/test/route-contracts.test.ts`

**Interfaces:**
- Consumes: existing handler return values and `Role`/`StaffRole` semantics.
- Produces: `httpModels`, `staffRoleSchema`, and named feature response models referenced by routes.

- [ ] **Step 1: Add failing validation tests**

Add an OpenAPI assertion in `test/api.test.ts` that checks representative contracts:

```ts
const staffRole = specification.paths['/api/v1/staff/{id}/role'].patch
expect(staffRole.requestBody).toBeDefined()
expect(staffRole.responses['200']).toBeDefined()
expect(staffRole.responses['401']).toBeDefined()
expect(staffRole.responses['403']).toBeDefined()
expect(specification.paths['/api/v1/staff/invitations/{id}/resend'].post.parameters)
  .toEqual(expect.arrayContaining([expect.objectContaining({ name: 'id', in: 'path' })]))
expect(specification.paths['/api/v1/staff/onboarding/totp'].post.responses['200']).toBeDefined()
expect(specification.paths['/api/v1/audit/'].get.responses['200']).toBeDefined()
```

Create `test/route-contracts.test.ts` with stubbed auth and feature services so it never opens a database connection. Add route-level tests proving that:

- `PATCH /api/v1/staff/:id/role` rejects `{"role":"owner,admin"}` with 422 before the service runs;
- a path ID longer than 256 characters is rejected with 422 before the service runs;
- an invitation response containing `acceptedAt: null`, `revokedAt: null`, and a `Date` succeeds and serializes to the same JSON keys;
- a staff-session response with nullable `ipAddress` and `userAgent` succeeds.

- [ ] **Step 2: Run focused tests and confirm RED**

Run: `cd apps/api && bun test test/api.test.ts test/route-contracts.test.ts`

Expected: FAIL because application OpenAPI responses and path schemas are missing, and the role body still accepts arbitrary strings at the Elysia boundary.

- [ ] **Step 3: Create shared HTTP and role schemas**

Create `shared/http-model.ts`:

```ts
import { t } from 'elysia'

export const httpModels = {
  'http.error': t.Object({ code: t.String(), message: t.String() }),
  'http.idParams': t.Object({
    id: t.String({ minLength: 1, maxLength: 256 }),
  }, { additionalProperties: false }),
  'http.empty': t.Void(),
}
```

Create `plugins/auth/model.ts` and derive the TypeScript type from the schema:

```ts
import { t } from 'elysia'

export const staffRoleSchema = t.Union([
  t.Literal('owner'),
  t.Literal('admin'),
  t.Literal('catalog_manager'),
  t.Literal('fulfillment'),
  t.Literal('support'),
])

export type StaffRole = typeof staffRoleSchema.static
```

Update `access-control.ts` to import and re-export `StaffRole`; retain `Role = StaffRole | 'customer'` and the existing runtime role set.

- [ ] **Step 4: Define exact feature models**

Register `httpModels` in each application module and add these feature schemas:

```ts
// staff/model.ts
const staffMember = t.Object({
  id: t.String(),
  name: t.String(),
  email: t.String(),
  role: staffRoleSchema,
  banned: t.Boolean(),
  staffActivatedAt: t.Nullable(t.Date()),
})

const staffSession = t.Object({
  id: t.String(),
  createdAt: t.Date(),
  updatedAt: t.Date(),
  expiresAt: t.Date(),
  ipAddress: t.Nullable(t.String()),
  userAgent: t.Nullable(t.String()),
})

export const staffModels = {
  'staff.roleBody': t.Object({ role: staffRoleSchema }, { additionalProperties: false }),
  'staff.suspendBody': t.Object({ reason: t.String({ minLength: 1, maxLength: 500 }) }, {
    additionalProperties: false,
  }),
  'staff.member': staffMember,
  'staff.session': staffSession,
  'staff.memberList': t.Array(staffMember),
  'staff.sessionList': t.Array(staffSession),
}
```

Define the remaining feature models with shared constants so arrays reuse the exact item schema:

```ts
// staff-invitations/model.ts
const invitation = t.Object({
  id: t.String(),
  email: t.String(),
  role: staffRoleSchema,
  expiresAt: t.Date(),
})

const invitationListItem = t.Object({
  id: t.String(),
  email: t.String(),
  role: staffRoleSchema,
  expiresAt: t.Date(),
  acceptedAt: t.Nullable(t.Date()),
  revokedAt: t.Nullable(t.Date()),
})

export const staffInvitationModels = {
  'staffInvitation.createBody': t.Object({
    email: t.String({ minLength: 3, maxLength: 322 }),
    role: staffRoleSchema,
  }, { additionalProperties: false }),
  'staffInvitation.acceptBody': t.Object({
    token: t.String({ minLength: 16, maxLength: 512 }),
    name: t.String({ minLength: 1, maxLength: 100 }),
    password: t.String({ minLength: 12, maxLength: 256 }),
  }, { additionalProperties: false }),
  'staffInvitation.createResponse': invitation,
  'staffInvitation.listResponse': t.Array(invitationListItem),
  'staffInvitation.acceptResponse': t.Object({
    accepted: t.Literal(true),
    next: t.Literal('mfa-enrollment'),
  }),
}

// staff-mfa/model.ts
export const staffMfaModels = {
  'staffMfa.passwordBody': t.Object({
    password: t.String({ minLength: 12, maxLength: 256 }),
  }, { additionalProperties: false }),
  'staffMfa.verifyBody': t.Object({
    code: t.String({ minLength: 6, maxLength: 8 }),
  }, { additionalProperties: false }),
  'staffMfa.onboardingResponse': t.Object({ required: t.Literal(true), userId: t.String() }),
  'staffMfa.enrollmentResponse': t.Object({
    totpURI: t.String(),
    backupCodes: t.Array(t.String()),
  }),
  'staffMfa.verifiedResponse': t.Object({ verified: t.Literal(true) }),
  'staffMfa.backupCodesResponse': t.Object({ backupCodes: t.Array(t.String()) }),
}

// audit/model.ts
const auditRecord = t.Object({
  id: t.String(),
  occurredAt: t.Date(),
  actorUserId: t.Nullable(t.String()),
  action: t.String(),
  targetType: t.String(),
  targetId: t.String(),
  requestId: t.String(),
  ipAddress: t.Nullable(t.String()),
  userAgent: t.Nullable(t.String()),
  metadata: t.Record(t.String(), t.Unknown()),
})

export const auditModels = {
  'audit.listResponse': t.Array(auditRecord),
}
```

Keep `customerAuth.signupResponse` and system response models unchanged except for adding shared error response references where applicable.

- [ ] **Step 5: Attach schemas to every application route**

Use `params: 'http.idParams'` on every `/:id` route. Attach these exact response maps:

| Route | 200 schema | Error statuses using `http.error` |
|---|---|---|
| `POST /customer-auth/sign-up` | `customerAuth.signupResponse` | 403, 422 |
| `GET /staff/invitations` | `staffInvitation.listResponse` | 401, 403 |
| `POST /staff/invitations` | `staffInvitation.createResponse` | 401, 403, 409, 422, 429 |
| `POST /staff/invitations/:id/resend` | `staffInvitation.createResponse` | 401, 403, 410, 422, 429 |
| `POST /staff/invitations/:id/cancel` | `http.empty` | 401, 403, 410, 422, 429 |
| `POST /staff/invitations/accept` | `staffInvitation.acceptResponse` | 403, 410, 422, 429 |
| `GET /staff/onboarding` | `staffMfa.onboardingResponse` | 401 |
| `POST /staff/onboarding/totp` | `staffMfa.enrollmentResponse` | 400, 401, 403, 422, 429 |
| `POST /staff/onboarding/totp/verify` | `staffMfa.verifiedResponse` | 400, 401, 403, 422, 429 |
| `POST /staff/mfa/backup-codes/regenerate` | `staffMfa.backupCodesResponse` | 400, 401, 403, 422, 429 |
| `GET /staff/sessions` | `staff.sessionList` | 401 |
| `POST /staff/sessions/:id/revoke` | `http.empty` | 401, 404, 422, 429 |
| `GET /staff` | `staff.memberList` | 401, 403 |
| all five `/:id` staff administration mutations | `http.empty` | 401, 403, 404, 409, 422, 429 |
| `GET /audit` | `audit.listResponse` | 401, 403, 422 |

For handlers returning `Promise<void>`, explicitly return `undefined` and validate with `http.empty`; do not change the status code or introduce a new JSON payload.

- [ ] **Step 6: Run focused tests and inspect generated OpenAPI**

Run: `cd apps/api && bun test test/api.test.ts test/route-contracts.test.ts test/staff-mfa.test.ts`

Expected: all selected database-free route and OpenAPI tests pass.

Run: `cd apps/api && bun run typecheck && bun run lint`

Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/shared/http-model.ts apps/api/src/plugins/auth/model.ts apps/api/src/plugins/auth/access-control.ts apps/api/src/modules/audit apps/api/src/modules/customer-auth apps/api/src/modules/staff apps/api/src/modules/staff-invitations apps/api/src/modules/staff-mfa apps/api/test/api.test.ts apps/api/test/route-contracts.test.ts
git commit -m "Define API route contracts"
```

### Task 4: Wire rate-limit headers and remove dead application configuration

**Files:**
- Modify: `apps/api/src/plugins/application-rate-limit.ts`
- Modify: `apps/api/src/modules/rate-limit/service.ts`
- Modify: `apps/api/src/config/env.ts`
- Modify: `apps/api/src/modules/audit/model.ts`
- Delete: `apps/api/src/shared/clock.ts`
- Modify: `apps/api/test/rate-limit.test.ts`
- Modify: `apps/api/test/config.test.ts`
- Modify: `apps/api/README.md`
- Modify: `apps/api/.env.example`

**Interfaces:**
- Consumes: `rateLimitResponse(result)` and `RateLimitResult.retryAfterSeconds`.
- Produces: all application rate-limit rejections include `Retry-After`; `AppConfig` no longer contains unused `auditRetentionDays`.

- [ ] **Step 1: Strengthen the failing route-level rate-limit test**

In the first `test/rate-limit.test.ts` case, add:

```ts
expect(response.headers.get('retry-after')).toBe('60')
expect(await response.json()).toEqual({ code: 'RATE_LIMITED', message: 'Too many requests' })
```

Move this non-database case into a new `test/application-rate-limit.test.ts` so it can run in the unit suite. Keep atomic counter and plaintext-persistence cases in `rate-limit.test.ts`.

- [ ] **Step 2: Run the focused unit test and confirm RED**

Run: `cd apps/api && bun test test/application-rate-limit.test.ts`

Expected: FAIL because the production macro omits `Retry-After`.

- [ ] **Step 3: Use the existing response builder in production**

Update the macro resolver to consume `rateLimitResponse`:

```ts
async resolve({ request, requestContext, set }) {
  const result = await limiter.consume({
    namespace: options.namespace,
    subjectHash: new URL(request.url).pathname,
    ip: requestContext.clientIp,
    limit: options.limit,
    windowSeconds: options.windowSeconds,
  })

  if (!result.allowed) {
    const rejected = rateLimitResponse(result)
    set.status = rejected.status
    Object.assign(set.headers, rejected.headers)
    return rejected.body
  }
}
```

- [ ] **Step 4: Remove confirmed dead configuration and declarations**

Remove `auditRetentionDays`, `parsePositiveInteger`, and `AUDIT_RETENTION_DAYS` parsing from `env.ts`; remove their assertions from `config.test.ts`; remove the variable from `.env.example`; and change README retention wording to state that retention/purge is an external operations responsibility.

Remove the unused `'auth.sign-in-failed'` key from `auditMetadataKeys`. Delete the tracked but unused `shared/clock.ts`. Verify that `rg -n "auditRetentionDays|AUDIT_RETENTION_DAYS|auth\.sign-in-failed|shared/clock" apps/api` has no source references.

The empty `src/modules/auth`, `src/modules/product`, and `src/modules/user` directories are not tracked by Git; remove them from the working tree if present, without adding replacement placeholder files.

- [ ] **Step 5: Run focused and static verification**

Run: `cd apps/api && bun test test/application-rate-limit.test.ts test/config.test.ts test/audit.test.ts && bun run typecheck && bun run lint`

Expected: unit/config tests pass; audit integration tests pass when PostgreSQL is available and otherwise fail only for the documented prerequisite; typecheck and lint exit 0.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/plugins/application-rate-limit.ts apps/api/src/modules/rate-limit/service.ts apps/api/src/config/env.ts apps/api/src/modules/audit/model.ts apps/api/test/application-rate-limit.test.ts apps/api/test/rate-limit.test.ts apps/api/test/config.test.ts apps/api/README.md apps/api/.env.example
git add -u apps/api/src/shared/clock.ts
git commit -m "Complete API hardening cleanup"
```

### Task 5: Make unit and integration test workflows portable

**Files:**
- Create: `apps/api/test/require-test-database.ts`
- Modify: `apps/api/test/helpers/database.ts`
- Modify: `apps/api/test/database-schema.test.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/README.md`

**Interfaces:**
- Consumes: `TEST_DATABASE_URL` environment variable.
- Produces: `requireTestDatabaseUrl(env): string`; `test:unit`, `test:integration`, and complete `test` scripts.

- [ ] **Step 1: Add failing test-database configuration tests**

Create `test/require-test-database.ts` with an exported pure function and a direct-execution guard. Add tests to `test/primitives.test.ts`:

```ts
expect(() => requireTestDatabaseUrl({})).toThrow(
  'TEST_DATABASE_URL is required for API integration tests',
)
expect(requireTestDatabaseUrl({
  TEST_DATABASE_URL: 'postgresql://postgres:postgres@127.0.0.1:5432/suannn_test',
})).toBe('postgresql://postgres:postgres@127.0.0.1:5432/suannn_test')
```

Add a test around `resetTestDatabase`'s existing safety check using the existing unsafe `postgres` database fixture and assert it rejects with `Refusing database test operation`; keep this test gated by the integration script.

- [ ] **Step 2: Run the unit test and confirm RED**

Run: `cd apps/api && bun test test/primitives.test.ts`

Expected: FAIL because `requireTestDatabaseUrl` does not exist.

- [ ] **Step 3: Implement the environment preflight**

Create:

```ts
export function requireTestDatabaseUrl(env: Record<string, string | undefined> = process.env) {
  const value = env.TEST_DATABASE_URL?.trim()
  if (!value) throw new Error('TEST_DATABASE_URL is required for API integration tests')
  return value
}

if (import.meta.main) {
  try {
    requireTestDatabaseUrl()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'TEST_DATABASE_URL is required')
    process.exit(1)
  }
}
```

Change `createTestDatabase` to use `requireTestDatabaseUrl()` with no developer-specific fallback. In `database-schema.test.ts`, keep the explicit unsafe database URL only for proving the `_test` suffix guard; derive its server credentials from `TEST_DATABASE_URL` and replace only the database pathname with `/postgres` so no username is hardcoded.

- [ ] **Step 4: Add explicit package scripts**

Use these exact test groups in `apps/api/package.json`:

```json
"test": "bun run test:unit && bun run test:integration",
"test:unit": "bun test test/access-control.test.ts test/api.test.ts test/application-rate-limit.test.ts test/auth-config.test.ts test/auth-http-policy.test.ts test/bootstrap-owner.test.ts test/browser-mutation.test.ts test/config.test.ts test/email.test.ts test/primitives.test.ts test/route-contracts.test.ts test/staff-mfa.test.ts test/staff-session.test.ts",
"test:integration": "bun test/require-test-database.ts && bun test test/audit.test.ts test/auth-config.integration.test.ts test/customer-auth.test.ts test/database-schema.test.ts test/identity-claims.test.ts test/rate-limit.test.ts test/staff-admin.test.ts test/staff-invitations.test.ts"
```

If Task 3 adds a DB-free route-contract test file, include it in `test:unit`. If a listed mixed test still connects at module load, split only its DB-free cases into a `*.unit.test.ts` file rather than permitting unit tests to require PostgreSQL.

- [ ] **Step 5: Document test database setup**

Add an API README section containing:

```bash
createdb suannn_test
export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/suannn_test
bun --filter api test:unit
bun --filter api test:integration
bun --filter api test
```

Explain that integration tests reset the `public` and `drizzle` schemas, refuse databases whose actual PostgreSQL name does not end in `_test`, and must never target development or production databases.

- [ ] **Step 6: Verify both workflows**

Run without `TEST_DATABASE_URL`: `cd apps/api && env -u TEST_DATABASE_URL bun run test:unit`

Expected: PASS with no PostgreSQL connection attempt.

Run without `TEST_DATABASE_URL`: `cd apps/api && env -u TEST_DATABASE_URL bun run test:integration`

Expected: exit 1 with one `TEST_DATABASE_URL is required for API integration tests` message before Bun starts the integration files.

When a test database is available, run: `cd apps/api && TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:5432/suannn_test' bun run test:integration`

Expected: all integration tests pass. If no database is available, record this environmental limitation and do not claim the integration suite passed.

- [ ] **Step 7: Commit**

```bash
git add apps/api/test/require-test-database.ts apps/api/test/helpers/database.ts apps/api/test/database-schema.test.ts apps/api/test/primitives.test.ts apps/api/package.json apps/api/README.md
git commit -m "Make API tests portable"
```

### Task 6: Decompose Better Auth configuration without schema drift

**Files:**
- Create: `apps/api/src/plugins/auth/config-models.ts`
- Create: `apps/api/src/plugins/auth/session-lifecycle.ts`
- Create: `apps/api/src/plugins/auth/custom-session.ts`
- Modify: `apps/api/src/plugins/auth/auth.ts`
- Modify: `apps/api/test/auth-config.test.ts`

**Interfaces:**
- Consumes: `Database`, `AuthDependencies`, existing access-control/session-policy exports.
- Produces: unchanged `createAuth(config, db, dependencies)` and `Auth`; internal `createDatabaseHooks(db)`, `createUserOptions()`, `createSessionOptions()`, and `createCustomSessionPlugin(db)`.

- [ ] **Step 1: Add a behavior lock around extracted configuration**

Extend `test/auth-config.test.ts`:

```ts
it('preserves security-critical Better Auth options after decomposition', () => {
  expect(auth.options.basePath).toBe('/api/v1/auth')
  expect(auth.options.rateLimit).toMatchObject({ enabled: true, storage: 'database' })
  expect(auth.options.advanced).toMatchObject({
    disableCSRFCheck: false,
    disableOriginCheck: false,
    crossSubDomainCookies: { enabled: false },
  })
  expect(auth.options.trustedOrigins).toEqual(config.corsOrigins)
  expect(auth.options.session?.cookieCache).toEqual({ enabled: false })
})
```

- [ ] **Step 2: Run the behavior lock before refactoring**

Run: `cd apps/api && bun test test/auth-config.test.ts`

Expected: PASS. This is a characterization test, so its initial green result is intentional; do not change production code until this lock exists.

- [ ] **Step 3: Extract model option factories**

Move the existing `user` and `session` option objects verbatim into `config-models.ts`:

```ts
export function createUserOptions() {
  return {
    additionalFields: {
      accountType: { type: ['customer', 'staff'], defaultValue: 'customer', input: false, returned: true },
      staffActivatedAt: { type: 'date', required: false, input: false, returned: false },
      sourceInvitationId: {
        type: 'string',
        required: false,
        unique: true,
        input: false,
        returned: false,
      },
    },
  } as const
}

export function createSessionOptions() {
  return {
    expiresIn: 60 * 60 * 24 * 30,
    cookieCache: { enabled: false },
    additionalFields: {
      lastActivityAt: { type: 'date', required: false, input: false, returned: false },
      absoluteExpiresAt: { type: 'date', required: false, input: false, returned: false },
    },
  } as const
}
```

- [ ] **Step 4: Extract staff session lifecycle behavior**

Create `session-lifecycle.ts`:

```ts
import { eq } from 'drizzle-orm'
import type { BetterAuthOptions } from 'better-auth'
import type { createDatabase } from '../../database/client'
import * as schema from '../../database/schema/auth'

type Database = ReturnType<typeof createDatabase>['db']

export function createDatabaseHooks(
  db: Database,
): NonNullable<BetterAuthOptions['databaseHooks']> {
  return {
    session: {
      create: {
        async before(newSession) {
          const [account] = await db.select({ accountType: schema.user.accountType })
            .from(schema.user)
            .where(eq(schema.user.id, newSession.userId))
            .limit(1)

          if (account?.accountType !== 'staff') return { data: newSession }

          const authenticatedAt = new Date()
          return {
            data: {
              ...newSession,
              lastActivityAt: authenticatedAt,
              absoluteExpiresAt: new Date(authenticatedAt.getTime() + 8 * 60 * 60 * 1000),
            },
          }
        },
      },
    },
  }
}
```

Create `custom-session.ts` with the existing projection as a named plugin factory:

```ts
import { customSession } from 'better-auth/plugins/custom-session'
import { APIError } from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import type { createDatabase } from '../../database/client'
import * as schema from '../../database/schema/auth'
import { capabilitiesFor, type AccountType, type Role } from './access-control'
import {
  isRestrictedStaffSession,
  touchStaffSession,
  validateStaffSession,
  type StaffSessionContext,
} from './session-policy'

type Database = ReturnType<typeof createDatabase>['db']

export function createCustomSessionPlugin(db: Database) {
  return customSession(async ({ user, session }) => {
    const [[persistedUser], [persistedSession]] = await Promise.all([
      db.select({
        accountType: schema.user.accountType,
        role: schema.user.role,
        banned: schema.user.banned,
        staffActivatedAt: schema.user.staffActivatedAt,
      }).from(schema.user).where(eq(schema.user.id, user.id)).limit(1),
      db.select({
        lastActivityAt: schema.session.lastActivityAt,
        absoluteExpiresAt: schema.session.absoluteExpiresAt,
      }).from(schema.session).where(eq(schema.session.id, session.id)).limit(1),
    ])
    const extendedUser = user as typeof user & {
      accountType?: AccountType
      role?: Role
      banned?: boolean
      staffActivatedAt?: Date | null
    }
    let staff: {
      role: Exclude<Role, 'customer'>
      permissions: readonly string[]
    } | undefined

    if (persistedUser?.accountType === 'staff') {
      const staffContext = {
        user: {
          id: user.id,
          accountType: 'staff',
          role: (persistedUser.role ?? 'customer') as Role,
          emailVerified: user.emailVerified,
          staffActivatedAt: persistedUser.staffActivatedAt ?? null,
          banned: persistedUser.banned ?? false,
        },
        session: {
          id: session.id,
          lastActivityAt: persistedSession?.lastActivityAt ?? null,
          absoluteExpiresAt: persistedSession?.absoluteExpiresAt ?? null,
        },
      } satisfies StaffSessionContext
      const validation = validateStaffSession(staffContext)

      if (!validation.valid) {
        if (!isRestrictedStaffSession(staffContext)) {
          await db.delete(schema.session).where(eq(schema.session.id, session.id))
          throw new APIError('UNAUTHORIZED', {
            code: 'SESSION_EXPIRED',
            message: 'Session expired',
          })
        }
      } else {
        staff = {
          role: validation.role,
          permissions: capabilitiesFor(validation.role),
        }
      }

      await touchStaffSession({
        async touchIfUnchanged(sessionId, previous, next) {
          const rows = await db.update(schema.session)
            .set({ lastActivityAt: next })
            .where(and(
              eq(schema.session.id, sessionId),
              eq(schema.session.lastActivityAt, previous),
            ))
            .returning({ id: schema.session.id })

          return rows.length === 1
        },
      }, session.id, persistedSession!.lastActivityAt!, new Date())
    }

    return {
      session: { id: session.id, expiresAt: session.expiresAt },
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image ?? null,
        accountType: persistedUser?.accountType ?? extendedUser.accountType ?? 'customer',
      },
      ...(staff ? { staff } : {}),
    }
  })
}
```

Keep `auth.ts` responsible for Better Auth assembly, email callbacks, rate limits, advanced options, Admin/2FA/OpenAPI plugin configuration, and the public exports.

Replace the extracted blocks in `auth.ts` with:

```ts
databaseHooks: createDatabaseHooks(db),
user: createUserOptions(),
session: createSessionOptions(),
plugins: [
  admin({ ac: accessControl, roles, defaultRole: 'customer', adminRoles: ['owner', 'admin'] }),
  twoFactor({
    issuer: 'Suannn',
    twoFactorCookieMaxAge: 10 * 60,
    totpOptions: { digits: 6, period: 30 },
    backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: 'encrypted' },
  }),
  createCustomSessionPlugin(db),
  openAPI({ disableDefaultReference: true }),
],
```

- [ ] **Step 5: Verify behavior after each extraction**

After `config-models.ts`: `cd apps/api && bun test test/auth-config.test.ts && bun run typecheck`

After `session-lifecycle.ts`: `cd apps/api && bun test test/auth-config.test.ts test/staff-session.test.ts && bun run typecheck`

After `custom-session.ts`: `cd apps/api && bun test test/auth-config.test.ts test/staff-session.test.ts test/auth-http-policy.test.ts && bun run typecheck`

Expected after every command: tests pass and typecheck exits 0.

- [ ] **Step 6: Prove Better Auth schema stability**

Run from `apps/api`:

```bash
cp src/database/schema/auth.ts /tmp/suannn-auth-schema-before.ts
bun run auth:generate
diff -u /tmp/suannn-auth-schema-before.ts src/database/schema/auth.ts
```

Expected: `diff` exits 0 with no output. If generation changes the file, stop this task, inspect whether the change comes from the refactor or generator formatting, and do not commit a schema change under this plan.

- [ ] **Step 7: Run the API verification set**

Run: `cd apps/api && bun run test:unit && bun run typecheck && bun run lint`

Expected: all unit tests pass; typecheck and lint exit 0.

If `TEST_DATABASE_URL` is available, run: `cd apps/api && bun run test:integration`

Expected: all integration tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/plugins/auth/config-models.ts apps/api/src/plugins/auth/session-lifecycle.ts apps/api/src/plugins/auth/custom-session.ts apps/api/src/plugins/auth/auth.ts apps/api/test/auth-config.test.ts
git commit -m "Decompose Better Auth configuration"
```

### Task 7: Final compatibility and repository verification

**Files:**
- Modify only if a verification failure exposes a defect in files already in this plan.

**Interfaces:**
- Consumes: every interface produced by Tasks 1-6.
- Produces: a verified API package with no unintended schema, route, or frontend build regressions.

- [ ] **Step 1: Check the final diff scope**

Run:

```bash
git status --short
git diff --check HEAD~6..HEAD
git diff --name-status HEAD~6..HEAD
```

Expected: only planned API files and the plan/spec commits appear; the pre-existing admin login modification remains unstaged and absent from task commits.

- [ ] **Step 2: Run all no-database verification**

Run: `cd apps/api && bun run test:unit && bun run typecheck && bun run lint`

Expected: all commands exit 0.

- [ ] **Step 3: Run integration tests when infrastructure is available**

Run: `cd apps/api && bun run test:integration`

Expected with `TEST_DATABASE_URL`: all integration tests pass. Expected without it: the single documented preflight error; record the suite as not run, not passed.

- [ ] **Step 4: Verify workspace consumers compile**

Run from the repository root:

```bash
bun --filter storefront build
bun --filter storefront lint
bun --filter admin build
bun --filter admin lint
```

Expected: all four commands exit 0. Do not modify the user's existing admin login change to make this plan pass; if that unrelated change causes a failure, report it separately.

- [ ] **Step 5: Verify generated schema and migration state**

Run:

```bash
git diff --exit-code -- apps/api/src/database/schema/auth.ts apps/api/drizzle
git status --short apps/api/src/database/schema/auth.ts apps/api/drizzle
```

Expected: no generated schema or migration changes.

- [ ] **Step 6: Resolve any in-scope verification failure test-first**

If Steps 1-5 expose an in-scope defect, add a focused regression test to the owning test file, run that test to observe RED, make the smallest production correction, rerun the focused test and `bun run test:unit`, then commit exactly the files shown by `git diff --name-only`. If no defect is found, create no empty commit.
