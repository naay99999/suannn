const uuidPattern = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i

export function isUuid(value: string | undefined): value is string {
  return value !== undefined && uuidPattern.test(value)
}
