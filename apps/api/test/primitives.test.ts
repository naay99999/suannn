import { describe, expect, it } from 'bun:test'
import { resolveClientIp } from '../src/shared/client-ip'
import { createOpaqueToken, hashToken } from '../src/shared/crypto'
import { normalizeEmail } from '../src/shared/email'

describe('auth primitives', () => {
  it('normalizes only ASCII edge whitespace and case', () => {
    expect(normalizeEmail('\t Alice+shop@Example.COM \r')).toBe('alice+shop@example.com')
    expect(normalizeEmail('john.smith@gmail.com')).not.toBe(normalizeEmail('johnsmith@gmail.com'))
    expect(normalizeEmail('john+shop@gmail.com')).not.toBe(normalizeEmail('john@gmail.com'))
    expect(normalizeEmail('\u00a0User@Example.com\u00a0')).toBe('\u00a0user@example.com\u00a0')
  })

  it('creates opaque random tokens and stable SHA-256 hashes', () => {
    const first = createOpaqueToken()
    const second = createOpaqueToken()

    expect(first).not.toBe(second)
    expect(first).not.toContain('=')
    expect(hashToken('secret')).toBe('2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b')
  })

  it('ignores forwarding headers unless each header is explicitly trusted', () => {
    const request = new Request('https://api.example.com', {
      headers: {
        'x-forwarded-for': '203.0.113.8, 10.0.0.2',
        'x-real-ip': '198.51.100.4',
      },
    })

    expect(resolveClientIp(request, [])).toBe('unknown')
    expect(resolveClientIp(request, ['x-forwarded-for'])).toBe('203.0.113.8')
    expect(resolveClientIp(request, ['x-real-ip'])).toBe('198.51.100.4')
  })

  it('rejects malformed forwarded addresses instead of using them as rate-limit keys', () => {
    const request = new Request('https://api.example.com', {
      headers: { 'x-forwarded-for': 'not an ip' },
    })

    expect(resolveClientIp(request, ['x-forwarded-for'])).toBe('unknown')
  })
})
