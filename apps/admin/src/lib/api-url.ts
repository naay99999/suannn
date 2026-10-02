function configurationError(): Error {
  return new Error('VITE_API_URL must be an HTTP(S) API origin without credentials, path, query, or fragment')
}

export function resolveApiUrl(value: string | undefined, production: boolean): string {
  const input = value?.trim()
  if (!input) {
    if (production) throw configurationError()
    return 'http://localhost:6767'
  }

  const match = input.match(/^https?:\/\/([^/?#]*)(.*)$/i)
  if (!match || match[1]!.includes('@') || (match[2] !== '' && match[2] !== '/')) {
    throw configurationError()
  }

  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw configurationError()
  }

  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw configurationError()
  }

  return url.origin
}
