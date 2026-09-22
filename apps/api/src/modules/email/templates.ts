export interface EmailContent {
  subject: string
  text: string
  html: string
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function linkEmail(subject: string, message: string, action: string, url: string): EmailContent {
  const safeUrl = escapeHtml(url)

  return {
    subject,
    text: `${message}\n\n${url}`,
    html: `<p>${escapeHtml(message)}</p><p><a href="${safeUrl}">${escapeHtml(action)}</a></p>`,
  }
}

export function verificationEmail(url: string) {
  return linkEmail(
    'Verify your Suannn email',
    'Verify your email address to secure your Suannn account.',
    'Verify email',
    url,
  )
}

export function resetPasswordEmail(url: string) {
  return linkEmail(
    'Reset your Suannn password',
    'Use this link to reset your Suannn password. Ignore this email if you did not request it.',
    'Reset password',
    url,
  )
}

export function invitationEmail(roleName: string, url: string) {
  return linkEmail(
    'You are invited to Suannn Admin',
    `You have been invited to Suannn Admin with the ${roleName} role.`,
    'Accept invitation',
    url,
  )
}

export function staffMfaRecoveryEmail(url: string) {
  return linkEmail(
    'Reset your Suannn Admin MFA',
    'Your staff MFA was reset through the emergency owner recovery process. Sign in and enroll a new authenticator before using the backoffice.',
    'Enroll a new authenticator',
    url,
  )
}
