export function safeAccountReturnPath(value: string | null): string {
  if (!value || !value.startsWith('/') || value.includes('//')
    || value.includes('\\') || /%2f|%5c/i.test(value)) return '/account'

  const path = value.split(/[?#]/, 1)[0]
  if (!/^\/account(?:\/|$)/.test(path) || path.split('/').some(part => part === '.' || part === '..')) {
    return '/account'
  }

  try {
    const parsed = new URL(value, 'http://storefront.local')
    if (parsed.origin !== 'http://storefront.local' || !/^\/account(?:\/|$)/.test(parsed.pathname)) {
      return '/account'
    }
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return '/account'
  }
}

export function staffSignInUrl(adminUrl: string): string {
  return new URL('/login', adminUrl).toString()
}
