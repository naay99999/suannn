import { createBrowserRouter, redirect } from 'react-router'
import { StorefrontRouteError } from './pages/error-page'
import { StorefrontLayout } from './pages/layout'

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
        path: 'products/:id',
        lazy: () => import('./pages/products/product-detail-page'),
      },
      {
        path: 'categories/:slug',
        lazy: () => import('./pages/categories/category-page'),
      },
      {
        path: '*',
        lazy: () => import('./pages/not-found-page'),
      },
    ],
  },
])
