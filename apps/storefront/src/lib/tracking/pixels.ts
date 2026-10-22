import type { BrowserEvent } from './events'
import { toGoogle, toMeta, toTikTok } from './mappings'

export interface PixelIds {
  metaPixelId?: string
  tiktokPixelCode?: string
  googleAdsId?: string
}

type PixelFn = (...args: unknown[]) => void
type PixelName = 'meta' | 'tiktok' | 'google'
interface TikTokQueue {
  _q: unknown[][]
  load: PixelFn
  page: PixelFn
  track: PixelFn
  [method: string]: unknown
}

declare global {
  interface Window {
    fbq?: PixelFn & { queue?: unknown[], loaded?: boolean }
    _fbq?: unknown
    ttq?: TikTokQueue
    TiktokAnalyticsObject?: string
    dataLayer?: unknown[]
    gtag?: PixelFn
  }
}

// The injected script element is the source of truth for "loaded", so the state cannot drift from the DOM.
function isLoaded(pixel: PixelName): boolean {
  return document.querySelector(`script[data-tracking-pixel="${pixel}"]`) !== null
}

function injectScript(pixel: PixelName, src: string) {
  if (document.querySelector(`script[data-tracking-pixel="${pixel}"]`)) return
  const script = document.createElement('script')
  script.async = true
  script.src = src
  script.setAttribute('data-tracking-pixel', pixel)
  document.head.appendChild(script)
}

function loadMeta(id: string) {
  if (!window.fbq) {
    // Official queue stub: calls made before fbevents.js arrives are replayed by it.
    const fbq = function (...args: unknown[]) { fbq.queue.push(args) } as PixelFn & { queue: unknown[], loaded: boolean }
    fbq.queue = []
    fbq.loaded = true
    window.fbq = fbq
    window._fbq = fbq
  }
  injectScript('meta', 'https://connect.facebook.net/en_US/fbevents.js')
  window.fbq('init', id)
}

const tiktokMethods = ['page', 'track', 'identify', 'instances', 'debug', 'on', 'off', 'once', 'ready', 'alias', 'group', 'enableCookie', 'disableCookie']

function loadTikTok(code: string) {
  if (!window.ttq) {
    window.TiktokAnalyticsObject = 'ttq'
    const ttq = { _q: [] as unknown[][] } as TikTokQueue
    for (const method of tiktokMethods) {
      ttq[method] = (...args: unknown[]) => { ttq._q.push([method, ...args]) }
    }
    ttq.load = (pixelCode: unknown) => { ttq._q.push(['load', pixelCode]) }
    window.ttq = ttq
  }
  injectScript('tiktok', `https://analytics.tiktok.com/i18n/pixel/events.js?sdkid=${encodeURIComponent(code)}&lib=ttq`)
  window.ttq.load(code)
}

function loadGoogle(id: string) {
  window.dataLayer = window.dataLayer || []
  if (!window.gtag) {
    window.gtag = function gtag() { window.dataLayer!.push(arguments) }
    window.gtag('js', new Date())
  }
  injectScript('google', `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`)
  // The page_view is sent explicitly by the tracker; the automatic one would double-count.
  window.gtag('config', id, { send_page_view: false })
}

// Idempotent: each pixel's script is injected at most once, keyed by data-tracking-pixel.
export function loadPixels(ids: PixelIds): void {
  try {
    if (ids.metaPixelId && !isLoaded('meta')) loadMeta(ids.metaPixelId)
    if (ids.tiktokPixelCode && !isLoaded('tiktok')) loadTikTok(ids.tiktokPixelCode)
    if (ids.googleAdsId && !isLoaded('google')) loadGoogle(ids.googleAdsId)
  } catch {
    // Tracking must never break the page.
  }
}

export function sendToPixels(e: BrowserEvent): void {
  if (isLoaded('meta')) {
    try {
      const { name, params } = toMeta(e)
      window.fbq?.('track', name, params)
    } catch { /* ignore */ }
  }
  if (isLoaded('tiktok')) {
    try {
      const { name, params } = toTikTok(e)
      if (e.name === 'page_view') window.ttq?.page()
      else window.ttq?.track(name, params)
    } catch { /* ignore */ }
  }
  if (isLoaded('google')) {
    try {
      const { name, params } = toGoogle(e)
      window.gtag?.('event', name, params)
    } catch { /* ignore */ }
  }
}
