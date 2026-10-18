import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

const sitemapRoutes = ['/', '/products', '/farms', '/categories/fresh', '/categories/processed']
const privateRoutes = ['/account', '/checkout', '/orders', '/sign-in', '/sign-up', '/forgot-password', '/reset-password']

// Fills %SITE_URL% in index.html, preloads the Thai font subset, and emits robots.txt and sitemap.xml.
function siteMeta(siteUrl: string): Plugin {
  return {
    name: 'suannn-site-meta',
    transformIndexHtml: {
      order: 'post',
      handler(html, { bundle }) {
        const thaiFont = Object.keys(bundle ?? {}).find(file => /noto-sans-thai-thai-wght-normal-.*\.woff2$/.test(file))
        const fontPreload = thaiFont
          ? [{ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${thaiFont}`, crossorigin: '' }, injectTo: 'head-prepend' as const }]
          : []
        return { html: html.replaceAll('%SITE_URL%', siteUrl), tags: fontPreload }
      },
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'robots.txt',
        source: ['User-agent: *', 'Allow: /', ...privateRoutes.map(route => `Disallow: ${route}`), '', `Sitemap: ${siteUrl}/sitemap.xml`, ''].join('\n'),
      })
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...sitemapRoutes.map(route => `  <url><loc>${siteUrl}${route === '/' ? '/' : route}</loc></url>`),
          '</urlset>',
          '',
        ].join('\n'),
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const siteUrl = (loadEnv(mode, import.meta.dirname, '').VITE_SITE_URL || 'http://localhost:4183').replace(/\/+$/, '')

  return {
    plugins: [react(), tailwindcss(), siteMeta(siteUrl)],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: { port: 5183, strictPort: true },
    preview: { port: 4183, strictPort: true },
  }
})
