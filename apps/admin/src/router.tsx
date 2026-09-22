import { createBrowserRouter, redirect } from 'react-router'
import { AdminRouteError } from './pages/error-page'
import { AdminLayout } from './pages/layout'

export const router = createBrowserRouter([
  {
    path: 'login',
    lazy: () => import('./pages/login/login-page'),
  },
  {
    path: '*',
    lazy: () => import('./pages/not-found-page'),
  },
  {
    path: 'settings',
    loader: () => redirect('/dashboard#settings'),
  },
  {
    Component: AdminLayout,
    errorElement: <AdminRouteError />,
    children: [
      {
        path: 'dashboard',
        lazy: () => import('./pages/dashboard/dashboard-page'),
      },
      {
        path: 'products',
        lazy: () => import('./pages/products/products-page'),
      },
      {
        path: 'orders',
        lazy: () => import('./pages/orders/orders-page'),
      },
      {
        path: 'customers',
        lazy: () => import('./pages/customers/customers-page'),
      },
    ],
  },
])
