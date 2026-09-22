# Repository Guidelines

## Project Structure & Module Organization

This package is the Bun/Elysia HTTP API. Application composition and the exported `App` type live in `src/app.ts`; `src/index.ts` loads configuration and starts the server. Keep features in `src/modules/<feature>/`, cross-cutting Elysia plugins in `src/plugins/`, configuration in `src/config/`, and database setup and Drizzle schemas in `src/database/`. Shared utilities such as logging belong in `src/shared/`.

Use a feature-based Elysia structure rather than introducing traditional controller classes. An Elysia instance in `index.ts` is the controller and owns routes, HTTP context, validation, and response contracts. Keep business rules in `service.ts`, database access in `repository.ts` when needed, and Elysia/HTTP schemas in `model.ts` (these are not Drizzle database models). The normal dependency direction is `index.ts -> service.ts -> repository.ts`; `index.ts` also references `model.ts`. Services and repositories should not receive or depend on the full Elysia `Context`.

Group related features under a bounded-context directory when useful, for example `src/modules/auth/{customer,staff,invitations,mfa}/`. Keep independent supporting modules such as `audit`, `email`, `identity-claims`, `rate-limit`, and `system` at the top level. Do not create a repository for a feature that has no persistence concerns, and do not combine separate auth features into one large service.

Tests live in `test/` and use `*.test.ts` names (for example, `test/api.test.ts`). Drizzle migration output is committed under `drizzle/`.

## Build, Test, and Development Commands

Run these from this directory, or prefix them from the workspace root with `bun --filter api`:

```bash
bun run dev            # start the API with file watching
bun run test           # run Bun's test suite
bun run typecheck      # run TypeScript without emitting files
bun run lint           # lint src/ and test/ with Oxlint
bun run db:generate    # create Drizzle migrations from schema changes
bun run db:migrate     # apply pending migrations
```

Run `bun run auth:generate` after changing Better Auth plugins or schema options, then generate and apply the corresponding migration.

## Coding Style & Naming Conventions

Write strict TypeScript using two-space indentation, single quotes, no semicolons, and trailing commas where appropriate. Use camelCase for functions and variables, PascalCase for types, and lowercase feature directories. Keep routes and their response validation within their module. Any API composition change must preserve the `App` export in `src/app.ts` so Eden Treaty clients retain inferred types.

Prefer small Elysia plugins and modules over adding unrelated logic to `app.ts`. Return the established `{ code, message }` error shape; never expose internal errors to clients.

## Testing Guidelines

Use Bun's built-in test runner and keep unit or route coverage beside related test concerns in `test/`. Test public behavior, configuration failures, error responses, and authentication boundaries. Run `bun run test`, `bun run typecheck`, and `bun run lint` before submitting changes.

## Configuration, Commits & Pull Requests

Copy `.env.example` to `.env.local`; never commit secrets. Required production CORS origins must be exact and are also Better Auth trusted origins. Use concise imperative commits, such as `Add health check route`. Pull requests should describe user-visible behavior, link the issue when relevant, list validation run, and call out schema or environment-variable changes.
