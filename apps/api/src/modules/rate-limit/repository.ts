import { sql } from 'drizzle-orm'
import type { Database } from '../../database/types'

export interface RateLimitCounter {
  count: number
  expiresAt: Date
}

export class ApplicationRateLimitRepository {
  constructor(private readonly db: Database) {}

  async consume(input: {
    keyHash: string
    namespace: string
    now: Date
    windowSeconds: number
  }): Promise<RateLimitCounter> {
    const expiresAt = new Date(input.now.getTime() + input.windowSeconds * 1000)
    const nowValue = input.now.toISOString()
    const expiresAtValue = expiresAt.toISOString()
    const result = await this.db.execute<{ count: number; expiresAt: Date | string }>(sql`
      insert into "application_rate_limit" (
        "key_hash", "namespace", "count", "window_started_at", "expires_at", "updated_at"
      ) values (
        ${input.keyHash}, ${input.namespace}, 1, ${nowValue}::timestamptz,
        ${expiresAtValue}::timestamptz, ${nowValue}::timestamptz
      )
      on conflict ("key_hash") do update set
        "namespace" = excluded."namespace",
        "count" = case
          when "application_rate_limit"."expires_at" <= ${nowValue}::timestamptz then 1
          else "application_rate_limit"."count" + 1
        end,
        "window_started_at" = case
          when "application_rate_limit"."expires_at" <= ${nowValue}::timestamptz
            then ${nowValue}::timestamptz
          else "application_rate_limit"."window_started_at"
        end,
        "expires_at" = case
          when "application_rate_limit"."expires_at" <= ${nowValue}::timestamptz
            then ${expiresAtValue}::timestamptz
          else "application_rate_limit"."expires_at"
        end,
        "updated_at" = ${nowValue}::timestamptz
      returning "count", "expires_at" as "expiresAt"
    `)
    const row = result[0]

    if (!row) {
      throw new Error('RATE_LIMIT_WRITE_FAILED')
    }

    return {
      count: Number(row.count),
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt : new Date(row.expiresAt),
    }
  }

  async purgeExpired(now = new Date(), limit = 10_000) {
    return this.db.transaction(async (tx) => {
      const [lock] = await tx.execute<{ acquired: boolean }>(sql`
        select pg_try_advisory_xact_lock(4_981_221) as acquired
      `)
      if (!lock?.acquired) return 0

      const rows = await tx.execute(sql`
        with expired as (
          select "key_hash" from "application_rate_limit"
          where "expires_at" <= ${now.toISOString()}::timestamptz
          order by "expires_at"
          limit ${Math.min(Math.max(limit, 1), 10_000)}
          for update skip locked
        )
        delete from "application_rate_limit" target
        using expired
        where target."key_hash" = expired."key_hash"
        returning target."key_hash"
      `)
      return rows.length
    })
  }
}
