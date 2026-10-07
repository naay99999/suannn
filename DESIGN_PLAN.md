# Auth design: selected variant B

The user selected a single fruit photograph beside the login form, then requested a full-width layout instead of a card. Keep login, password recovery and registration as the only actions. No accordion, help section or marketing content.

## Implementation

- [x] Consolidate the full-width design in `apps/storefront/src/pages/auth/auth-layout.tsx` and remove the sign-in-only frame.
- [x] Below 1024px, use one column with a 96px photo band. Desktop uses a full-width 40/60 split without a card border or radius; the form remains capped at 448px.
- [x] Remove the sign-in main container's page-width constraint and outer padding so the photo reaches the viewport edge.
- [x] Preserve the existing sign-in form, authentication requests, cart merge and return navigation.
- [x] Use subtle GSAP entrance motion with reduced-motion support.
- [x] Remove temporary design lab source, route and brief.
- [x] Apply the shared layout to sign-in, sign-up, forgot-password and reset-password, including path/query token forms.
- [x] Remove the footer from all auth routes and replace marketing content with concise form guidance.
- [x] Match input heights, button widths, keyboard focus states and inline error descriptions across all forms.

## Validation

- [x] Storefront build passed.
- [x] Storefront lint passed with the existing Fast Refresh warning in `src/main.tsx`.
- [x] Existing auth/navigation/header tests: 26 passed.
- [x] Updated full-width browser checks at CSS widths 320, 390, 768, 1440 and landscape 667px: no horizontal overflow; mobile photo remains 96px tall.
- [x] Blank-form submission displays email/password errors and associates them with the controls.
- Updated full-width browser verification used the storefront development server.
- [x] All auth pages checked at 320px and 1440px without footer or horizontal overflow; sign-up also checked at landscape 667px.
- [x] Blank sign-up, recovery and reset forms display associated validation errors; reset without a token offers a new-link route.
- [x] Refine alignment: 40/60 desktop columns with the form centered in the right column; mobile form starts 32px below the image.
- [x] At 1920px desktop width, measured column and form centers both equal 1344px. At 440px mobile width, measured image-to-form gap is 32px. Short 1024×600 desktop permits natural page scrolling.

# Products design: selected variant B

Approved on 2026-10-08. Use a cardless page and sidebar; reserve card surfaces for products. Keep existing API queries, URL filters and product-detail purchase flow.

## Implementation

- [x] `product-list-page.tsx`: plain heading, responsive sidebar/list composition, skeleton loading and inline retry/empty states.
- [x] `catalog-filters.tsx`: sidebar search/category navigation, mobile category disclosure, result count and sorting above products. Filter changes clear the pagination cursor.
- [x] `product-card.tsx`: optional catalog appearance with square image, readable category/name/status/price, bottom-aligned 44px action and a single product-detail link. Other consumers use the default appearance.
- [x] Use 1 column on very narrow screens, 2 on mobile, 3 on tablet and 4 on desktop. Sidebar begins at a 900px content width; grids respond to the actual catalog container.
- [x] Replace the closing promotional card with a plain divider and text link.
- [x] Remove this task's temporary design lab, preview routes and briefs.

## Component and state contract

- `ProductCard`: `product: StoreProductSummary`, `appearance?: 'default' | 'catalog'`.
- `CatalogFilters`: optional fixed category; local disclosure state only. Search/category/sort/paging stay in the URL.
- Loading uses product-shaped skeletons; empty and error states provide relevant recovery actions; unavailable products retain a detail link and do not imply a cart mutation.
- Semantic shared tokens, existing Satoshi/Thai fonts, Hugeicons and shared controls. No new design tokens or dependencies.
- Keyboard-operable filter disclosure and visible focus rings; controls are at least 44px; motion respects reduced-motion preferences.

## Validation

- Existing catalog and product flow tests plus keyboard category-disclosure regression test.
- Storefront build, lint and test suite; browser checks for responsive layout, filters and product navigation.

Validation results: storefront build and lint passed (existing `main.tsx` Fast Refresh warning). Catalog/product-flow tests: 12 passed. Full storefront suite: 108 passed, 1 failed in `header.test.tsx` (`anonymous visitors can sign in from desktop and mobile navigation`) because the test expects the old origin navigation link while this workspace uses the farms link. Browser checks at 320/390/768/1440px showed 1/2/3/4 columns respectively, 44px product actions and no horizontal overflow. Mobile category selection updated URL and returned three fresh products. Product-detail navigation reached the correct URL, but the local API stopped responding on port 6767 during that check, so its live loading could not be verified.

## Catalog cart action follow-up

- Replace the catalog detail action with a separate `CatalogCartAction` outside the product link.
- Resolve a purchasable default variant lazily, choosing the lowest price; retain the existing cart variant when present and show its name/unit.
- Read quantities from the server cart; support increment, decrement and removal at zero, enforce 99, prevent repeat updates and preserve quantity on failure.
- Reuse `QuantityControl` with optional minimum, disabled state and responsive styling; existing detail and side-cart consumers retain their defaults.
- Integration tests cover direct add/update/remove, existing variants, limits, mutation retries and product-detail API failures.
- Live browser verification encountered `INTERNAL_ERROR` when resolving product variants; the error is shown inline and no cart quantity changes.
