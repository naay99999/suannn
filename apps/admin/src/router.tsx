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
              {
                path: 'new',
                element: <PermissionGate permission="catalog:create" />,
                children: [{ index: true, lazy: () => import('./pages/products/product-create-page') }],
              },
              { path: ':productId', lazy: () => import('./pages/products/product-detail-page') },
            ],
          },
          {
            path: 'inventory',
            element: <PermissionGate permission="inventory:read" />,
            children: [
              { index: true, lazy: () => import('./pages/inventory/inventory-page') },
              { path: 'lots/new', lazy: () => import('./pages/inventory/receive-lot-page') },
              { path: 'reservations', lazy: () => import('./pages/inventory/reservation-lookup-page') },
              { path: 'reservations/new', lazy: () => import('./pages/inventory/reservation-create-page') },
              { path: 'reservations/:reservationId', lazy: () => import('./pages/inventory/reservation-detail-page') },
              { path: 'lots/:lotId', lazy: () => import('./pages/inventory/lot-detail-page') },
              { path: 'variants/:variantId', lazy: () => import('./pages/inventory/variant-stock-page') },
              { path: 'movements', lazy: () => import('./pages/inventory/movements-page') },
            ],
          },
          {
            path: 'orders',
            element: <PermissionGate permission="order:read" />,
            children: [
              { index: true, lazy: () => import('./pages/orders/orders-page') },
              { path: ':orderId', lazy: () => import('./pages/orders/order-detail-page') },
            ],
          },
          { path: 'customers', lazy: () => import('./pages/customers/customers-page') },
          { path: 'settings', lazy: () => import('./pages/settings/system-settings-page') },
        ],
      },
    ],
  },
])
