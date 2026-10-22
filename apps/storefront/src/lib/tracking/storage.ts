// Browser storage can be missing or throw (private mode, blocked cookies); fall back to memory for the session.
const memory = new Map<string, string>()

export function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return memory.get(key) ?? null
  }
}

export function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    memory.set(key, value)
  }
}
