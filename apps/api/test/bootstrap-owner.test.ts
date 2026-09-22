import { describe, expect, it } from 'bun:test'
import { bootstrapOwner } from '../src/cli/bootstrap-owner'

describe('owner bootstrap', () => {
  it('creates an owner invitation without accepting a password', async () => {
    const calls: unknown[] = []
    const result = await bootstrapOwner({
      hasOwner: async () => false,
      create: async (command) => {
        calls.push(command)
        return { id: 'invite-1', email: command.email, role: command.role, expiresAt: new Date() }
      },
    }, ' Owner@Example.com ')

    expect(calls).toEqual([{
      email: ' Owner@Example.com ',
      role: 'owner',
      inviterUserId: null,
    }])
    expect(result.id).toBe('invite-1')
  })

  it('refuses bootstrap when an owner already exists', async () => {
    await expect(bootstrapOwner({
      hasOwner: async () => true,
      create: async () => {
        throw new Error('should not create')
      },
    }, 'owner@example.com')).rejects.toThrow('OWNER_ALREADY_EXISTS')
  })
})
