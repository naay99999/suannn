import { expect, it } from 'bun:test'
import * as guestOrderAccess from '../../src/modules/orders/access'

const helpers = guestOrderAccess as unknown as Record<string, unknown>

type VerifierMatcher = (expectedHash: string | null, token: string) => boolean
type ExpiryChecker = (terminalAt: Date | null, now: Date) => boolean

it('matches guest tokens against fixed-size stored verifiers', () => {
  const matcher = helpers.guestOrderTokenVerifierMatches
  expect(typeof matcher).toBe('function')
  if (typeof matcher !== 'function') return

  const matches = matcher as VerifierMatcher
  expect(matches('2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b', 'secret')).toBe(true)
  expect(matches('2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b', 'different')).toBe(false)
  expect(matches(null, 'secret')).toBe(false)
  expect(matches('invalid', 'secret')).toBe(false)
})

it('keeps a terminal guest token valid through the exact 30-day boundary', () => {
  const checker = helpers.isGuestOrderAccessExpired
  expect(typeof checker).toBe('function')
  if (typeof checker !== 'function') return

  const expired = checker as ExpiryChecker
  const terminalAt = new Date('2026-01-01T00:00:00.000Z')
  expect(expired(terminalAt, new Date('2026-01-31T00:00:00.000Z'))).toBe(false)
  expect(expired(terminalAt, new Date('2026-01-31T00:00:00.001Z'))).toBe(true)
  expect(expired(null, new Date('2036-01-01T00:00:00.000Z'))).toBe(false)
})
