export const normalizeEmail = (email: string) =>
  email.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '').toLowerCase()
