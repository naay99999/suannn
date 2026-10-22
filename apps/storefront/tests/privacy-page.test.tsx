import { afterEach, expect, mock, test } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConsentContext, type ConsentContextValue } from '../src/components/consent/consent-context'
import { Component as PrivacyPage } from '../src/pages/privacy/privacy-page'

afterEach(cleanup)

function mount(openSettings = mock(() => {})) {
  const value: ConsentContextValue = {
    choice: null,
    policyVersion: null,
    decided: false,
    acceptAll: async () => {},
    rejectAll: async () => {},
    save: async () => {},
    openSettings,
  }
  render(<ConsentContext.Provider value={value}><PrivacyPage /></ConsentContext.Provider>)
  return openSettings
}

test('renders the heading, six sections in order and the placeholder marker', () => {
  mount()
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('นโยบายความเป็นส่วนตัว')
  expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual([
    'ข้อมูลที่เราเก็บและเหตุผล',
    'คุกกี้และเครื่องมือที่ใช้',
    'ข้อมูลที่ส่งให้แพลตฟอร์มโฆษณา',
    'ระยะเวลาการเก็บรักษา',
    'สิทธิของเจ้าของข้อมูล',
    'ติดต่อเรา',
  ])
  expect(screen.getAllByText(/^\[ร่าง — เจ้าของร้านต้องแก้ไข\]/)).toHaveLength(6)
  expect(screen.getByText('ฉบับวันที่ 2026-10-21')).toBeTruthy()
  for (const tool of ['PostHog', 'Meta', 'TikTok', 'Google Ads']) expect(screen.getAllByText(new RegExp(tool)).length).toBeGreaterThan(0)
  for (const category of ['จำเป็น', 'วิเคราะห์การใช้งาน', 'การตลาด']) expect(screen.getByText(category)).toBeTruthy()
})

test('the settings button opens consent settings', async () => {
  const openSettings = mount()
  await userEvent.setup().click(screen.getByRole('button', { name: 'ตั้งค่าคุกกี้' }))
  expect(openSettings).toHaveBeenCalledTimes(1)
})
