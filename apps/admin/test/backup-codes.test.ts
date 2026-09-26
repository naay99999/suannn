import { expect, test } from 'bun:test'
import { createBackupCodesFile, downloadBackupCodes, parseBackupCodesFile } from '../src/lib/backup-codes'

test('creates a dated backup-codes file with a private-file warning', () => {
  expect(createBackupCodesFile(['backup-123', 'backup-456'], new Date('2026-09-26T08:00:00.000Z')))
    .toBe('# Suannn admin backup codes\n# Keep this file private. Each code works once.\n# Created 2026-09-26\n\nbackup-123\nbackup-456\n')
})

test('reads both the dated file format and legacy plain code files', () => {
  expect(parseBackupCodesFile('# Suannn admin backup codes\n# Keep this file private.\n\nbackup-123\nbackup-456\n'))
    .toEqual(['backup-123', 'backup-456'])
  expect(parseBackupCodesFile('backup-123\r\nbackup-456\r\n')).toEqual(['backup-123', 'backup-456'])
})

test('rejects empty, duplicate, oversized, or malformed backup-code files', () => {
  expect(() => parseBackupCodesFile('# no codes here')).toThrow('This file does not contain valid backup codes.')
  expect(() => parseBackupCodesFile('backup-123\nbackup-123')).toThrow('This file does not contain valid backup codes.')
  expect(() => parseBackupCodesFile('a'.repeat(32_769))).toThrow('This file is too large to read.')
  expect(() => parseBackupCodesFile(`${'a'.repeat(129)}\n`)).toThrow('This file does not contain valid backup codes.')
})

test('downloads backup codes with a dated filename and the reusable file format', async () => {
  const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL')
  const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL')
  const originalClick = HTMLAnchorElement.prototype.click
  const originalSetTimeout = window.setTimeout
  let file: Blob | undefined
  let filename = ''
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (value: Blob) => { file = value; return 'blob:backup-codes' },
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined })
  HTMLAnchorElement.prototype.click = function () { filename = this.download }
  window.setTimeout = ((callback: TimerHandler) => {
    if (typeof callback === 'function') callback()
    return 0
  }) as typeof window.setTimeout

  try {
    downloadBackupCodes(['backup-123'])
    expect(filename).toMatch(/^suannn-admin-backup-codes-\d{4}-\d{2}-\d{2}\.txt$/)
    expect(await file?.text()).toContain('# Suannn admin backup codes')
    expect(await file?.text()).toContain('backup-123')
  } finally {
    HTMLAnchorElement.prototype.click = originalClick
    window.setTimeout = originalSetTimeout
    if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate)
    else Reflect.deleteProperty(URL, 'createObjectURL')
    if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke)
    else Reflect.deleteProperty(URL, 'revokeObjectURL')
  }
})
