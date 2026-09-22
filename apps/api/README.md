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

Copy `.env.example` to `.env.local` and set `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL`. The defaults are `HOST=0.0.0.0` and `PORT=6767`.

For production, set `NODE_ENV=production` and `CORS_ORIGINS` to a comma-separated list of exact frontend origins. Startup fails if the allowlist is absent. These origins are also Better Auth's trusted origins and receive credentialed CORS responses.

After changing Better Auth plugins or schema options, run `bun --filter api auth:generate`, then create and apply a Drizzle migration with `db:generate` and `db:migrate`.

## Endpoints

- `GET /api/v1/docs` serves the interactive Scalar API reference.
- `GET /api/v1/openapi.json` serves the generated OpenAPI specification for v1.
- `GET /api/v1` returns the API welcome response.
- `GET /api/v1/health` returns `{ "status": "ok" }` for liveness checks.
- `/api/v1/auth/*` provides Better Auth's email/password signup, signin, signout, and session endpoints. Each enabled Better Auth operation is included in the generated OpenAPI reference.

Errors use `{ "code", "message" }` and never expose internal stack traces to clients.
