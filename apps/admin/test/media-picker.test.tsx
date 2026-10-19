import { afterEach, expect, spyOn, test } from 'bun:test'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from '@workspace/ui/components/toast'
import { MediaPickerDialog, type MediaImageValue } from '../src/components/media/media-picker-dialog'
import { mediaApi, type MediaItem } from '../src/lib/media/api'

const createdAt = new Date('2026-10-01T08:00:00.000Z')
const ids = ['00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3']

function item(index: number, alt: string | null = `ภาพ ${index + 1}`): MediaItem {
  return {
    id: ids[index]!, url: `https://cdn.example.test/${index}.webp`, thumbUrl: `https://cdn.example.test/${index}-t.webp`, alt,
    width: 800, height: 600, byteSize: 2048, createdAt, originalFilename: `photo-${index + 1}.jpg`, usage: { products: 0, farms: 0 },
  }
}

const spies: Array<{ mockRestore: () => void }> = []
function track<T extends { mockRestore: () => void }>(spy: T): T {
  spies.push(spy)
  return spy
}

afterEach(() => {
  cleanup()
  spies.splice(0).forEach((spy) => spy.mockRestore())
})

function mockList(items: MediaItem[]) {
  return track(spyOn(mediaApi, 'list').mockImplementation(async () => ({ items, nextCursor: null })))
}

function renderPicker(props: Partial<Parameters<typeof MediaPickerDialog>[0]> = {}) {
  const onConfirm = (items: MediaImageValue[]) => confirmed.push(items)
  const confirmed: MediaImageValue[][] = []
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  render(
    <Toaster>
      <QueryClientProvider client={queryClient}>
        <MediaPickerDialog mode="multiple" onConfirm={onConfirm} onOpenChange={() => {}} open selectedIds={[]} {...props} />
      </QueryClientProvider>
    </Toaster>,
  )
  return { confirmed }
}

test('selects multiple library items in order and confirms', async () => {
  mockList([item(0), item(1), item(2)])
  const user = userEvent.setup()
  const { confirmed } = renderPicker()

  await user.click(await screen.findByRole('button', { name: 'photo-3.jpg' }))
  await user.click(screen.getByRole('button', { name: 'photo-1.jpg' }))
  await user.click(screen.getByRole('button', { name: 'ยืนยันการเลือก' }))

  expect(confirmed[0]?.map((value) => value.id)).toEqual([ids[2]!, ids[0]!])
})

test('single mode replaces the selection', async () => {
  mockList([item(0), item(1)])
  const user = userEvent.setup()
  const { confirmed } = renderPicker({ mode: 'single' })

  await user.click(await screen.findByRole('button', { name: 'photo-1.jpg' }))
  await user.click(screen.getByRole('button', { name: 'photo-2.jpg' }))
  expect(screen.getByRole('button', { name: 'photo-1.jpg' }).getAttribute('aria-pressed')).toBe('false')
  await user.click(screen.getByRole('button', { name: 'ยืนยันการเลือก' }))

  expect(confirmed[0]?.map((value) => value.id)).toEqual([ids[1]!])
})

test('auto-selects a freshly uploaded image', async () => {
  mockList([item(0)])
  const uploaded = item(1)
  track(spyOn(mediaApi, 'upload').mockImplementation(async () => ({ item: uploaded, duplicate: false })))
  const user = userEvent.setup()
  const { confirmed } = renderPicker()

  await screen.findByRole('button', { name: 'photo-1.jpg' })
  await user.click(screen.getByRole('tab', { name: 'อัปโหลดใหม่' }))
  await user.upload(screen.getByLabelText('เลือกไฟล์ภาพ'), new File(['x'], 'photo-2.jpg', { type: 'image/jpeg' }))

  const tile = await screen.findByRole('button', { name: 'photo-2.jpg' })
  expect(tile.getAttribute('aria-pressed')).toBe('true')
  await user.click(screen.getByRole('button', { name: 'ยืนยันการเลือก' }))
  expect(confirmed[0]?.map((value) => value.id)).toEqual([ids[1]!])
})

test('respects maxSelectable', async () => {
  mockList([item(0), item(1)])
  renderPicker({ maxSelectable: 1, selectedIds: [ids[0]!], selectedValues: [{ id: ids[0]!, thumbUrl: 'https://cdn.example.test/0-t.webp', alt: 'ภาพ 1' }] })

  const other = await screen.findByRole('button', { name: 'photo-2.jpg' })
  expect((other as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'photo-1.jpg' }) as HTMLButtonElement).disabled).toBe(false)
})

test('edits missing alt inline', async () => {
  mockList([item(0, null)])
  const altSpy = track(spyOn(mediaApi, 'updateAlt').mockImplementation(async (id, alt) => ({ ...item(0), id, alt })))
  const user = userEvent.setup()
  const { confirmed } = renderPicker()

  await user.click(await screen.findByRole('button', { name: 'photo-1.jpg' }))
  await user.type(await screen.findByLabelText('คำอธิบายภาพ'), 'ทุเรียนบนต้น')
  await user.click(screen.getByRole('button', { name: 'บันทึกคำอธิบาย' }))

  await waitFor(() => expect(altSpy).toHaveBeenCalledWith(ids[0]!, 'ทุเรียนบนต้น'))
  await waitFor(() => expect(screen.queryByLabelText('คำอธิบายภาพ')).toBeNull())
  await user.click(screen.getByRole('button', { name: 'ยืนยันการเลือก' }))
  expect(confirmed[0]?.[0]?.alt).toBe('ทุเรียนบนต้น')
})
