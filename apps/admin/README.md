# Admin

Administration React 19 and Vite single-page application.

```bash
bun --filter admin dev
bun --filter admin typecheck
bun --filter admin lint
bun --filter admin build
```

The development server uses port 5184 and preview uses 4184. Set `VITE_API_URL` in `.env.local` to override the API URL; it defaults to `http://localhost:6767` during development.

Production builds require `VITE_API_URL` to be an HTTP(S) API origin, for example `https://api.example.com` (no credentials, path, query, or fragment). Set it in the production build environment. Configure the API's `ADMIN_URL` to the deployed admin origin and include that same origin in `CORS_ORIGINS` so credentialed requests and browser mutations use the existing origin policy.

The app consumes the Elysia `App` type through Eden Treaty and imports shared UI from `@workspace/ui`.

The admin catalog and inventory screens can use the API's repeatable demo product and stock dataset. Follow the [API demo seed setup](../api/README.md#catalog-and-inventory-demo-seed) to configure an HTTPS asset base, verify the development database, and seed an existing owner account.
