# Repository Guidelines

## Workspace Structure

This is a Bun workspace. Deployable applications live in `apps/`; reusable code and configuration live in `packages/`.

- `apps/api/` is the Bun/Elysia HTTP API. Define routes and exported API types in `src/app.ts`; `src/index.ts` starts the server.
- `apps/storefront/` is the customer-facing React 19/Vite single-page application.
- `apps/admin/` is the React 19/Vite administration single-page application.
- `packages/ui/` is the shared shadcn/ui component library, global Tailwind CSS v4 theme, UI utilities, and hooks. Import it as `@workspace/ui`.
- `packages/config/` contains the shared TypeScript and Oxlint configuration presets.

In each frontend app, keep app-specific pages and UI in `src/`, API clients in `src/lib/`, static public files in `public/`, and imported images in `src/assets/`. Use the `@/` alias for app-local imports. Both frontends consume the API through Eden Treaty and the `App` type exported by the `api` workspace.

## Shared UI and Styling

Both frontends use Tailwind CSS v4, shadcn/ui (`base-vega`), Base UI primitives, and Hugeicons. The canonical theme and generated shared components belong in `packages/ui/`:

- Import shared components from `@workspace/ui/components/*`, utilities from `@workspace/ui/lib/*`, and hooks from `@workspace/ui/hooks/*`.
- Add or update reusable shadcn components in `packages/ui/`, not by duplicating them under an app. App-local components should only hold application-specific composition and behaviour.
- `packages/ui/src/styles/globals.css` is the sole source of Tailwind imports, design tokens, dark-mode tokens, and shared global styles. It scans `apps/` for utility classes; do not create competing theme files in an app.
- Use semantic Tailwind tokens such as `bg-background`, `text-muted-foreground`, and component variants. Do not introduce raw colour utilities when an existing token or variant expresses the intent.
- Reuse installed shadcn components before custom styled markup. Use `cn()` for conditional classes, `gap-*` rather than `space-x-*`/`space-y-*`, and `size-*` when width and height match.
- Use the existing Hugeicons integration; do not introduce another icon library. For icons in shared shadcn buttons, pass the icon component and use the component's `data-icon` convention.

Each frontend's `components.json` points shadcn at the shared UI package and its aliases. When adding a component, use Bun's runner from the relevant project context (for example, `bunx --bun shadcn@latest add <component>`), inspect the generated changes, and preserve locally customised shared components.

## Application Tooling and Conventions

- Frontends use React Router for routes, TanStack Query for server-state fetching and caching, TanStack Table for data tables, React Hook Form with Zod and `@hookform/resolvers` for forms, and Eden Treaty (`@elysia/eden`) for typed API requests.
- API code uses Elysia and `@elysiajs/cors` on the Bun runtime. Keep API changes reflected in the exported `App` type; clients must not duplicate route request/response types.
- Vite powers both frontend development and production builds. `@tailwindcss/vite` integrates Tailwind; `@vitejs/plugin-react` provides React support.
- TypeScript is strict and frontend builds run `tsc -b` before `vite build`. Oxlint, configured through `@workspace/config/oxlint/react`, is the frontend linter.

## Build, Test, and Development Commands

Install dependencies once from the repository root:

```bash
bun install
bun run dev              # start API, storefront, and admin in parallel
bun run dev:storefront   # start only the storefront (port 5183)
bun run dev:admin        # start only admin (port 5184)
bun run dev:api          # start only API (port 6767)
bun --filter storefront build
bun --filter storefront lint
bun --filter admin build
bun --filter admin lint
bun --filter @workspace/ui typecheck
```

Run `build` and `lint` for every changed frontend; run the shared UI typecheck when changing `packages/ui/`. Frontend builds type-check with TypeScript and produce Vite bundles. The API has unit and PostgreSQL integration suites (`bun --filter api test:unit` and `bun --filter api test:integration`); integration tests require a dedicated `TEST_DATABASE_URL` ending in `_test` and reset its schemas.

## Coding Style and Naming

Use TypeScript for application code. Match the existing style: two-space indentation, single quotes, no semicolons, and trailing commas where the surrounding code uses them. Use PascalCase for React components (`App.tsx`), camelCase for functions, variables, and hooks (`loadMessage`), and concise lowercase directory names. Keep route changes reflected in the exported `App` type so typed API clients remain accurate.

Prefer composition of shared UI components over bespoke primitives. Maintain accessible component structure: dialogs, sheets, and drawers need titles; form controls need labels and invalid-state attributes; use `FieldGroup` and `Field` for shared shadcn form layouts when available.

## Configuration and Local Development

Copy the relevant `.env.example` to `.env.local` when overriding `VITE_API_URL`; never commit local environment files or secrets. The API CORS list is intentionally limited to the documented localhost frontend and preview ports—update it deliberately when adding a new client origin.

## Commit and Pull Request Guidelines

The available history contains only `init`, so no repository-specific commit syntax is established. Write short imperative subjects, such as `Add product route` or `Fix admin API status`. Keep commits focused. Pull requests should explain the user-visible change, note validation commands run, link the relevant issue when applicable, and include screenshots for storefront or admin UI changes.
