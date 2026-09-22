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

## Quality checks

```bash
bun run check
```

This runs linting, type checking, API integration tests, and production frontend builds. GitHub Actions runs the same command for pull requests and pushes to `main`.

## API configuration

The API accepts `HOST`, `PORT`, and `CORS_ORIGINS`. In production, set `NODE_ENV=production` and provide a comma-separated `CORS_ORIGINS` allowlist of exact frontend origins. The API refuses to start without it.
