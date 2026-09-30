import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        id: '/',
        scope: '/',
        name: 'Prima – Instandhaltung',
        short_name: 'Prima',
        description: 'Wartung, Störungen und Abnahmen für Industrieanlagen',
        lang: 'de',
        dir: 'ltr',
        start_url: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        categories: ['productivity', 'business'],
        background_color: '#0E1A24',
        theme_color: '#0E1A24',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      devOptions: { enabled: true, type: 'module' },
      workbox: {
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/storage/v1/object/public/'),
            handler: 'CacheFirst',
            options: { cacheName: 'maschinen-medien', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 } }
          }
        ]
      }
    })
  ],
  server: { host: true, port: 5173 }
})
