function parsedLocalPath(value: string | null): { pathname: string; search: string } | null {
  if (!value || !value.startsWith('/') || value.includes('//')
    || value.includes('\\') || /%2f|%5c/i.test(value)) return null

  const path = value.split(/[?#]/, 1)[0]
  if (path.split('/').some(part => part === '.' || part === '..')) return null

  try {
    const parsed = new URL(value, 'http://storefront.local')
    if (parsed.origin !== 'http://storefront.local') return null
    return { pathname: parsed.pathname, search: parsed.search }
  } catch {
    return null
  }
}

export function safeAccountReturnPath(value: string | null): string {
  const parsed = parsedLocalPath(value)
  if (!parsed || !/^\/account(?:\/|$)/.test(parsed.pathname)) return '/account'
  return `${parsed.pathname}${parsed.search}`
}

export function safeCustomerReturnPath(value: string | null): string {
  const parsed = parsedLocalPath(value)
  if (!parsed) return '/account'
  if (parsed.pathname === '/checkout' || /^\/account(?:\/|$)/.test(parsed.pathname)) return `${parsed.pathname}${parsed.search}`
  return '/account'
}

export function staffSignInUrl(adminUrl: string): string {
  return new URL('/login', adminUrl).toString()
}
