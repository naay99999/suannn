import { describe, expect, it } from 'bun:test'
import {
  capabilitiesFor,
  hasPermissions,
  isStaffRole,
  parseSingleRole,
  permissions,
  roles,
  type Permission,
  type Role,
} from '../../src/plugins/auth/access-control'

const allPermissions: Permission[] = Object.entries(permissions).flatMap(([resource, actions]) =>
  actions.map((action) => `${resource}:${action}` as Permission))

const expectedCapabilities: Record<Role, readonly Permission[]> = {
  owner: allPermissions,
  admin: allPermissions.filter((permission) => permission !== 'settings:manage-owner'),
  catalog_manager: [
    'catalog:read',
    'catalog:create',
    'catalog:update',
    'catalog:delete',
    'catalog:publish',
    'inventory:read',
    'inventory:adjust',
    'order:read',
  ],
  fulfillment: [
    'inventory:read',
    'inventory:adjust',
    'order:read',
    'order:update-address',
    'order:add-note',
    'order:fulfill',
    'customer:read',
  ],
  support: [
    'order:read',
    'order:update-address',
    'order:add-note',
    'order:cancel',
    'customer:read',
  ],
  customer: [],
}

describe('fixed access control', () => {
  it('authorizes every role and permission pair from the fixed matrix', () => {
    for (const role of Object.keys(expectedCapabilities) as Role[]) {
      const expected = new Set(expectedCapabilities[role])

      for (const permission of allPermissions) {
        const separator = permission.indexOf(':')
        const resource = permission.slice(0, separator) as keyof typeof permissions
        const action = permission.slice(separator + 1)

        expect(hasPermissions(role, { [resource]: [action] })).toBe(expected.has(permission))
      }
    }
  })

  it('requires every action in a structured permission declaration', () => {
    expect(hasPermissions('admin', { order: ['read', 'refund'] })).toBe(true)
    expect(hasPermissions('support', { order: ['read', 'refund'] })).toBe(false)
    expect(hasPermissions('fulfillment', {
      inventory: ['adjust'],
      order: ['fulfill'],
    })).toBe(true)
  })

  it('derives UI capabilities and Better Auth roles from the same matrix', () => {
    for (const role of Object.keys(expectedCapabilities) as Role[]) {
      expect(capabilitiesFor(role)).toEqual(expectedCapabilities[role])

      for (const permission of allPermissions) {
        const separator = permission.indexOf(':')
        const resource = permission.slice(0, separator)
        const action = permission.slice(separator + 1)
        const result = roles[role].authorize({ [resource]: [action] })

        expect(result.success).toBe(expectedCapabilities[role].includes(permission))
      }
    }
  })

  it('accepts exactly one known role and distinguishes staff roles', () => {
    expect(parseSingleRole('customer')).toBe('customer')
    expect(parseSingleRole('catalog_manager')).toBe('catalog_manager')
    expect(isStaffRole('owner')).toBe(true)
    expect(isStaffRole('customer')).toBe(false)
    expect(isStaffRole('unknown')).toBe(false)

    expect(() => parseSingleRole(['admin'])).toThrow('INVALID_ROLE')
    expect(() => parseSingleRole('admin,owner')).toThrow('INVALID_ROLE')
    expect(() => parseSingleRole('unknown')).toThrow('INVALID_ROLE')
    expect(() => parseSingleRole(null)).toThrow('INVALID_ROLE')
  })
})
