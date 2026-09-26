const maxBackupCodeFileSize = 32 * 1024
const maxBackupCodes = 10
const maxBackupCodeLength = 128

export function createBackupCodesFile(codes: string[], createdAt = new Date()) {
  const date = createdAt.toISOString().slice(0, 10)
  return [
    '# Suannn admin backup codes',
    '# Keep this file private. Each code works once.',
    `# Created ${date}`,
    '',
    ...codes,
    '',
  ].join('\n')
}

export function parseBackupCodesFile(contents: string) {
  if (contents.length > maxBackupCodeFileSize) {
    throw new Error('This file is too large to read.')
  }

  const codes = contents.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  if (codes.length === 0 || codes.length > maxBackupCodes
    || codes.some((code) => code.length > maxBackupCodeLength || !/^[a-z\d-]+$/i.test(code))
    || new Set(codes).size !== codes.length) {
    throw new Error('This file does not contain valid backup codes.')
  }

  return codes
}

export function downloadBackupCodes(codes: string[]) {
  const date = new Date().toISOString().slice(0, 10)
  const file = new Blob([createBackupCodesFile(codes)], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = `suannn-admin-backup-codes-${date}.txt`
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
