# syntax=docker/dockerfile:1

FROM oven/bun:1.3.14 AS base
WORKDIR /app

# Workspace manifests only, so dependency layers stay cached until a lockfile or package.json changes.
FROM base AS manifests
COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/
COPY apps/storefront/package.json apps/storefront/
COPY apps/admin/package.json apps/admin/
COPY packages/ui/package.json packages/ui/
COPY packages/config/package.json packages/config/

FROM manifests AS deps
RUN bun install --frozen-lockfile

FROM deps AS build-web
COPY . .
# Vite embeds these at build time.
ARG VITE_API_URL=http://localhost:6767
ARG VITE_ADMIN_URL=http://localhost:4184
ARG VITE_SITE_URL=http://localhost:4183
# Storefront tracking; empty disables each one.
ARG VITE_POSTHOG_KEY=
ARG VITE_POSTHOG_HOST=
ARG VITE_META_PIXEL_ID=
ARG VITE_TIKTOK_PIXEL_CODE=
ARG VITE_GOOGLE_ADS_ID=
ENV VITE_API_URL=$VITE_API_URL VITE_ADMIN_URL=$VITE_ADMIN_URL VITE_SITE_URL=$VITE_SITE_URL \
  VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST \
  VITE_META_PIXEL_ID=$VITE_META_PIXEL_ID VITE_TIKTOK_PIXEL_CODE=$VITE_TIKTOK_PIXEL_CODE \
  VITE_GOOGLE_ADS_ID=$VITE_GOOGLE_ADS_ID
RUN bun --filter storefront build && bun --filter admin build

FROM caddy:2-alpine AS web
# Serves both SPAs; TLS terminates at the ingress (Traefik on Dokploy).
# try_files falls back to index.html so client-side routes survive a reload.
COPY <<'EOF' /etc/caddy/Caddyfile
{
	auto_https off
	admin off
}

(spa) {
	encode zstd gzip
	header /assets/* Cache-Control "public, max-age=31536000, immutable"
	try_files {path} /index.html
	file_server
}

:4183 {
	root * /srv/storefront
	import spa
}

:4184 {
	root * /srv/admin
	import spa
}
EOF
COPY --from=build-web /app/apps/storefront/dist /srv/storefront
COPY --from=build-web /app/apps/admin/dist /srv/admin
EXPOSE 4183 4184

FROM deps AS migrate
COPY packages/config packages/config
COPY apps/api apps/api
WORKDIR /app/apps/api
CMD ["bun", "./node_modules/.bin/drizzle-kit", "migrate", "--config", "drizzle.config.ts"]

FROM manifests AS api
RUN bun install --frozen-lockfile --production --filter api
COPY packages/config packages/config
COPY apps/api apps/api
WORKDIR /app/apps/api
USER bun
EXPOSE 6767
CMD ["bun", "src/index.ts"]
