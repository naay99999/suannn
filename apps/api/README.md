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

Integration tests require a dedicated test database:

```bash
createdb suannn_test
export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/suannn_test
bun --filter api test:unit
bun --filter api test:integration
bun --filter api test
```

Integration tests reset the `public` and `drizzle` schemas, refuse databases whose PostgreSQL name does not end in `_test`, and must never target development or production databases.

For production, set `NODE_ENV=production`, `CORS_ORIGINS` to a comma-separated list of exact frontend origins, and `TRUSTED_PROXY_HEADERS` to the header overwritten by the trusted ingress proxy. Startup fails if either setting is absent. Requests without a valid trusted client IP cannot start customer signup. These origins are also Better Auth's trusted origins and receive credentialed CORS responses.

Set `TRUSTED_PROXY_HEADERS` only when a trusted edge proxy overwrites every listed header. Never trust a client-preserved forwarding header.

After changing Better Auth plugins or schema options, run `bun --filter api auth:generate`, then create and apply a Drizzle migration with `db:generate` and `db:migrate`.

Apply migrations before starting the new API. Existing identities are backfilled as customers; no migration promotes an existing user to staff.

Deploy the identity-lock migration and new API as a coordinated cutover: do not run old and new API instances together while identity writes are in progress. If rolling back, stop identity writes, reconcile all `pending_customer` claims against the Better Auth user table, then deploy the old version. Staff, invitation, session, and audit list endpoints now return `{ items, nextCursor }`; `limit` defaults to 50 and is capped at 100, and clients should follow `nextCursor` to load more records.

## Authentication operations

```bash
bun --filter api auth:generate
bun --filter api db:generate
bun --filter api db:migrate
bun --filter api auth:bootstrap-owner -- owner@example.com
bun --filter api auth:recover-owner-mfa -- <owner-user-id>
```

Customers call `POST /api/v1/auth/sign-up`, then sign in through the allowed Better Auth email endpoint. Staff are invitation-only: accept at `POST /api/v1/auth/staff/invitations/accept`, enroll at `POST /api/v1/auth/staff/onboarding/totp`, and verify at `POST /api/v1/auth/staff/onboarding/totp/verify`. Restricted onboarding sessions cannot use normal staff APIs.

Staff self-service authentication routes, including MFA backup-code regeneration and the current staff member's sessions, live under `/api/v1/auth/staff/`. Administrative operations on other staff members and invitations remain under `/api/v1/staff/`.
The former `/api/v1/staff/invitations/accept`, `/api/v1/staff/onboarding*`, `/api/v1/staff/mfa/backup-codes/regenerate`, and `/api/v1/staff/sessions*` self-service paths are removed; clients must use the new paths.

Email delivery is best-effort in V1; verification/reset can be requested again and invitations can be resent. A durable transactional outbox is deferred.

Audit records are application-append-only and security mutations write their audit event in the domain transaction. Production operations retain them for 365 days by default; purge jobs should use a separately privileged database role.

## Endpoints

- `GET /api/v1/docs` serves the interactive Scalar API reference.
- `GET /api/v1/openapi.json` serves the generated OpenAPI specification for v1.
- `GET /api/v1` returns the API welcome response.
- `GET /api/v1/health` returns `{ "status": "ok" }` for liveness checks.
- `/api/v1/auth/*` exposes only the pinned sign-in, sign-out, recovery, verification, session, and MFA-challenge allowlist. Raw Admin and MFA-enrollment endpoints remain denied.

Errors use `{ "code", "message" }` and never expose internal stack traces to clients.

## Customer account API

All routes below use the current customer's Better Auth session cookie. An active customer session may use them even if its original email is unverified; staff sessions cannot. The API derives the customer ID from the session. Browser writes require `Origin: <STOREFRONT_URL>` (the exact configured origin) and `Content-Type: application/json`; send the cookie with credentials. A missing session returns 401 and a disallowed origin returns 403. No request body accepts a user ID.

| Method | Path | JSON body | Success |
| --- | --- | --- | --- |
| `GET` | `/api/v1/customer/profile` | None | `{ id, name, email, emailVerified }` |
| `PATCH` | `/api/v1/customer/profile` | `{ "name": "Mali" }` | Updated profile |
| `GET` | `/api/v1/customer/addresses` | None | `{ "items": [...] }` in creation order |
| `POST` | `/api/v1/customer/addresses` | Address fields below | Created address |
| `PATCH` | `/api/v1/customer/addresses/{id}` | One or more mutable address fields | Updated address |
| `PUT` | `/api/v1/customer/addresses/{id}/default` | `{ "kind": "shipping" }` or `{ "kind": "billing" }` | Updated address |
| `DELETE` | `/api/v1/customer/addresses/{id}` | None | Empty 200 response |
| `POST` | `/api/v1/customer/email-change/request` | `{ "newEmail": "new@example.com", "currentPassword": "..." }` | `{ "accepted": true }` |
| `POST` | `/api/v1/customer/email-change/confirm` | `{ "code": "01234567" }` | `{ "changed": true }` |

An address needs `label`, `recipientName`, `phone`, `addressLine1`, `subdistrict`, `district`, `province`, and `postalCode`. `addressLine2` may be omitted or null; `country` may be omitted or must be `"TH"`. The phone is a 9- or 10-digit domestic number and the postal code is five digits. A customer can store at most 20 addresses; creating another returns 409. Each customer has at most one shipping default and one billing default. The first address becomes both. Setting one default leaves the other unchanged. Deleting a default promotes the oldest remaining address for that default type. Address IDs must belong to the signed-in customer.

Requesting an email change verifies the current password and sends an eight-digit code to the proposed address. A new request replaces the previous pending code. The code expires after ten minutes and five incorrect confirmation attempts make it unusable. Request attempts are limited to three per hour per customer/IP; confirmation attempts are limited to five per ten minutes per customer/IP, with 429 and `Retry-After` when limited. Confirmation moves the account and identity claim to the new address, marks the address verified, consumes the code, and revokes every customer session. **Sign in again with the new email after a successful confirmation.** The raw Better Auth `/api/v1/auth/change-email` route is not available.
