import { afterAll, beforeAll, expect, it } from 'bun:test'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import { createTestDatabase, lockTestDatabase, migrateTestDatabase, resetTestDatabase } from '../helpers/database'

const database = createTestDatabase()
let unlock: (() => Promise<void>) | undefined
let oldMigrations = ''

beforeAll(async () => {
  unlock = await lockTestDatabase(database)
  await resetTestDatabase(database)
  const source = new URL('../../drizzle', import.meta.url).pathname
  oldMigrations = await mkdtemp(join(tmpdir(), 'suannn-upgrade-'))
  await mkdir(join(oldMigrations, 'meta'))
  const journal = JSON.parse(await readFile(join(source, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ tag: string }>
  }
  journal.entries = journal.entries.filter((entry) => Number(entry.tag.slice(0, 4)) <= 9)
  await writeFile(join(oldMigrations, 'meta/_journal.json'), JSON.stringify(journal))
  for (const entry of journal.entries) {
    await copyFile(join(source, `${entry.tag}.sql`), join(oldMigrations, `${entry.tag}.sql`))
  }
})

afterAll(async () => {
  await resetTestDatabase(database)
  await unlock?.()
  await database.client.end()
  if (oldMigrations) await rm(oldMigrations, { recursive: true, force: true })
})

it('upgrades populated 0009 user, product, and lot data through 0014', async () => {
  await migrate(database.db, { migrationsFolder: oldMigrations })
  const userId = 'upgrade-customer'
  const productId = crypto.randomUUID()
  const variantId = crypto.randomUUID()
  const lotId = crypto.randomUUID()
  await database.client.unsafe(`
    insert into "user" (id, name, email, email_verified, created_at, updated_at, role, account_type)
    values ($1, 'Upgrade Customer', 'upgrade@example.test', true, now(), now(), 'customer', 'customer')
  `, [userId])
  await database.client.unsafe(`
    insert into product (id, slug, name, category, status)
    values ($1, 'upgrade-fruit', 'Upgrade Fruit', 'fresh', 'published')
  `, [productId])
  await database.client.unsafe(`
    insert into product_variant (id, product_id, sku, name, unit, price_satang, sales_enabled)
    values ($1, $2, 'UPGRADE-1', 'One box', 'box', 1200, true)
  `, [variantId, productId])
  await database.client.unsafe(`
    insert into inventory_lot (id, warehouse_id, variant_id, lot_code, expiry_date, on_hand_quantity)
    select $1, id, $2, 'UPGRADE-LOT', '2999-12-31', 7 from warehouse where code = 'MAIN'
  `, [lotId, variantId])

  await migrateTestDatabase(database)

  const rows = await database.client.unsafe<Array<{
    id: string; quantity: number; reversible: number; email: string
  }>>(`
    select l.id, l.on_hand_quantity as quantity, l.reversible_quantity as reversible, u.email
    from inventory_lot l cross join "user" u
    where l.id = $1 and u.id = $2
  `, [lotId, userId])
  expect([...rows]).toEqual([{
    id: lotId, quantity: 7, reversible: 0, email: 'upgrade@example.test',
  }])
  const settings = await database.client.unsafe<Array<{ version: number; checkout_enabled: boolean }>>(
    'select version, checkout_enabled from commerce_settings',
  )
  expect([...settings]).toEqual([{ version: 1, checkout_enabled: false }])
  const migrations = await database.client.unsafe<Array<{ count: number }>>(
    'select count(*)::int as count from drizzle.__drizzle_migrations',
  )
  expect(migrations[0]?.count).toBe(15)
})
