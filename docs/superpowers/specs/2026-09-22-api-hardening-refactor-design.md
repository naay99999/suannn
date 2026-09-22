# API Hardening and Structure Refactor Design

## Purpose

Improve `apps/api` so its production authentication defaults fail closed, expected Better Auth failures preserve correct HTTP semantics, Elysia route contracts are explicit, integration tests are portable, and the folder structure remains easy to extend.

The refactor must preserve the existing `/api/v1` URLs, Better Auth database schema, frontend-facing response shapes, staff authorization rules, and Eden Treaty `App` export.

## Current strengths to preserve

- `src/app.ts` composes a chained Elysia application and exports its inferred `App` type.
- `src/index.ts` owns runtime construction and dependency injection.
- Feature modules keep HTTP controllers separate from services and repositories.
- Better Auth routes are protected by an explicit method/path allowlist.
- Browser mutations require exact trusted origins and JSON content types.
- Staff sessions enforce idle and absolute expiration, MFA, and fixed-role permissions.
- Authentication and application mutation rate limits are database-backed.
- Security-sensitive domain changes write audit events in the same database transaction.

## Scope

### 1. Production authentication configuration

`BETTER_AUTH_URL` will be parsed as an HTTP(S) origin rather than a general URL. It must not contain credentials, a non-root path, query parameters, or a fragment. When `NODE_ENV=production`, it must use HTTPS.

Cookie security will be derived from validated configuration. Production will always enable secure cookies. Local HTTP development will continue to work without secure cookies.

The configuration tests will cover:

- rejection of production HTTP URLs;
- rejection of path-bearing Better Auth URLs;
- acceptance of local HTTP development;
- secure-cookie selection for production and local development.

### 2. Better Auth error translation

Calls made through `auth.api` can throw Better Auth `APIError` instances for expected client failures. A small adapter will translate those errors into the API's established `{ code, message }` envelope.

The adapter will:

- preserve safe HTTP statuses such as 400, 401, 403, 404, 409, 422, and 429;
- map 400 and 422 to `AUTH_REQUEST_INVALID`, 401 to `AUTHENTICATION_FAILED`, 403 to
  `AUTHORIZATION_FAILED`, 404 to `AUTH_RESOURCE_NOT_FOUND`, 409 to `AUTH_CONFLICT`, and
  429 to `RATE_LIMITED`;
- use a generic client-safe message for each mapped category rather than forwarding Better Auth's
  internal message;
- preserve `Retry-After` when Better Auth supplies it;
- allow unexpected errors to reach the existing global 500 handler and logger.

MFA enrollment, verification, and backup-code regeneration will use this boundary. The raw Better Auth catch-all handler remains unchanged because it already returns standard `Response` objects.

### 3. Authentication and authorization semantics

The permission macro will distinguish authentication from authorization:

- no active staff session: `401 SESSION_EXPIRED`;
- active staff session without permission: `403 FORBIDDEN`.

Routes will not need to combine `staffAuth` and `permission` solely to obtain correct status behavior. Existing resolved `user`, `session`, and `staff` values remain available.

### 4. Elysia route contracts

Application-owned endpoints will declare request and success-response schemas. Shared schemas will cover:

- opaque/UUID-like path identifiers with bounded length;
- the fixed staff-role union;
- common success responses;
- the standard `{ code, message }` error envelope where status-specific validation is practical.

Schemas remain feature-owned when they describe feature data. A small shared HTTP model module may contain only truly cross-feature primitives.

The work will cover `audit`, `staff`, `staff-invitations`, `staff-mfa`, `customer-auth`, and `system`. Better Auth-generated endpoint schemas continue to come from Better Auth's OpenAPI plugin.

Response schemas must reflect existing payloads rather than redesign them. Date fields will use the representation currently produced by Elysia/OpenAPI and consumed by the frontends.

### 5. CORS and trusted-origin correction

Development origins will match the Vite server and preview ports exactly:

- storefront: `5183` and `4183` for both `localhost` and `127.0.0.1`;
- admin: `5184` and `4184` for both host forms.

Tests will cover both preview origins because the same list is used for CORS and Better Auth trusted origins.

### 6. Test portability

Database-backed tests will no longer default to a developer-specific PostgreSQL username. `TEST_DATABASE_URL` will be the canonical integration-test connection string.

The package will expose separate scripts:

- `test:unit` for tests that require no external database;
- `test:integration` for PostgreSQL-backed tests;
- `test` for the complete suite.

The API README will document database creation, the `_test` database-name safety requirement, migration/reset behavior, and example commands. Integration tests will continue refusing destructive operations against databases whose names do not end in `_test`.

If `TEST_DATABASE_URL` is absent, integration tests will fail immediately with one actionable configuration error rather than attempting a personal local default.

### 7. Auth-file decomposition

The Elysia adapter remains in `src/plugins/auth/index.ts`. The Better Auth factory will be split by responsibility without changing its public `createAuth` and `Auth` exports:

- core configuration and plugin assembly;
- user/session field declarations and session projection;
- database hooks and staff-session lifecycle behavior;
- existing access-control, HTTP-policy, and session-policy modules remain focused files.

The generated `src/database/schema/auth.ts` remains generated code and will not be hand-formatted or manually reorganized.

The refactor will avoid creating a second competing `modules/auth` abstraction. The empty `modules/auth`, `modules/product`, and `modules/user` directories will be removed.

### 8. Audit and dead-code cleanup

The unused `auth.sign-in-failed` action will be removed. Better Auth 1.7.5 does not expose all failed
sign-ins through one application hook with reliable actor and outcome context, and duplicating its
request handling solely for an audit row would increase authentication risk. Request logs continue to
record the sanitized path and status. No email address, password, cookie, token, TOTP secret, or backup
code may enter audit metadata.

No additional session lifecycle audit events will be introduced in this refactor. Explicit application
operations already audit staff session revocation, while passive reads must not create noisy audit rows.

`AUDIT_RETENTION_DAYS` currently describes an external purge concern but is unused by the application. It will be removed from application configuration and documented as an operations responsibility unless an existing in-process purge owner is discovered during implementation.

Unused clock and rate-limit helpers will be removed or wired into production code. Rate-limit rejections will consistently send `Retry-After` when the limiter provides it.

## Error handling

Application domain errors continue using stable symbolic codes and the global error envelope. Better Auth errors are normalized at the service integration boundary. Validation failures remain `422 VALIDATION_ERROR`, missing routes remain `404 NOT_FOUND`, and unexpected failures remain sanitized `500 INTERNAL_ERROR` responses with server-side logging.

No new handler may return raw exception messages or stack traces.

## Compatibility constraints

- No endpoint URL or HTTP method changes.
- No Better Auth or application database migration unless schema generation proves the refactor changes the generated schema unexpectedly; such a change is out of scope and must be investigated rather than accepted automatically.
- No frontend changes are required for successful existing flows.
- Existing success payloads and cookie names remain stable.
- The `App` type continues to be exported from `src/app.ts` for Eden Treaty clients.
- Existing user changes outside `apps/api` are not touched.

## Testing strategy

Implementation follows test-driven development. Each behavioral change begins with a focused failing test, followed by the smallest production change that makes it pass.

Required verification:

1. Configuration and cookie-security tests.
2. Better Auth API-error translation route tests.
3. Permission macro 401/403 tests.
4. CORS tests for all configured local preview origins.
5. OpenAPI assertions for application request/response schemas.
6. Unit-test suite without PostgreSQL.
7. Integration-test suite with `TEST_DATABASE_URL` when a test database is available.
8. API lint and TypeScript checks.
9. Better Auth schema generation diff check; generated schema must remain unchanged.

## Completion criteria

- Production rejects insecure or malformed Better Auth base URLs.
- Expected MFA credential failures no longer become HTTP 500 responses.
- Unauthenticated permission checks return 401 and unauthorized authenticated checks return 403.
- Development CORS/trusted origins match both Vite applications.
- Application-owned routes have explicit, reusable Elysia request and response schemas.
- Unit tests run without PostgreSQL, and integration-test prerequisites are documented and portable.
- Auth configuration responsibilities are separated without changing exports or generated schema.
- Empty directories and confirmed dead configuration/helpers are removed.
- Lint and typecheck pass; all runnable tests pass, with unavailable external integration infrastructure reported explicitly.
