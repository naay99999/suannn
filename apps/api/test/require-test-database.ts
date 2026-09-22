export function requireTestDatabaseUrl(env: Record<string, string | undefined> = process.env) {
  const value = env.TEST_DATABASE_URL?.trim()
  if (!value) throw new Error('TEST_DATABASE_URL is required for API integration tests')
  return value
}

if (import.meta.main) {
  try {
    requireTestDatabaseUrl()
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'TEST_DATABASE_URL is required')
    process.exit(1)
  }
}
