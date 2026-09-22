# API

The API is an Elysia application running on Bun.

## Commands

```bash
bun --filter api dev
bun --filter api test
bun --filter api typecheck
bun --filter api lint
bun --filter api auth:generate
bun --filter api db:generate
bun --filter api db:migrate
```

## Configuration

Copy `.env.example` to `.env.local`. Set `DATABASE_URL`, a random `BETTER_AUTH_SECRET` of at least 32 characters, `BETTER_AUTH_URL`, `STOREFRONT_URL`, `ADMIN_URL`, `RESEND_API_KEY`, and `AUTH_EMAIL_FROM`. The sender must be verified in Resend. Defaults include `HOST=0.0.0.0` and `PORT=6767`; audit retention and purge are an external operations responsibility.

For production, set `NODE_ENV=production` and `CORS_ORIGINS` to a comma-separated list of exact frontend origins. Startup fails if the allowlist is absent. These origins are also Better Auth's trusted origins and receive credentialed CORS responses.

Set `TRUSTED_PROXY_HEADERS` only when a trusted edge proxy overwrites every listed header. Never trust a client-preserved forwarding header.

After changing Better Auth plugins or schema options, run `bun --filter api auth:generate`, then create and apply a Drizzle migration with `db:generate` and `db:migrate`.

Apply migrations before starting the new API. Existing identities are backfilled as customers; no migration promotes an existing user to staff.

## Authentication operations

```bash
bun --filter api auth:generate
bun --filter api db:generate
bun --filter api db:migrate
bun --filter api auth:bootstrap-owner -- owner@example.com
bun --filter api auth:recover-owner-mfa -- <owner-user-id>
```

Customers call `POST /api/v1/customer-auth/sign-up`, then sign in through the allowed Better Auth email endpoint. Staff are invitation-only: accept at `POST /api/v1/staff/invitations/accept`, enroll at `POST /api/v1/staff/onboarding/totp`, and verify at `POST /api/v1/staff/onboarding/totp/verify`. Restricted onboarding sessions cannot use normal staff APIs.

Email delivery is best-effort in V1; verification/reset can be requested again and invitations can be resent. A durable transactional outbox is deferred.

Audit records are application-append-only and security mutations write their audit event in the domain transaction. Production operations retain them for 365 days by default; purge jobs should use a separately privileged database role.

## Endpoints

- `GET /api/v1/docs` serves the interactive Scalar API reference.
- `GET /api/v1/openapi.json` serves the generated OpenAPI specification for v1.
- `GET /api/v1` returns the API welcome response.
- `GET /api/v1/health` returns `{ "status": "ok" }` for liveness checks.
- `/api/v1/auth/*` exposes only the pinned sign-in, sign-out, recovery, verification, session, and MFA-challenge allowlist. Raw Admin and MFA-enrollment endpoints remain denied.

Errors use `{ "code", "message" }` and never expose internal stack traces to clients.
