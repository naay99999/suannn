import { createAccessControl } from 'better-auth/plugins/access'
import { defaultStatements } from 'better-auth/plugins/admin/access'
import type { StaffRole } from './model'

export type { StaffRole } from './model'

export const permissions = {
  catalog: ['read', 'create', 'update', 'delete', 'publish'],
  inventory: ['read', 'adjust'],
  order: ['read', 'update-address', 'add-note', 'cancel', 'fulfill', 'refund'],
  customer: ['read'],
  staff: ['read', 'invite', 'change-role', 'suspend', 'revoke-session', 'reset-mfa'],
  audit: ['read'],
  settings: ['read', 'update', 'manage-owner'],
} as const

export type AccountType = 'customer' | 'staff'
export type Role = StaffRole | 'customer'
export type Resource = keyof typeof permissions
export type Action<TResource extends Resource> = typeof permissions[TResource][number]
export type Permission = {
  [TResource in Resource]: `${TResource}:${Action<TResource>}`
}[Resource]
export type PermissionRequirement = {
  [TResource in Resource]?: readonly Action<TResource>[]
}

const staffRoles = new Set<StaffRole>([
  'owner',
  'admin',
  'catalog_manager',
  'fulfillment',
  'support',
])
const roleNames = new Set<Role>(['customer', ...staffRoles])

export const rolePermissions = {
  owner: permissions,
  admin: {
    catalog: permissions.catalog,
    inventory: permissions.inventory,
    order: permissions.order,
    customer: permissions.customer,
    staff: permissions.staff,
    audit: permissions.audit,
    settings: ['read', 'update'],
  },
  catalog_manager: {
    catalog: permissions.catalog,
    inventory: permissions.inventory,
    order: ['read'],
  },
  fulfillment: {
    inventory: permissions.inventory,
    order: ['read', 'update-address', 'add-note', 'fulfill'],
    customer: permissions.customer,
  },
  support: {
    order: ['read', 'update-address', 'add-note', 'cancel'],
    customer: permissions.customer,
  },
  customer: {},
} as const satisfies Record<Role, PermissionRequirement>

export const accessControl = createAccessControl({
  ...defaultStatements,
  ...permissions,
})

const adminPrimitivePermissions = {
  user: ['create', 'list', 'set-role', 'ban', 'delete', 'get', 'update'],
  session: ['list', 'revoke', 'delete'],
} as const

const noAdminPrimitivePermissions = {
  user: [],
  session: [],
} as const

export const roles = {
  owner: accessControl.newRole({
    ...adminPrimitivePermissions,
    ...rolePermissions.owner,
  }),
  admin: accessControl.newRole({
    ...adminPrimitivePermissions,
    ...rolePermissions.admin,
  }),
  catalog_manager: accessControl.newRole({
    ...noAdminPrimitivePermissions,
    ...rolePermissions.catalog_manager,
  }),
  fulfillment: accessControl.newRole({
    ...noAdminPrimitivePermissions,
    ...rolePermissions.fulfillment,
  }),
  support: accessControl.newRole({
    ...noAdminPrimitivePermissions,
    ...rolePermissions.support,
  }),
  customer: accessControl.newRole({
    ...noAdminPrimitivePermissions,
    ...rolePermissions.customer,
  }),
} as const

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && staffRoles.has(value as StaffRole)
}

export function parseSingleRole(value: unknown): Role {
  if (typeof value !== 'string' || !roleNames.has(value as Role)) {
    throw new Error('INVALID_ROLE')
  }

  return value as Role
}

export function hasPermissions(role: Role, requirement: PermissionRequirement) {
  const allowed = rolePermissions[role] as PermissionRequirement

  return Object.entries(requirement).every(([resource, actions]) => {
    const allowedActions = allowed[resource as Resource] as readonly string[] | undefined

    return actions?.length !== 0 && actions?.every((action) => allowedActions?.includes(action) === true)
  })
}

export function capabilitiesFor(role: Role): readonly Permission[] {
  return Object.entries(rolePermissions[role]).flatMap(([resource, actions]) =>
    actions.map((action: string) => `${resource}:${action}` as Permission))
}
