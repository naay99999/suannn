# API Repository Guidelines

## Structure and Responsibilities

This package is the Bun/Elysia HTTP API. `src/app.ts` composes plugins and feature modules and exports the `App` type consumed by Eden Treaty clients. `src/index.ts` loads configuration, creates dependencies, starts the server, and handles shutdown. Keep feature code in `src/modules/<feature>/`, cross-cutting Elysia behavior in `src/plugins/`, configuration in `src/config/`, Drizzle setup and schemas in `src/database/`, and small shared utilities in `src/shared/`.

Organize related features under a bounded context when useful, as in `src/modules/auth/{customer,staff,invitations,mfa}/`. Keep independent supporting modules at the top level. Add a repository only when a feature needs persistence. Avoid growing `app.ts` with business logic or combining unrelated auth flows in one service.

Within a feature, `index.ts` defines the Elysia routes, HTTP context, validation, authorization, and response contracts. `model.ts` defines HTTP schemas; these are distinct from Drizzle database schemas. `service.ts` owns business rules and orchestration, while `repository.ts` owns database access. The usual dependency direction is route → service → repository. Pass only the values a service needs, not the full Elysia `Context`. Prefer the existing Elysia module and plugin pattern over controller classes.

## HTTP Contracts and Cross-Cutting Behavior

- Put routes under the established `/api/v1` paths. Define request and response schemas, expected status codes, and OpenAPI details alongside each route. Reuse shared HTTP models where appropriate. Keep the `App` export accurate so clients infer contracts rather than duplicate request or response types.
- Use the existing auth macros for session, customer verification, staff access, and permissions. Apply the browser mutation guard to cookie-authenticated writes and the application rate limiter to sensitive operations. Do not bypass the Better Auth HTTP allowlist when adding auth behavior.
- Map application errors through the shared error handling policy. Application routes return safe `{ code, message }` errors; Better Auth routes retain their documented response format. Never send internal exceptions, stack traces, secrets, or sensitive account details to clients.
- Keep request IDs and structured request/error logging through the shared plugins. Avoid logging credentials, tokens, cookies, raw request bodies, or sensitive URL values. Use the request context for audit metadata instead of reading untrusted forwarding headers directly.
- Use exact, configured frontend origins for credentialed CORS and browser mutation checks. Add a new origin deliberately in configuration and the related auth policy; do not relax origin or CSRF checks to make a client work.

## Data, Authentication, and Migrations

Keep persistence logic in repositories and business decisions in services. For security-sensitive mutations, record the audit event in the same domain transaction as the change when that flow requires atomicity. Preserve the existing identity reservation, session, permission, and rate-limit policies when extending authentication flows.

Edit Drizzle schemas in `src/database/schema/` and commit generated migrations under `drizzle/`. After changing Better Auth plugins or schema options, run `bun run auth:generate`, inspect the generated auth schema, then run `bun run db:generate` and review the migration. Apply pending migrations with `bun run db:migrate` before starting an API version that depends on them. Never hand-edit an applied migration or silently change the database contract.

## Commands and Verification

Run commands from `apps/api/`, or use `bun --filter api <script>` from the workspace root:

```bash
bun run dev
bun run typecheck
bun run lint
bun run test:unit
bun run test:integration
bun run test                # unit, then integration
bun run auth:generate
bun run db:generate
bun run db:migrate
```

Use Bun's test runner and keep tests under `test/unit/` or `test/integration/` with `*.test.ts` names. Cover route contracts, validation and error responses, authorization boundaries, service rules, and persistence behavior affected by a change. Prefer unit tests for isolated behavior and integration tests for database-backed flows. Run `typecheck`, `lint`, and the relevant test suites for API changes.

Integration tests require a dedicated PostgreSQL `TEST_DATABASE_URL`. They reset the `public` and `drizzle` schemas and reject a database whose actual name does not end in `_test`. Check the target before running `test:integration` or `test`; never point either command at a development or production database.

## Configuration and Review

Use `.env.example` as the configuration reference and keep local values in `.env.local`; never commit secrets. Production CORS origins and trusted proxy headers must be explicit. Trust proxy headers only when the ingress overwrites them. Call out new environment variables, migrations, and deployment ordering in the pull request.

Write strict TypeScript with two-space indentation, single quotes, no semicolons, and trailing commas where appropriate. Use camelCase for functions and variables, PascalCase for types, and lowercase feature directories. Keep commits focused with short imperative subjects. Pull requests should describe user-visible behavior, list validation run, link the issue when relevant, and identify schema or configuration changes.
