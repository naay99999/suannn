export function encodeCursor(value: Record<string, string>) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function decodeCursor(cursor: string | undefined, keys: readonly string[]) {
  if (!cursor) return null
  if (cursor.length > 512) throw new Error('INVALID_CURSOR')

  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    const record = value as Record<string, unknown>
    if (Object.keys(record).length !== keys.length || keys.some((key) => typeof record[key] !== 'string')) {
      throw new Error()
    }
    if (keys.some((key) => (key === 'createdAt' || key === 'occurredAt')
      && !Number.isFinite(Date.parse(record[key] as string)))) throw new Error()
    if (keys.includes('id') && !(record.id as string).length) throw new Error()
    return record as Record<typeof keys[number], string>
  } catch {
    throw new Error('INVALID_CURSOR')
  }
}
