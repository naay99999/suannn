import type { identityEmailClaim, user } from '../../database/schema'

export type IdentityEmailClaim = typeof identityEmailClaim.$inferSelect
export type User = typeof user.$inferSelect
