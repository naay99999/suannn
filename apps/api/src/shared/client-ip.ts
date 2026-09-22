import { isIP } from 'node:net'

export function resolveClientIp(request: Request, trustedProxyHeaders: readonly string[]) {
  for (const header of trustedProxyHeaders) {
    const candidate = request.headers.get(header)?.split(',', 1)[0]?.trim()

    if (candidate && isIP(candidate) !== 0) {
      return candidate
    }
  }

  return 'unknown'
}
