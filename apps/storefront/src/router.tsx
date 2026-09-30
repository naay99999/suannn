import { createBrowserRouter, redirect } from 'react-router'
import { StorefrontRouteError } from './pages/error-page'
import { StorefrontLayout } from './pages/layout'
import { AccountLayout } from './pages/account/account-layout'
import { CustomerGuard } from './pages/auth/customer-guard'

export const router = createBrowserRouter([
  {
    Component: StorefrontLayout,
    errorElement: <StorefrontRouteError />,
    hydrateFallbackElement: (
      <div className="suannn-store grid min-h-svh place-items-center bg-background text-foreground" role="status">
        <p>กำลังเปิดสวน...</p>
      </div>
    ),
    children: [
      {
        index: true,
        lazy: () => import('./pages/home/home-page'),
      },
      {
        path: 'products',
        lazy: () => import('./pages/products/product-list-page'),
      },
      {
        path: 'peoducts',
        loader: ({ request }) => redirect(`/products${new URL(request.url).search}`),
      },
      {
        path: 'products/:slug',
        lazy: () => import('./pages/products/product-detail-page'),
      },
      {
        path: 'categories/:slug',
        lazy: () => import('./pages/categories/category-page'),
      },
      { path: 'sign-in', lazy: () => import('./pages/auth/sign-in-page') },
      { path: 'sign-up', lazy: () => import('./pages/auth/sign-up-page') },
      { path: 'forgot-password', lazy: () => import('./pages/auth/forgot-password-page') },
      { path: 'reset-password', lazy: () => import('./pages/auth/reset-password-page') },
      { path: 'reset-password/:token', lazy: () => import('./pages/auth/reset-password-page') },
      {
        path: 'checkout',
        lazy: () => import('./pages/checkout/checkout-page'),
      },
      {
        path: 'checkout/confirmation',
        lazy: () => import('./pages/checkout/confirmation-page'),
      },
      {
        path: 'checkout/confirmation/:orderId',
        lazy: () => import('./pages/checkout/confirmation-page'),
      },
      {
        path: 'account',
        Component: CustomerGuard,
        children: [
          {
            Component: AccountLayout,
            children: [
              { index: true, lazy: () => import('./pages/account/overview-page') },
              { path: 'orders', lazy: () => import('./pages/account/orders-page') },
              { path: 'orders/:orderId', lazy: () => import('./pages/account/order-detail-page') },
              { path: 'addresses', lazy: () => import('./pages/account/addresses-page') },
              { path: 'profile', lazy: () => import('./pages/account/profile-page') },
              { path: 'security', lazy: () => import('./pages/account/security-page') },
            ],
          },
        ],
      },
      {
        path: '*',
        lazy: () => import('./pages/not-found-page'),
      },
    ],
  },
])
