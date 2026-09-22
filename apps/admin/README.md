# Admin

Administration React 19 and Vite single-page application.

```bash
bun --filter admin dev
bun --filter admin typecheck
bun --filter admin lint
bun --filter admin build
```

The development server uses port 5184 and preview uses 4184. Set `VITE_API_URL` in `.env.local` to override the API URL; it defaults to `http://localhost:6767`.

The app consumes the Elysia `App` type through Eden Treaty and imports shared UI from `@workspace/ui`.
