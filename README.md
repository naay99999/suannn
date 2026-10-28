# Suannn

Suannn is a Bun workspace with an Elysia API, a customer storefront, an administration app, and a shared shadcn/ui package.

## Workspace

- `apps/api`: Elysia HTTP API on port 6767
- `apps/storefront`: customer-facing React/Vite app on port 5183
- `apps/admin`: administration React/Vite app on port 5184
- `packages/ui`: shared UI components, Tailwind theme, and utilities
- `packages/config`: shared TypeScript and Oxlint configuration

## Development

```bash
bun install
bun run dev
```

Use `bun run dev:api`, `bun run dev:storefront`, or `bun run dev:admin` to start one application. Copy an app's `.env.example` to `.env.local` before overriding its API URL.

## Run with Docker

```bash
cp .env.example .env   # fill in BETTER_AUTH_SECRET, COMMERCE_SECRET, RESEND_API_KEY, AUTH_EMAIL_FROM
docker compose up --build
```

This starts PostgreSQL, applies Drizzle migrations once, then serves:

- storefront at http://localhost:4183
- admin at http://localhost:4184
- API at http://localhost:6767
- PostgreSQL at `localhost:5433` (user and password `postgres`, database `suannn`)

Create the first owner invitation with `docker compose run --rm api bun src/cli/bootstrap-owner.ts <email>`. `docker compose down -v` removes the database volume. The frontend API URLs are baked in at build time through the `web` service build args.

Production runs the same images through Dokploy; see [`docs/deployment.md`](docs/deployment.md).

## Quality checks

```bash
bun run check
```

This runs linting, type checking, all tests, and production frontend builds. `bun run check:fast` skips the API integration tests. CI runs the fast check and the integration suite as parallel jobs for pull requests and `main`; on `staging` it skips the integration suite, which the lefthook pre-push hook (`lefthook.yml`, installed by `bun install`) runs locally instead. See [`docs/deployment.md`](docs/deployment.md).

## API configuration

The API requires PostgreSQL, Better Auth secrets/origins, and a verified Resend sender. In production, set `NODE_ENV=production` and provide a comma-separated `CORS_ORIGINS` allowlist of exact frontend origins. The API refuses to start without it. See [`apps/api/README.md`](apps/api/README.md) for migration order, owner bootstrap/recovery, staff MFA onboarding, proxy trust, audit retention, and the V1 email limitation.
