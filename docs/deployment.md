# Deployment

Production runs on a VPS managed by [Dokploy](https://dokploy.com). GitHub Actions builds the images; Dokploy pulls them, runs the stack from `compose.prod.yaml`, and terminates TLS with Traefik.

```
push to main ──► Quality (lint, typecheck, tests, builds)
                    │ success
                    ▼
                 Release ──► build api / migrate / web images ──► ghcr.io/naay99999/suannn-*
                    │
                    ▼ POST /api/compose.deploy
                 Dokploy ──► Traefik (TLS)
                              ├─ example.com        → web:4183  (storefront)
                              ├─ admin.example.com  → web:4184  (admin)
                              └─ api.example.com    → api:6767
                             migrate (runs once per deploy) ──► Dokploy PostgreSQL
```

The storefront, admin, and API use separate subdomains of one registrable domain, so session cookies stay same-site and the API's per-route origin checks apply unchanged.

## One-time setup

### DNS

Create `A` records for the storefront, admin, and API hosts that point at the VPS.

### GitHub

Repository **variables** (Settings → Secrets and variables → Actions → Variables). Vite embeds them at build time:

| Variable | Example |
|---|---|
| `API_URL` | `https://api.example.com` |
| `ADMIN_URL` | `https://admin.example.com` |

Repository or `production` environment **secrets**, used to trigger the deploy. Release still pushes images when they are absent:

| Secret | Value |
|---|---|
| `DOKPLOY_URL` | Dokploy panel origin, e.g. `https://dokploy.example.com` |
| `DOKPLOY_API_KEY` | Dokploy → Settings → Profile → API/CLI token |
| `DOKPLOY_COMPOSE_ID` | ID of the compose app (`GET /api/project.all`, or the panel URL) |

GHCR packages start private. Either make the three `suannn-*` packages public or add a GHCR registry in Dokploy with a PAT that has `read:packages`.

### Dokploy

1. Create a **PostgreSQL** database service and configure scheduled backups. Copy its internal connection URL.
2. Create a **Docker Compose** app from this repository with compose path `compose.prod.yaml`. Leave Dokploy's own auto-deploy off; the Release workflow triggers deploys.
3. Set its environment:

   ```dotenv
   DATABASE_URL=postgresql://...            # internal URL from step 1
   API_URL=https://api.example.com
   STOREFRONT_URL=https://example.com
   ADMIN_URL=https://admin.example.com
   BETTER_AUTH_SECRET=                      # openssl rand -base64 32
   COMMERCE_SECRET=                         # 32 random bytes, unpadded base64url
   RESEND_API_KEY=
   AUTH_EMAIL_FROM=Suannn <auth@example.com> # sender on a domain verified in Resend
   # TRUSTED_PROXY_HEADERS=x-real-ip         # default; use cf-connecting-ip behind Cloudflare proxy
   # STRIPE_API_KEY / STRIPE_WEBHOOK_SECRET / STRIPE_SUCCESS_URL / STRIPE_CANCEL_URL
   ```

4. Add domains (HTTPS on, Let's Encrypt): `web` port `4183` → storefront host, `web` port `4184` → admin host, `api` port `6767` → API host.
5. Deploy once manually, then create the first owner from the `api` container terminal:

   ```bash
   bun src/cli/bootstrap-owner.ts owner@example.com
   ```

### Stripe (optional)

With `NODE_ENV=production` the API only accepts a restricted `rk_live_` key. Register a webhook endpoint at `https://api.example.com/api/v1/webhooks/stripe` for the events listed in `apps/api/.env.example`, and use that endpoint's signing secret. Success and cancel URLs must use the storefront origin.

## Routine deploys

Merge to `main`. Quality runs, Release pushes `:main` and `:<sha>` tags and triggers Dokploy, which pulls the new images, runs `migrate`, then restarts `api` and `web`. Run Release manually from the Actions tab to redeploy without a new commit.

To roll back, set `IMAGE_TAG=<previous sha>` in the Dokploy environment and redeploy. Migrations are forward-only, so roll back only across releases without schema changes.
