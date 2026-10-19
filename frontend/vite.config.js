import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Library chunks, split out of the app code so they cache independently
// across deploys (app code changes far more often than React does) and so
// the heavy editor-only libraries never ride along with the storefront.
// @uiw/react-md-editor is also used by the readers (KenlibsReadPage,
// ViewBook via MarkdownContent) to render chapter markdown, so that chunk
// loads there too — just never on the storefront, detail, or checkout pages.
//
// Uses Rolldown's codeSplitting groups (Vite 8 bundles with Rolldown), not
// rollupOptions.output.manualChunks: under Rolldown, the manualChunks
// function form pulled shared modules into the md-editor/dnd-kit chunks,
// which made the entry chunk statically import (and index.html modulepreload)
// both of them on every page — exactly what this split is meant to avoid.
// Check dist/index.html's modulepreload links after changing this.
const VENDOR_CHUNKS = [
  { name: 'vendor-react', test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/ },
  { name: 'md-editor', test: /[\\/]node_modules[\\/]@uiw[\\/]/ },
  { name: 'dnd-kit', test: /[\\/]node_modules[\\/]@dnd-kit[\\/]/ },
]

// https://vite.dev/config/
export default defineConfig({
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: VENDOR_CHUNKS,
        },
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered by src/utils/registerServiceWorker.js instead of the
      // plugin's injected registerSW.js, so a browser that refuses the
      // service worker can't cause an unhandled promise rejection.
      injectRegister: false,
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
        // Brand green, same as the header bar in both themes, so the
        // installed app's status bar and splash never flash white or orange
        // against a dark page.
        theme_color: '#09262e',
        background_color: '#09262e',
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
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff,woff2}'],
        // Admin/editor-only chunks (and the ~1MB markdown editor library)
        // are left out of the precache so a storefront visitor's service
        // worker install doesn't download them. They're still cached on
        // first real use by the hashed-assets rule in runtimeCaching below
        // — which is what keeps offline reading working, since the reader
        // also renders chapters through the md-editor chunk.
        // Audio files are never precached either (none are built today;
        // this keeps it that way if one is ever added to public/).
        globIgnores: [
          '**/md-editor-*.js',
          '**/dnd-kit-*.js',
          '**/EditorPage-*.js',
          '**/AudiobookTab-*.js',
          '**/*.{mp3,m4a,aac,ogg,oga,opus,wav,flac}',
          // Self-hosted fonts (src/fonts.css): only the four Latin upright
          // faces are precached; italics and Latin Extended load on demand.
          '**/*-italic-*.woff2',
          '**/*-latin-ext-*.woff2',
        ],
        runtimeCaching: [
          // Hashed build chunks not in the precache (see globIgnores above).
          // Content-hashed filenames never change content, so CacheFirst is
          // always safe; old ones age out via the expiration limits.
          {
            urlPattern: ({ url, request, sameOrigin }) =>
              sameOrigin &&
              request.method === 'GET' &&
              /^\/assets\/.+\.(js|css)$/.test(url.pathname),
            handler: 'CacheFirst',
            method: 'GET',
            options: {
              cacheName: 'lazy-chunks',
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [200] },
            },
          },
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
          // Audiobook narration is deliberately NOT cached and NOT
          // intercepted: the player streams it from short-lived signed
          // Cloudinary URLs (api.cloudinary.com, cross-origin) with HTTP
          // Range requests, and GET /api/kenlibs/audio/:bookId hands out
          // those URLs. Neither matches any rule here (the api-books rule is
          // only /api/books[/<id>]), so Workbox never touches them: caching
          // would keep paid-for audio around after access is revoked, and a
          // cached 200 can't answer Range requests for seeking.
          //
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
