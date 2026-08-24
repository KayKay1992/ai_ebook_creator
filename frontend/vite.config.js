import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // The real Kenlibs icon set (Step 48) — favicon.ico + apple-touch-icon
      // are referenced directly by index.html's <link> tags but aren't
      // otherwise picked up as manifest icons, so they're listed here to
      // make sure the service worker precaches them too. The sized favicon
      // PNGs are covered by the workbox globPatterns below already.
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Kenlibs — Your Library',
        short_name: 'Kenlibs',
        description: 'Browse, buy, and read your library of books — including offline.',
        // Matches frontend/src/index.css's @theme --color-accent (Step 47's
        // terracotta/navy palette promotion).
        theme_color: '#c4592f',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          // Android-specific filename convention some PWA tooling expects
          // alongside the generic pwa-* set above — same artwork, not a
          // maskable-safe-zone variant, so deliberately not tagged
          // `purpose: 'maskable'` (that would claim a safe-zone crop this
          // art doesn't actually have).
          {
            src: 'android-chrome-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        // App shell: precache built JS/CSS/HTML (and static icons) so the
        // app itself loads offline.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          // Book list + single-book reads: prefer fresh data when online,
          // but fall back to the last-seen response when offline so a
          // previously-opened book stays readable. Deliberately scoped to
          // exactly "/api/books" or "/api/books/<id>" so it never matches
          // the sibling POST-only /api/books/cover/:id or
          // /api/books/chapter-image/:id upload routes.
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              /^\/api\/books(\/[a-f0-9]{24})?$/.test(url.pathname),
            handler: 'NetworkFirst',
            method: 'GET',
            options: {
              cacheName: 'api-books',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
              networkTimeoutSeconds: 10,
            },
          },
          // Uploaded cover/chapter images rarely change once uploaded, so
          // prefer the cached copy and only hit the network for new ones.
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' && /^\/uploads\//.test(url.pathname),
            handler: 'CacheFirst',
            method: 'GET',
            options: {
              cacheName: 'uploaded-images',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // Everything else — auth, AI generation (including the SSE
          // streaming chapter-content endpoint), export, and all
          // POST/PUT/DELETE requests — is deliberately left unmatched here,
          // which means Workbox never intercepts it: it always goes
          // straight to the network with no caching or offline fallback.
        ],
      },
    }),
  ],
})
