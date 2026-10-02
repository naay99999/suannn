import { expect, test } from 'bun:test'
import { resolveApiUrl } from '../src/lib/api-url'

test('resolves a configured API origin and supplies a development default', () => {
  expect(resolveApiUrl(undefined, false)).toBe('http://localhost:6767')
  expect(resolveApiUrl(' https://api.example.test/ ', true)).toBe('https://api.example.test')
})

test('requires a valid API origin for production builds', () => {
  expect(() => resolveApiUrl(undefined, true)).toThrow('VITE_API_URL')
  expect(() => resolveApiUrl('https://api.example.test/path', true)).toThrow()
  expect(() => resolveApiUrl('https://user:secret@api.example.test', true)).toThrow()
  expect(() => resolveApiUrl('ftp://api.example.test', true)).toThrow()
})

test('rejects URL components that are not part of an API origin', () => {
  for (const value of [
    'https://api.example.test?version=1',
    'https://api.example.test#fragment',
    'https://api.example.test?',
    'https://api.example.test/path/..',
    'https://api.example.test/path/',
    'https://@api.example.test',
  ]) {
    expect(() => resolveApiUrl(value, false)).toThrow()
  }
})
