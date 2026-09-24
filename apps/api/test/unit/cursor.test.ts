import { describe, expect, it } from 'bun:test'
import { decodeCursor, encodeCursor } from '../../src/shared/cursor'

describe('opaque list cursors', () => {
  it('round-trips deterministic fields', () => {
    const cursor = encodeCursor({ createdAt: '2026-09-23T00:00:00.000Z', id: 'row-1' })
    expect(decodeCursor(cursor, ['createdAt', 'id'])).toEqual({
      createdAt: '2026-09-23T00:00:00.000Z', id: 'row-1',
    })
  })

  it('rejects malformed, oversized, and date-invalid cursors', () => {
    expect(() => decodeCursor('broken', ['id'])).toThrow('INVALID_CURSOR')
    expect(() => decodeCursor('x'.repeat(513), ['id'])).toThrow('INVALID_CURSOR')
    expect(() => decodeCursor(encodeCursor({ createdAt: 'invalid', id: 'row-1' }), ['createdAt', 'id']))
      .toThrow('INVALID_CURSOR')
  })
})
