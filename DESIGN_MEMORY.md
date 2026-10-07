# Storefront auth design memory

- Selected direction: B, refined into a full-width split layout without a card, border or rounded container. Single fruit photo beside the form on desktop and a short photo band on mobile.
- Keep the screen calm but visually grounded; use one photo rather than adding content.
- Preserve Satoshi / Noto Sans Thai, shared semantic color tokens, 48px inputs and the pill login button.
- Primary task: login. Secondary actions: password recovery, registration and return to products.
- Avoid accordions, long help text, benefit cards, stories, marquees and extra marketing sections on sign-in.
- Responsive: one column below 1024px; full-width 40/60 split above it, with the form capped at 448px. Let short screens scroll normally.
- Use existing shared primitives and gentle motion that respects reduced-motion preferences.
- Apply this shared full-width layout to sign-in, sign-up, forgot-password and reset-password through `AuthPageFrame` in `auth-layout.tsx`.
- No footer on any auth route, including token-based reset-password routes. Keep the compact brand/navigation header.
- Mobile form content starts 32px below the photo rather than centering vertically in spare space. Use an explicit auto-height photo grid row. Desktop form centers in the right column.
- Success states use plain text and the relevant next action rather than a separate card. Inputs have associated error descriptions, and password creation explains the 12-character minimum.

## Storefront products

- Selected variant B: plain sidebar and page surfaces, with cards reserved for products. Avoid wrapping the toolbar, filters or closing links in decorative cards.
- Sidebar search and category navigation on desktop; compact category disclosure on smaller screens. Sorting and current-page result count belong above the product grid.
- Product cards use a square photo, clear category/name/availability/price and a bottom-aligned 44px cart action. Image and text link to product details; cart buttons sit outside the link.
- Add directly using the lowest-price purchasable variant, or adjust the existing cart variant. Show the variant name and unit. After adding, replace the action with minus/quantity/plus; decrementing one removes the line. Cart data is authoritative, updates are disabled while pending, and failures appear inline without changing the quantity.
- Responsive catalog: 1 column on very narrow content, 2 mobile, 3 tablet, 4 desktop; sidebar at 900px container width. Use container queries and existing semantic tokens.
- URL filters and cursor reset behavior must survive layout changes. Use matching skeletons and plain recovery states.
