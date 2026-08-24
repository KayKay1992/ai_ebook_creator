# Deployment

Backend → Render, frontend → Vercel, database → MongoDB Atlas. Two independent
deployments (see `CLAUDE.md`) — there's no shared build step, so each is set
up separately.

## 1. MongoDB Atlas

1. Create a free (or paid) cluster.
2. Database Access → add a database user (username/password, not OAuth) with
   read/write on the database this app will use.
3. Network Access → add an IP allowlist entry. Render's free/starter tiers
   don't expose a static outbound IP, so the practical option is
   `0.0.0.0/0` ("allow access from anywhere") and let `MONGO_URI`'s
   username/password be the actual access control. If you're on a Render
   plan with a static IP add-on, allowlist that IP instead and skip the
   open range.
4. Get the connection string (`mongodb+srv://...`) — this is `MONGO_URI`.

## 2. Backend → Render

1. New Web Service → connect this repo → set **root directory to `backend/`**.
2. Build command: `npm install`. Start command: `npm start` (already just
   `node server.js` — no nodemon or other dev-only tooling involved, see
   `backend/package.json`).
3. Set environment variables (see `backend/.env.example` for the full list
   with descriptions):
   - `MONGO_URI` — from step 1
   - `JWT_SECRET` — a long random value, not reused from local dev
   - `GEMINI_API_KEY`
   - `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`
   - `GMAIL_USER`, `GMAIL_APP_PASSWORD`
   - `FRONTEND_URL` — leave as a placeholder for now (e.g. your intended
     custom domain, or just leave unset); comes back to this in step 4
   - `ALLOWED_ORIGINS` — also comes back to in step 4, once the Vercel URL exists
   - Do **not** set `PORT` — Render assigns and injects it itself; the app
     already reads `process.env.PORT` with a fallback for local dev only.
4. Deploy. Once live, note the Render URL (e.g. `https://kenlibs-api.onrender.com`).
5. Sanity check: `curl https://<your-render-url>/api/auth/login` should
   return a 400 (missing credentials JSON), not a connection error — confirms
   the service is up and reachable before wiring the frontend to it.

## 3. Frontend → Vercel

1. New Project → connect this repo → set **root directory to `frontend/`**.
   Framework preset should auto-detect as Vite.
2. Build command: `npm run build` (default). Output directory: `dist` (default).
3. Set environment variables (see `frontend/.env.example`):
   - `VITE_API_URL` = the Render URL from step 2.4 (no trailing slash),
     e.g. `https://kenlibs-api.onrender.com`
   - Set it for **both** Production and Preview environments in Vercel's env
     var UI — preview deployments need to reach the real API too, otherwise
     every PR preview silently falls back to `localhost:8000` and appears
     broken.
4. Deploy. Note the production URL (e.g. `https://kenlibs.vercel.app`, or
   your custom domain once attached).

## 4. Wire the two together

Now that both real URLs exist:

1. **Back on Render**, update:
   - `FRONTEND_URL` → the real Vercel production URL (used for password
     reset email links and the OG-preview crawler redirect — see
     `CLAUDE.md`'s Environment section).
   - `ALLOWED_ORIGINS` → comma-separated list including at minimum the real
     Vercel production URL, e.g.
     `ALLOWED_ORIGINS=https://kenlibs.vercel.app,https://your-custom-domain.com`
   - Optionally, `ALLOWED_ORIGIN_PATTERN=https://*.vercel.app` if you want
     Vercel's per-branch/PR preview deployments to be able to call the live
     API without hand-adding each preview URL to `ALLOWED_ORIGINS`. This is
     opt-in and off by default — see `backend/app.js`'s `ORIGIN_PATTERN`
     comment and `backend/tests/cors.test.js` for exactly what it does and
     doesn't match. Leave it unset if you'd rather preview deploys hit a
     separate staging API or fail closed.
   - Redeploy (env var changes on Render require a redeploy to take effect
     for a running service, same as most PaaS providers).
2. **Back on Vercel**, `VITE_API_URL` is already set from step 3.3 — no
   change needed unless the Render URL changes later (e.g. after attaching a
   custom domain to the backend too).

## 5. The OG-preview crawler route needs a Vercel rewrite

`backend/routes/ogPreviewRoute.js` (Step 34) serves crawler-facing HTML at
`/kenlibs/book/:id` and `/kenlibs/bundle/:id` — the **same paths** the SPA
itself uses for those pages. This only works if link-preview crawlers
(Facebook, Twitter/X, WhatsApp, etc.) hitting those paths on the **frontend
domain** get transparently routed to the backend, while every other path
(and non-crawler visitors to those same two paths) keeps going to the
frontend's static SPA build.

Add `frontend/vercel.json` (create it if it doesn't exist) once the Render
backend URL is known:

```json
{
  "rewrites": [
    { "source": "/kenlibs/book/:id", "destination": "https://<your-render-url>/kenlibs/book/:id" },
    { "source": "/kenlibs/bundle/:id", "destination": "https://<your-render-url>/kenlibs/bundle/:id" }
  ]
}
```

Without this, shared Kenlibs book/bundle links will still work for real
human visitors (the SPA renders them client-side), but link previews on
social/messaging platforms will show generic fallback text/no image instead
of the book's actual title, blurb, and cover — because the crawler never
executes the SPA's JS and never reaches `ogPreviewRoute.js` at all.

After adding this, redeploy the frontend and verify with a crawler-UA
request, e.g.:

```
curl -A "facebookexternalhit/1.1" https://<your-vercel-url>/kenlibs/book/<a-real-published-book-id>
```

should return the crawler HTML with real `og:title`/`og:image` tags (see
`ogPreviewRoute.js`'s `renderCrawlerHtml`), not the SPA's generic `index.html`.

## 6. End-to-end testing checklist

- [ ] Load the Vercel URL, confirm the app boots and `/api` calls succeed
      (check the Network tab — no CORS errors, no requests to `localhost`)
- [ ] Register/log in, confirm the JWT round-trips correctly
- [ ] Generate an AI outline/chapter (confirms `GEMINI_API_KEY` is live)
- [ ] Upload a cover/chapter image (confirms Cloudinary credentials)
- [ ] Export a book as PDF/DOCX
- [ ] Request a password reset for a real inbox, confirm it actually arrives
      (confirms `GMAIL_USER`/`GMAIL_APP_PASSWORD` work from Render, not just
      locally — Gmail's SMTP relay can behave differently from a datacenter
      IP than from a home connection)
- [ ] From the browser devtools console on the deployed frontend, run a
      cross-origin `fetch` against the Render API from a *different* origin
      (e.g. `https://example.com` via browser extension or a scratch HTML
      file) and confirm it's blocked — sanity-checks the allowlist is
      actually restrictive in the real deployed environment, not just in
      `backend/tests/cors.test.js`
- [ ] Test the OG-preview rewrite with the `curl -A "facebookexternalhit..."`
      command from section 5
- [ ] If using Vercel preview deployments with `ALLOWED_ORIGIN_PATTERN`
      enabled: open a PR, confirm the preview URL can call the API; without
      it enabled, confirm the preview URL is correctly rejected (CORS error
      in console, not a working app)
