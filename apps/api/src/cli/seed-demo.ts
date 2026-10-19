import { and, eq } from 'drizzle-orm'
import { createDatabase } from '../database/client'
import { user } from '../database/schema'
import { loadConfig } from '../config/env'
import { AuditRepository } from '../modules/audit/repository'
import { AuditService } from '../modules/audit/service'
import { MediaRepository, MediaService } from '../modules/media'
import { R2MediaStorage } from '../modules/media/storage'
import { MediaUrls } from '../modules/media/urls'
import { createDemoMediaUploader, seedDemo } from './demo/seed'
export { demoId } from './demo/fixtures'

export interface DemoSeedOptions {
  databaseName: string
  actorEmail: string
}

const optionNames = new Set(['--database-name', '--actor-email'])

export function parseDemoSeedOptions(argv: string[], environment: string | undefined): DemoSeedOptions {
  if (environment !== 'development' && environment !== 'test') {
    throw new Error('DEMO_SEED_REQUIRES_DEVELOPMENT_OR_TEST_ENVIRONMENT')
  }
  const args = argv[0] === '--' ? argv.slice(1) : argv
  if (args.length !== 4) throw new Error('DEMO_SEED_REQUIRES_EXACTLY_TWO_OPTIONS')

  const parsed = new Map<string, string>()
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]?.trim()
    if (!name || !optionNames.has(name) || !value || value.startsWith('--') || parsed.has(name)) {
      throw new Error('DEMO_SEED_INVALID_ARGUMENTS')
    }
    parsed.set(name, value)
  }
  if (parsed.size !== 2) throw new Error('DEMO_SEED_INVALID_ARGUMENTS')

  const databaseName = parsed.get('--database-name')!
  const actorEmail = parsed.get('--actor-email')!.toLowerCase()
  if (databaseName.length > 63) throw new Error('DEMO_SEED_INVALID_DATABASE_NAME')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(actorEmail)) throw new Error('DEMO_SEED_INVALID_ACTOR_EMAIL')

  return { databaseName, actorEmail }
}

async function run() {
  const options = parseDemoSeedOptions(process.argv.slice(2), process.env.NODE_ENV)
  const config = loadConfig(process.env)
  const database = createDatabase(config.databaseUrl)

  try {
    if (!config.media) throw new Error('DEMO_SEED_REQUIRES_MEDIA_STORAGE')
    // Uploads run before the seed transaction, so the actor is resolved here; seedDemo re-validates it.
    const [actor] = await database.db.select({ id: user.id }).from(user)
      .where(and(eq(user.email, options.actorEmail), eq(user.accountType, 'staff'), eq(user.role, 'owner')))
      .limit(1)
    if (!actor) throw new Error('DEMO_SEED_ACTIVE_OWNER_REQUIRED')
    const media = new MediaService(
      new MediaRepository(database.db, new AuditService(new AuditRepository(database.db)), new MediaUrls(config.media.publicUrl)),
      new R2MediaStorage(config.media),
    )
    const uploader = createDemoMediaUploader(media, {
      userId: actor.id,
      auditContext: { requestId: 'demo-seed-media', ipAddress: null, userAgent: null },
    })
    const result = await seedDemo(database.db, options, uploader)
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
