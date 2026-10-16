import postgres from 'postgres'

export interface ReadinessProbe {
  check(): Promise<void>
  close(): Promise<void>
}

export function createDatabaseReadinessProbe(databaseUrl: string): ReadinessProbe {
  const client = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 2,
    idle_timeout: 5,
    connection: { statement_timeout: 2_000, idle_session_timeout: 5_000 },
  })

  return {
    async check() {
      await client`select 1`
      const settings = await client`select id from commerce_settings where id = 1`
      if (settings.length !== 1) throw new Error('Commerce settings are not initialized')
      await client`select shipment_carrier, shipment_carrier_name, tracking_number, shipped_at from commerce_order limit 0`
    },
    close() {
      return client.end({ timeout: 2 })
    },
  }
}
