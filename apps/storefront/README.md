# Storefront

Customer-facing React 19 and Vite single-page application.

```bash
bun --filter storefront dev
bun --filter storefront typecheck
bun --filter storefront lint
bun --filter storefront build
```

The development server uses port 5183 and preview uses 4183. Set `VITE_API_URL` and `VITE_ADMIN_URL` in `.env.local` to override the API and staff sign-in destinations; they default to `http://localhost:6767` and `http://localhost:5184`.

The app consumes the Elysia `App` type through Eden Treaty and imports shared UI from `@workspace/ui`.

## Store and checkout

Catalog, product detail, cart, checkout totals, and order status come from the API. The cart is held by the server; a guest cart is merged when a customer signs in. Checkout supports Stripe for customers and guests, while COD requires a signed-in customer account. Stripe success and cancel returns only display the order state reported by the API; payment confirmation comes from the API's verified Stripe webhook.

Guest order email links contain the order ID but not the guest access token. Enter the token from the email on `/orders/guest/{orderId}`; it is sent to the API in `X-Order-Access-Token`. Stripe return context is temporary to the current browser tab, so if that tab context is missing, retrieve the guest order from the confirmation email or sign in to view customer orders.

The API must have the commerce and Stripe migrations applied before enabling checkout. Configure the exact storefront origin as `STOREFRONT_URL`, include it in production `CORS_ORIGINS`, set `VITE_API_URL` to the API origin, configure Stripe success/cancel URLs on the storefront origin, and register the documented Stripe webhook events before accepting online orders. Checkout stays unavailable until staff configure shipping and enable checkout through the API.
