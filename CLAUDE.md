@AGENTS.md

## Media library (Cloudflare R2)

Product galleries and farm images come from a shared media library (`apps/api/src/modules/media`), not URL columns. Spec: `docs/superpowers/specs/2026-10-19-media-library-r2-design.md`; setup details: `apps/api/README.md` → "Media library".

- Uploads go through the API: sharp converts to WebP (`display` ≤2000px q80, `thumb` ≤480px q75, metadata stripped) and stores `media/{id}/display.webp` and `thumb.webp` in R2. Duplicate bytes return the existing item (SHA-256 dedup).
- URLs are derived at read time from `R2_PUBLIC_URL` and never stored, so changing the public domain is a config change only.
- Products reference media through `product_image` (ordered, max 12, first is the cover); farms use `cover_media_id` / `portrait_media_id`. FKs are `restrict`: an image in use cannot be deleted. Archiving a product or farm detaches its images.
- Publishing requires at least one image with alt text (products) or a cover with alt text (farms). Alt text lives on the media item, so editing it changes every usage.
- Env (`apps/api/.env.local`): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_URL` — all five or none (partial is a startup error). With none, uploads return 503 and image fields are empty, so products cannot be published.
- Use one bucket per environment. `R2_PUBLIC_URL` is the bucket's public URL (`https://pub-….r2.dev` for development; a custom domain in production — `r2.dev` is rate limited and not edge-cached). It is not the `*.r2.cloudflarestorage.com` S3 endpoint.
- `db:seed:demo` requires R2 and uploads demo images from `apps/storefront/public/images`.
- Local dev (2026-10-19): bucket `suann-dev`; the existing dev database was migrated in place and demo images were attached, instead of being reset.
- TODO: `apps/api/.env.example` still lacks the five `R2_*` names (agent edits to that file are blocked by the sandbox).
