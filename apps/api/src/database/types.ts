import type { createDatabase } from './client'

export type Database = ReturnType<typeof createDatabase>['db']
export type DatabaseTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]
