import { createBrowserRouter, Navigate } from 'react-router'
import { AdminRouteError } from './pages/error-page'
import { AdminLayout } from './pages/layout'
import { ActiveStaffGate, OnboardingStaffGate } from './components/auth/auth-gate'
import { PermissionGate } from './components/auth/permission-gate'

export const router = createBrowserRouter([
  {
    path: 'login',
    lazy: () => import('./pages/login/login-page'),
  },
  {
    path: 'login/mfa',
    lazy: () => import('./pages/login/mfa-page'),
  },
  {
    path: 'staff/invitations/accept',
    lazy: () => import('./pages/staff/invitation-page'),
  },
  {
    path: '*',
    lazy: () => import('./pages/not-found-page'),
  },
  {
    Component: OnboardingStaffGate,
    children: [
      {
        path: 'staff/onboarding',
        lazy: () => import('./pages/staff/onboarding-page'),
      },
    ],
  },
  {
    Component: ActiveStaffGate,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      {
        Component: AdminLayout,
        errorElement: <AdminRouteError />,
        children: [
          { path: 'dashboard', lazy: () => import('./pages/dashboard/dashboard-page') },
          {
            path: 'products',
            element: <PermissionGate permission="catalog:read" />,
            children: [
              { index: true, lazy: () => import('./pages/products/products-page') },
              { path: ':productId', lazy: () => import('./pages/products/product-detail-page') },
            ],
          },
          { path: 'orders', lazy: () => import('./pages/orders/orders-page') },
          { path: 'customers', lazy: () => import('./pages/customers/customers-page') },
          { path: 'settings', lazy: () => import('./pages/settings/system-settings-page') },
        ],
      },
    ],
  },
])
