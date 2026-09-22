# Storefront

Customer-facing React 19 and Vite single-page application.

```bash
bun --filter storefront dev
bun --filter storefront typecheck
bun --filter storefront lint
bun --filter storefront build
```

The development server uses port 5183 and preview uses 4183. Set `VITE_API_URL` in `.env.local` to override the API URL; it defaults to `http://localhost:6767`.

The app consumes the Elysia `App` type through Eden Treaty and imports shared UI from `@workspace/ui`.
