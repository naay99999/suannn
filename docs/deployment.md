# Deployment

Production runs on a VPS managed by [Dokploy](https://dokploy.com). GitHub Actions builds the images; Dokploy pulls them, runs the stack from `compose.prod.yaml`, and terminates TLS with Traefik.

```
push to main/staging ──► CI (.github/workflows/ci.yml), in parallel:
                           ├─ check        lint+typecheck, api, storefront, admin tests, builds (parallel)
                           ├─ integration  API integration tests (main and PRs only)
                           └─ images       build api / migrate / web ──► ghcr.io/naay99999/suannn-*:<sha>
                                │ all passed
                                ▼
                         deploy ──► tag :<sha> as :main or :staging
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
| `STOREFRONT_URL` | `https://example.com` (canonical URLs, Open Graph, sitemap) |

The image build fails if any of these three is missing, so a web image never ships with a localhost URL.

Optional storefront tracking variables. They are public browser IDs, so variables rather than secrets; leave one unset to disable it:

| Variable | Embedded as |
|---|---|
| `POSTHOG_KEY` | `VITE_POSTHOG_KEY` (project API key, `phc_…`) |
| `POSTHOG_HOST` | `VITE_POSTHOG_HOST` (defaults to `https://us.i.posthog.com`) |
| `META_PIXEL_ID` | `VITE_META_PIXEL_ID` |
| `TIKTOK_PIXEL_CODE` | `VITE_TIKTOK_PIXEL_CODE` |
| `GOOGLE_ADS_ID` | `VITE_GOOGLE_ADS_ID` (`AW-…`) |

Repository or `production` environment **secrets**, used to trigger the deploy. CI still pushes and tags images when they are absent:

| Secret | Value |
|---|---|
| `DOKPLOY_URL` | Dokploy panel origin, e.g. `https://dokploy.example.com` |
| `DOKPLOY_API_KEY` | Dokploy → Settings → Profile → API/CLI token |
| `DOKPLOY_COMPOSE_ID` | ID of the compose app (`GET /api/project.all`, or the panel URL) |

GHCR packages start private. Either make the three `suannn-*` packages public or add a GHCR registry in Dokploy with a PAT that has `read:packages`.

### Dokploy

1. Create a **PostgreSQL** database service and configure scheduled backups. Copy its internal connection URL.
2. Create a **Docker Compose** app from this repository with compose path `compose.prod.yaml`. Leave Dokploy's own auto-deploy off; the CI workflow triggers deploys.
3. Set its environment. `.env.example` in the repository root is the full template with every variable `compose.prod.yaml` reads; the essentials are:

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

   # Media library (Cloudflare R2). All five or none; without them uploads return 503
   # and products and farms cannot be published, so production needs them.
   R2_ACCOUNT_ID=
   R2_ACCESS_KEY_ID=
   R2_SECRET_ACCESS_KEY=
   R2_BUCKET=suannn-prod
   R2_PUBLIC_URL=https://media.example.com

   # Optional server-side tracking and marketing reports; each group is all-or-none.
   # See apps/api/README.md for what each group enables.
   # POSTHOG_API_KEY / POSTHOG_HOST
   # POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID
   # META_PIXEL_ID / META_CAPI_ACCESS_TOKEN (+ META_TEST_EVENT_CODE)
   # META_ADS_ACCOUNT_ID / META_ADS_ACCESS_TOKEN
   # TIKTOK_PIXEL_CODE / TIKTOK_EVENTS_ACCESS_TOKEN (+ TIKTOK_TEST_EVENT_CODE)
   # TIKTOK_ADVERTISER_ID / TIKTOK_MARKETING_ACCESS_TOKEN
   # GOOGLE_ADS_DEVELOPER_TOKEN / _CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN / _CUSTOMER_ID / _CONVERSION_ACTION_ID (+ _LOGIN_CUSTOMER_ID)
   # TRACKING_ALERT_EMAIL
   ```

4. Add domains (HTTPS on, Let's Encrypt): `web` port `4183` → storefront host, `web` port `4184` → admin host, `api` port `6767` → API host.
5. Deploy once manually, then create the first owner from the `api` container terminal:

   ```bash
   bun src/cli/bootstrap-owner.ts owner@example.com
   ```

### Cloudflare R2

Create a production-only bucket (never share one with development or CI) and an R2 API token scoped to it with object read/write. Connect a custom domain to the bucket and use it as `R2_PUBLIC_URL`; `r2.dev` URLs are rate limited and not edge-cached. `R2_PUBLIC_URL` is the public URL, not the `*.r2.cloudflarestorage.com` S3 endpoint. Image URLs are derived from it at read time, so changing the domain later is a config change only.

### Stripe (optional)

With `NODE_ENV=production` the API only accepts a restricted `rk_live_` key. Register a webhook endpoint at `https://api.example.com/api/v1/webhooks/stripe` for the events listed in `apps/api/.env.example`, and use that endpoint's signing secret. Success and cancel URLs must use the storefront origin.

## Staging

A staging stack is the same `compose.prod.yaml` deployed from the `staging` branch. CI builds `:staging` images under the `staging` GitHub environment (main uses `production`), so put that stack's `API_URL`, `ADMIN_URL`, `STOREFRONT_URL`, and `DOKPLOY_*` values on the `staging` environment in GitHub. In the Dokploy compose app set:

```dotenv
DEPLOY_ENV=staging   # keeps production hardening but requires a Stripe rk_test_ key
IMAGE_TAG=staging
```

Use a test-mode Stripe webhook endpoint on the staging API host and its signing secret.

CI skips the integration suite on staging pushes to deploy sooner. A lefthook pre-push hook (`lefthook.yml`, installed by `bun install`) runs it locally when pushing from `main` or `staging`. It uses `TEST_DATABASE_URL`, defaulting to `postgresql://$(whoami)@127.0.0.1:5432/suannn_test`. Skip it once with `git push --no-verify`.

## Routine deploys

Merge to `main`. CI runs the full suite while it builds `:<sha>` images; when everything passes it tags them `:main` and triggers Dokploy, which pulls the new images, runs `migrate`, then restarts `api` and `web`. Run CI manually from the Actions tab (on `main` or `staging`) to redeploy without a new commit.

To roll back, set `IMAGE_TAG=<previous sha>` in the Dokploy environment and redeploy. Migrations are forward-only, so roll back only across releases without schema changes.
