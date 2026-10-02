import { createDatabase } from '../database/client'
import { loadConfig } from '../config/env'
import { normalizeDemoImageBase } from './demo/fixtures'
import { seedDemo } from './demo/seed'
export { demoId } from './demo/fixtures'

export interface DemoSeedOptions {
  databaseName: string
  actorEmail: string
  imageBaseUrl: string
}

const optionNames = new Set(['--database-name', '--actor-email', '--image-base-url'])

export function parseDemoSeedOptions(argv: string[], environment: string | undefined): DemoSeedOptions {
  if (environment !== 'development' && environment !== 'test') {
    throw new Error('DEMO_SEED_REQUIRES_DEVELOPMENT_OR_TEST_ENVIRONMENT')
  }
  const args = argv[0] === '--' ? argv.slice(1) : argv
  if (args.length !== 6) throw new Error('DEMO_SEED_REQUIRES_EXACTLY_THREE_OPTIONS')

  const parsed = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]?.trim()
    if (!name || !optionNames.has(name) || !value || value.startsWith('--') || parsed.has(name)) {
      throw new Error('DEMO_SEED_INVALID_ARGUMENTS')
    }
    parsed.set(name, value)
  }
  if (parsed.size !== 3) throw new Error('DEMO_SEED_INVALID_ARGUMENTS')

  const databaseName = parsed.get('--database-name')!
  const actorEmail = parsed.get('--actor-email')!.toLowerCase()
  const suppliedImageBase = parsed.get('--image-base-url')!
  if (databaseName.length > 63) throw new Error('DEMO_SEED_INVALID_DATABASE_NAME')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actorEmail)) throw new Error('DEMO_SEED_INVALID_ACTOR_EMAIL')

  const imageBaseUrl = normalizeDemoImageBase(suppliedImageBase)
  return { databaseName, actorEmail, imageBaseUrl }
}

async function run() {
  const options = parseDemoSeedOptions(process.argv.slice(2), process.env.NODE_ENV)
  const config = loadConfig(process.env)
  const database = createDatabase(config.databaseUrl)

  try {
    const result = await seedDemo(database.db, options)
    console.info(JSON.stringify({
      event: 'demo-seed-complete',
      databaseName: options.databaseName,
      ...result,
    }))
  } finally {
    await database.client.end()
  }
}

if (import.meta.main) {
  run().catch((error: unknown) => {
    const message = error instanceof Error && error.message.startsWith('DEMO_SEED_')
      ? error.message
      : 'DEMO_SEED_FAILED'
    console.error(message)
    process.exitCode = 1
  })
}
