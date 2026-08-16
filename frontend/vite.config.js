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
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'AI Book Creator',
        short_name: 'Book Creator',
        description: 'Create, edit, and read AI-generated ebooks — including offline.',
        // Matches the frontend/src/index.css @theme tokens (Tailwind v4 OKLCH
        // values converted to sRGB hex): --color-accent and --color-surface.
        theme_color: '#7f22fe',
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
