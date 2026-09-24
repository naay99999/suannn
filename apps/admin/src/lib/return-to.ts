function hasUnsafeCharacter(value: string) {
  return [...value].some((character) => character === '\\' || character.charCodeAt(0) < 32)
}

export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || hasUnsafeCharacter(value)) {
    return '/dashboard'
  }

  try {
    const parsed = new URL(value, 'http://admin.local')
    if (parsed.origin !== 'http://admin.local' || /^\/(login|staff)(?:\/|$)/.test(parsed.pathname)) {
      return '/dashboard'
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return '/dashboard'
  }
}
