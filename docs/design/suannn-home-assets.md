# suannn home assets

The homepage uses illustrative catalog data, not verified inventory. No prices,
farmer identities, certification claims, customer reviews, or ordering flow are
invented. Replace `apps/storefront/src/pages/home/home-data.ts` with the typed
catalog API when real data becomes available.

## Generated hero

- File: `apps/storefront/public/images/fruit-hero.jpg`
- Generator: built-in imagegen tool, September 26, 2026
- Original: 1536 × 1024 PNG, converted to JPEG for the web
- Purpose: brand illustration; not a photograph of a partner farmer's produce
- Prompt:

> Create a premium photorealistic editorial still life photograph for a modern Thai farm-to-table fruit marketplace brand 'suannn'. Wide landscape 1536x1024. Pure off-white very pale mint seamless studio background. A beautifully composed low wide still life cluster across the BOTTOM two thirds: a cream canvas open market tote overflowing with fresh Thai ripe yellow mangoes, tangerines with green leaves, a halved pink guava, a pineapple, lime and mangosteen, with a few fruits on the surface, graceful lush glossy green leaves. A small bright emerald green reusable produce crate at right. Sophisticated soft morning side light, soft realistic shadows, tactile fruit peel with droplets, extremely realistic commercial food photography. Generous empty pale background top third. Camera eye level slightly above table. Bright airy fresh youthful luxury grocery aesthetic, natural colours with primary emerald green #16A34A. No text, no labels, no logo, no letters, no UI, no badges. Fruit is hero; balanced organic arrangement, not crowded. Save as image asset.

## Illustrative photographs

Locally saved from Unsplash's image service. These images illustrate product
types and the brand story; they are not evidence of farmer partnerships.

- `mango.jpg`: https://images.unsplash.com/photo-1553279768-865429fa0078
- `orange.jpg`: https://images.unsplash.com/photo-1547514701-42782101795e
- `avocado.jpg`: https://images.unsplash.com/photo-1523049673857-eb18f1d7b578
- `hero.jpg`: https://images.unsplash.com/photo-1416879595882-3373a0480b5b

The processed mango card intentionally labels its fresh mango photograph as an
ingredient illustration. Replace it with an actual packaged product photograph.

## Typography

- Satoshi (400, 500, 700, 900), local WOFF2 files in `packages/ui/src/assets/fonts/` from Fontshare:
  https://www.fontshare.com/fonts/satoshi
- Noto Sans Thai Variable, locally bundled through Fontsource.

## Interaction and motion

- Category filters show all, fresh fruit, or processed products.
- Shared Base UI dialogs show example product details and availability limits.
- Category accordion expands on mouse, keyboard focus, or tap.
- Brand-story carousel is user controlled; the marquee has a pause button.
- GSAP pins the transparency heading and stacks its cards on larger screens.
- Reduced-motion preference removes animation and pinning; content stays visible.
- Branding tokens are scoped to `.suannn-store` inside the shared globals stylesheet.
