import { t } from 'elysia'

export interface CustomerSignupCommand {
  name: string
  email: string
  password: string
  ip?: string
  requestId?: string
  userAgent?: string | null
}

export const customerAuthModels = {
  'customerAuth.signupBody': t.Object({
    name: t.String({ minLength: 1, maxLength: 100 }),
    email: t.String({ minLength: 3, maxLength: 322 }),
    password: t.String({ minLength: 12, maxLength: 256 }),
  }, { additionalProperties: false }),
  'customerAuth.signupResponse': t.Object({
    accepted: t.Literal(true),
    next: t.Literal('sign-in'),
  }),
}
