# Kenlibs — Architecture & Build Plan

This document lays out the full system before any more code gets written, since
this changes the shape of the whole app — not just adding a feature, but adding a
second *kind of user* with a fundamentally different relationship to the app than
anyone who's used it so far.

---

## 1. The core shift

Today, every logged-in user is the same kind of user: someone creating and
managing their own books. Kenlibs introduces a second kind of user — someone who
never creates anything, only buys and reads. These two kinds of users must never
see each other's surface area. A reader should not be able to reach `/dashboard`,
`/editor/*`, or `/profile` even by typing the URL directly. An admin (you) keeps
everything they have today, plus a new approval/management surface.

This means **role is now a first-class concept that gates routing**, not just a
field that happens to exist on the User model.

---

## 2. Roles

| Role | Who | Can do |
|---|---|---|
| `admin` | You (and only you, initially) | Everything that exists today (create/edit/export/publish books, design covers) + set prices, create bundles, review/approve/reject purchase requests, view all users and their purchases |
| `reader` | Anyone who signs up through Kenlibs | Browse the public storefront, request to buy, upload payment evidence, read only the books/bundles they've been approved for |

`User.role` defaults to `'reader'` for new signups through Kenlibs. Your existing
account gets manually set to `'admin'`. There is deliberately no self-service way
to become an admin — that's set directly in the database or by an existing admin,
never through a public form.

---

## 3. Data model changes

### `User` (extend existing model)
```
role: { type: String, enum: ['admin', 'reader'], default: 'reader' }
```

### `Book` (extend existing model)
```
price: { type: Number, default: null }   // null = not for sale
isForSale: { type: Boolean, default: false }  // explicit toggle, separate from price
                                               // being set, so admin can price a book
                                               // ahead of time without listing it yet
previewContent: { type: String, default: '', maxlength: 2000 }
```

`previewContent` is the storefront teaser: the only long-form descriptive
text written specifically for the public book page (its "About this book"
section). It's sales copy, never an excerpt, and is drafted with AI
(`POST /api/ai/generate-teaser`, built from title/description/chapter titles
and descriptions only, never chapter content) or written by hand, then
reviewed and saved by the admin. Only `GET /api/public/kenlibs/books/:id`
returns it; the storefront listing doesn't. The other public text,
`coverDesign.back.blurb`, is back-cover copy that comes with the cover design.

```
audio: {
  voice: String,                       // default 'Sulafat'
  chapters: [{ chapterId, status,      // queued | generating | ready | failed | skipped
               publicId, durationSec, bytes, textHash, voice, charCount,
               progress, queuedAt, startedAt, generatedAt, error }]
}
```

`audio` is the AI audiobook narration (Gemini TTS → MP3 → Cloudinary). One
entry per chapter, keyed by the chapter's `_id`. `textHash` is a sha256 of the
exact narration text used, so the editor shows "Out of date" once the chapter
is edited. `publicId` is an **authenticated** (non-public) Cloudinary asset in
`ebook-creator/audio/<bookId>/`; it stays set while a regeneration is queued,
running or failed, so the old audio keeps playing until a replacement is
uploaded.

**Rule: never expose `publicId` or any audio URL from a public endpoint.** The
storefront listing and `GET /api/public/kenlibs/books/:id` only add
`hasAudio` and `audioChapterCount` (`utils/audioSummary.js`). The only source
of playable URLs is `GET /api/kenlibs/audio/:bookId`, gated by
`hasBookAccess` exactly like `readBook`, which returns short-lived signed
`private_download_url` links (default 1 hour, `AUDIO_URL_TTL_SECONDS`). The
service worker never caches audio. There's no separate audio price: the admin
prices a book with narration higher.

### `Bundle` (new model)
```
title: String, required
description: String
coverImage: String (Cloudinary URL, optional — falls back to a generated grid of
            included book covers if unset)
books: [{ type: ObjectId, ref: 'Book' }]
price: Number, required
isForSale: Boolean, default: false
createdAt / updatedAt
```

### `PurchaseRequest` (new model)
```
reader: { type: ObjectId, ref: 'User', required }
itemType: { type: String, enum: ['book', 'bundle'], required }
item: { type: ObjectId, required }   // refPath-based, points to Book or Bundle
                                      // depending on itemType
amount: Number, required             // snapshot of price at request time — if
                                      // admin changes the price later, this
                                      // request still reflects what was agreed
evidenceImage: String (Cloudinary URL), required
status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' }
adminNote: String                    // optional, shown to reader on rejection
reviewedAt: Date
reviewedBy: { type: ObjectId, ref: 'User' }
createdAt / updatedAt
```

### Access resolution
A reader can access a book if **either**:
- an approved `PurchaseRequest` exists with `itemType: 'book'` and `item` matching
  that book's `_id`, OR
- an approved `PurchaseRequest` exists with `itemType: 'bundle'` where the bundle's
  `books` array includes that book's `_id`

This check happens **server-side, on every reading request** — never inferred
client-side, since that's the actual security boundary.

Full chapter text is only ever returned to: readers passing this check
(`GET /api/kenlibs/read/:bookId` and the translation/audio reader
endpoints), the book's owner (the admin editor endpoints and owner-only
exports). The public share link is a **preview only** (see below); the
storefront, detail and OG/crawler endpoints never return chapter text.

### Share link (preview only)
`/read/:shareId` (API: `GET /api/public/books/:shareId`) is public, so it
returns a preview built server-side from an allowlist
(`backend/utils/sharePreview.js`): the first `SHARE_PREVIEW_CHAPTERS`
chapters (default 1) as excerpts of about 1,500 characters ending at a
paragraph boundary, and every other chapter as a locked title
(`locked: true`, no content), plus `isPreview`, `totalChapters` and
`previewChapters`. Never chapter descriptions, summaries, the teaser,
translations or audio. A direct API call gets exactly the same preview; the
share page only displays it, with lock icons and a "Preview only: buy the
full book" button to `/kenlibs/book/:id` (signup-first buy flow). shareIds
are 12-character random ids (72 bits), and unpublishing makes the link 404.

---

## 4. Route map

### Existing (admin-only from now on)
```
/                      landing (public, unchanged)
/login, /signup        existing creator/admin auth (unchanged)
/dashboard              admin only
/editor/:bookId         admin only
/editor/:bookId/cover   admin only
/profile                admin only
/view-book/:bookId      admin only (this is the CREATOR's own reading/preview view)
```

### New — public (no login required)
```
/kenlibs                storefront: browse for-sale books + bundles
/kenlibs/book/:id       book detail page (price, blurb, back cover, "Request to Buy",
                        "About this book" teaser from Book.previewContent)
/kenlibs/bundle/:id     bundle detail page
/read/:shareId          share link: PREVIEW only (first chapter excerpt,
                        other chapters locked), links to /kenlibs/book/:id
```

### New — reader auth (separate from admin auth conceptually, same User model)
```
/kenlibs/login
/kenlibs/signup
```

### New — reader, authenticated
```
/kenlibs/checkout/:type/:id    upload payment evidence, submit PurchaseRequest
/kenlibs/my-books               reader's approved purchases + pending requests
/kenlibs/read/:bookId           gated reading view (server-verifies access);
                                also hosts the audiobook player when the book has
                                narration (GET /api/kenlibs/audio/:bookId), the
                                "Chapter recap", and the language selector for
                                published AI translations
                                (GET /api/kenlibs/translations/:bookId,
                                GET /api/kenlibs/read/:bookId/translation/:lang),
                                and the reader's private highlights, notes and
                                bookmarks (/api/kenlibs/annotations/:bookId)
```

### New — admin only
```
/editor/:bookId → Audiobook tab   narration: voice + preview, per-chapter
                        generate/regenerate/delete, "Generate all missing"
                        (API: /api/books/:id/audio, .../generate, .../preview,
                        .../:chapterId)
/editor/:bookId → Translations tab   AI translation per language and chapter:
                        translate (background job), edit draft, mark reviewed,
                        publish/unpublish (API: /api/books/:id/translations/...)
/editor/:bookId → Details tab   Chapter summaries panel (API: POST
                        /api/ai/chapter-summary; saved with the book)
/admin/purchases        pending requests queue, approve/reject, view evidence
/admin/users             all registered readers + what they've purchased
```

### Route guarding logic
`ProtectedRoute` becomes role-aware. Two variants:
- `<AdminRoute>` — redirects anyone who isn't `role: 'admin'` to `/kenlibs`
- `<ReaderRoute>` — redirects anyone who isn't authenticated at all to
  `/kenlibs/login`; doesn't need to block admins from reader routes (an admin
  browsing their own storefront is harmless), but a reader must never pass
  `<AdminRoute>`

`/view-book/:bookId` (existing) and `/kenlibs/read/:bookId` (new) are
**deliberately separate routes** — one is the creator's own unrestricted preview,
the other is the access-gated reader experience. Don't merge them; the access
check only belongs on the reader path.

---

## 5. Reusing what's already built

This is the payoff of the last 22 steps — very little here is new rendering work:

- **`CoverPreview`** (Step 15/22) — same component powers storefront grid cards,
  book detail pages, and the hover-flip front/back interaction from the Kotobee
  reference. No new cover rendering code needed.
- **Cover Designer's back cover** (Step 22: blurb, author bio, review quotes) —
  this is exactly the sales copy a storefront listing needs. It was future-proofed
  for this without knowing it yet.
- **`MarkdownContent`** (Step 9) — powers the actual reading experience at
  `/kenlibs/read/:bookId`, same as the existing reader.
  Skeleton loading pattern (Step 7) — reuse for storefront/purchase-flow loading
  states.
- **Design tokens** (Step 5/6) — storefront should look like the same product, not
  a bolted-on separate site.
- **Cloudinary upload** (Step 17) — reused directly for payment evidence upload.
- **Export/PWA/streaming/tone-lock/inline-edit/vitals** — all admin-side tools,
  untouched by this work. A reader never sees any of it.

---

## 6. Reader journey (what it should feel like end to end)

1. Land on `/kenlibs`, browse featured/latest books and bundles, hover a cover to
   see the back (blurb, price)
2. Click a book → detail page with full blurb, price, author bio
3. Click "Request to Buy" → a signed-in reader goes straight to checkout. A
   logged-out visitor goes to `/kenlibs/signup` (`role: reader` by default). Signup
   does not sign them in: it hands off to `/kenlibs/login` with the email prefilled
   and "Account created. Sign in to continue.", and signing in continues to checkout.
   Both pages carry `{ from: checkoutPath }` in router state; "Sign in" / "Create an
   account" links between them keep it.
4. On the checkout page: see the price, your own payment instructions (bank
   details — static content you control, not built by the app), upload a
   screenshot/evidence of the transfer, submit. If the reader already owns the item
   they're sent to read it (a bundle → the Library); if a request for it is already
   pending they see "Your request is pending review" instead of the form (the API
   also refuses that duplicate with a 409).
5. Land on `/kenlibs/my-books` — see the request as "Pending". The admin gets an
   email (`ADMIN_NOTIFY_EMAIL`, else every `role: admin` account)
6. (You, the admin, review and approve/reject via `/admin/purchases`). The reader
   gets an email on approve, reject (with your note, and a link to fix and resubmit
   from the Library) and revoke; a resubmission emails the admin again
7. Reader's `/kenlibs/my-books` now shows the book as available; clicking it opens
   `/kenlibs/read/:bookId`

## 7. Admin journey (new part)

1. Set a price on a book (in `BookDetailsTab.jsx`, new "Kenlibs Listing" section:
   price, isForSale toggle)
2. Optionally group books into a `Bundle` (new small admin UI — title,
   description, pick books, set bundle price)
3. Check `/admin/purchases` periodically — see pending requests with the uploaded
   evidence image, reader's email, requested item, amount
4. Approve or reject with one click (reject can include a short note, e.g. "evidence
   unclear, please resend")
5. `/admin/users` — see every reader, what they've requested/bought, for support/
   lookup purposes

---

## 8. Build order (Steps 23-28)

Each step is independently testable/committable, same discipline as Steps 1-22.

**Step 23 — Roles + route guarding foundation**
User.role field, AdminRoute/ReaderRoute components, migrate existing
ProtectedRoute usages to AdminRoute, set your own account to admin. No new pages
yet — this just builds and proves the guarding mechanism works.

**Step 24 — Pricing + Bundles**
Book.price/isForSale fields, Bundle model + basic admin CRUD UI, "Kenlibs Listing"
section in BookDetailsTab.jsx. No public-facing page yet.

**Step 25 — Public storefront**
`/kenlibs`, `/kenlibs/book/:id`, `/kenlibs/bundle/:id` — browse-only, no purchase
flow yet. This is where the Kotobee-style grid + hover-flip lands, using
CoverPreview and the existing back-cover data.

**Step 26 — Reader auth + purchase request flow**
`/kenlibs/login`, `/kenlibs/signup` (role: reader), PurchaseRequest model,
checkout page with evidence upload, `/kenlibs/my-books`.

**Step 27 — Admin approval dashboard**
`/admin/purchases` — queue, evidence viewer, approve/reject with note.

**Step 28 — Gated reading access + admin user list**
`/kenlibs/read/:bookId` with server-side access verification, `/admin/users`.

---

## 9a. Phase 2 — Post-launch refinements (Steps 29-34)

Once Steps 23-28 land (roles, pricing/bundles, storefront, purchase flow,
approval dashboard, gated reading), the following extends the product based on
direct feedback after seeing it running:

**Step 29 — Kenlibs rebrand**
Remove all "AI eBook Creator" / AI-generated framing from every reader-facing
surface — site name, titles, meta tags, footer, storefront copy. Site becomes
"Kenlibs" everywhere a reader can see it. Admin-side tooling (editor, "Generate
with AI" buttons, etc.) keeps its real labels — this only applies to what a
reader-facing visitor sees. Tradeoff worth remembering: not disclosing AI
authorship raises the stakes on writing quality, since the whole point of this
rebrand is presenting as a conventional curated bookstore.

**Step 30 — Purchase lifecycle extensions**
Extend PurchaseRequest:
- status enum grows to include 'revoked' (approved -> revoked is a distinct,
  trackable state, not reused from 'rejected')
- Reader can resubmit new evidence on a rejected request, resetting it to
  'pending' (keep the original adminNote as history rather than erasing it —
  e.g. an array of review events, or at minimum don't overwrite silently)
- Admin can approve directly from 'rejected' (relax Step 27's "must currently be
  pending" guard to also allow rejected -> approved)
- Admin can revoke a previously 'approved' request -> 'revoked'
- CRITICAL: Step 28's access check must treat 'revoked' as no-access, same as
  'pending'/'rejected'/never-requested. Revoking must immediately cut off
  reading access, same guarantee as unpublish did for share links in Step 16.

**Step 31 — Premium animated design pass**
All reader-facing pages (storefront, detail pages, checkout, my-books, the
reader itself) get a real motion/interaction design pass — likely adding Framer
Motion as a new dependency. Page-load reveals, smooth cross-page transitions,
richer hover/interaction states beyond what Steps 25-28 shipped functionally.
Should not touch admin-side pages (dashboard, editor, etc.) — those stay as they
are, this is reader-experience-only.

**Step 32 — Reading notepad + resume position**
New ReaderProgress model (or similar): reader, book, lastChapterIndex,
lastScrollPosition (optional), notes (free-form text, one note doc per
reader+book, autosaved same debounce pattern as Step 2). Slide-out notepad panel
in the reader. Opening /kenlibs/read/:bookId resumes at the last-read chapter
rather than always starting at chapter 1.

**Step 33 — Audio reader (listen mode)**
Reader can listen to a book instead of / while reading, using the browser's
built-in Web Speech API (SpeechSynthesis) — no new backend infrastructure, no
API keys, works offline once loaded (pairs with the existing PWA support from
Step 13). Play/pause/speed controls, highlight the currently-spoken
sentence/paragraph as it's read (via SpeechSynthesisUtterance boundary events),
auto-advance to the next chapter when one finishes. Scope to the gated reader
(/kenlibs/read/:bookId) only — an admin's own preview view doesn't need this.

**Step 34 — Storefront search + Open Graph tags**
Search bar + basic genre/category filtering on /kenlibs once the catalog is
large enough to need it. Open Graph meta tags on book/bundle detail pages so
shared links (WhatsApp, Twitter, etc.) render a proper preview card (cover,
title, blurb) instead of a bare link.

---

## 9b. Phase 3 — Post-31 additions (Steps 34-38+)

Built after Steps 29-33 landed, based on direct usage/feedback:

**Step 34 — Storefront search + Open Graph tags (DONE, commit f8d7a10)**
- Part 1, search/filter on /kenlibs: DONE. Client-side title/author search
  (200ms debounce) + genre pills (only render when 2+ distinct genre values
  exist in the catalog). Sectioned Featured/Latest/Bundles view when no
  filter is active; flat filtered grid when active, keyed to
  query+genre so the reveal animation replays per filter change. No backend
  change needed — confirmed the existing storefront response payload is small
  enough for client-side filtering to be the right call.
- Part 2, Open Graph tags: the first attempt (client-side meta tag injection
  via a useOpenGraphTags hook) was confirmed NOT sufficient — verified via curl
  impersonating Facebook's crawler that social/messaging crawlers never
  execute JS and only ever saw the generic static index.html. A real fix was
  built in the same commit as Part 1 (see "OG crawler route" below) — despite
  the two being unrelated features, both landed together under a commit
  message ("add real Open Graph link previews for crawler traffic") that only
  names the OG half.

**OG crawler route (DONE, same commit as Step 34 — f8d7a10)**
backend/routes/ogPreviewRoute.js — GET /kenlibs/book/:id and
/kenlibs/bundle/:id, mounted directly (not under /api). Detects 13 known
crawler user-agents (Facebook, Twitter, WhatsApp, LinkedIn, Slack, Discord,
Telegram, Skype, Reddit, Pinterest, VK, Viber) and returns a minimal static
HTML page with real og:title/og:description/og:image/og:url tags (book
titles HTML-escaped; og:image only emits for absolute/Cloudinary URLs) plus
a meta-refresh to the real SPA URL. Non-crawler traffic gets an immediate
302, unaffected. Reuses publicBookController.js's visibility rules.

>>> DEPLOYMENT REQUIREMENT, NOT YET DONE: this route only actually intercepts
>>> crawler traffic once the production reverse proxy/CDN is configured to
>>> route /kenlibs/book/* and /kenlibs/bundle/* to the backend instead of
>>> serving the frontend's static SPA build directly. This is an infra
>>> decision that depends on the eventual hosting setup (Nginx reverse proxy
>>> rule, Vercel/Netlify rewrite rule, CDN routing rule, etc.) and cannot be
>>> finished until deployment is decided. Full end-to-end verification also
>>> requires a real public/tunneled URL via Facebook's Sharing Debugger — not
>>> testable against localhost. REVISIT THIS AT DEPLOYMENT TIME.

**Step A — Legacy cover path audit (DONE)**
Audited every Book's coverImage, coverDesign.front.backgroundImage, and
coverDesign.back.authorPhoto for legacy pre-Cloudinary /uploads/... relative
paths (no longer served since Step 17's migration). Found 2 of 7 books
affected, both only in the top-level coverImage field (both predate Step 22,
so the Cover Designer fields were never touched for them): "The Almagedon"
(6a6303d336ac11b9f3560ec9) and "Surviving Nigeria Without Losing Yourself..."
(6a68e722f56191d2313b3ee0). Reported to the admin for manual re-upload via
the existing Cloudinary flow — deliberately not auto-fixed. Also confirmed
every code path that touches these fields (exportController.js's
fetchImageBuffer/fetchImageToTempFile/resolveChapterImagesForEpub,
ogPreviewRoute.js's asAbsoluteImage) already guards on absolute-URL-only and
degrades gracefully rather than crashing on a stale path.

**Step 35 — Completion badge/certificate (DONE, commit 27767cd)**
ReaderProgress gained a completedAt field (backend/models/ReaderProgress.js),
set once in updateProgress when an incoming lastChapterIndex update equals
the book's final chapter index and completedAt isn't already set — never
reset by later navigation back to an earlier chapter, confirmed by testing
(reload progress after navigating back to chapter 1: completedAt unchanged;
re-reaching the final chapter again: still the exact same timestamp).
GET /api/kenlibs/certificate/:bookId (kenlibsController.js) enforces the same
hasBookAccess check as readBook, plus a separate check for completedAt — a
403 with "You don't have access to this book" vs a distinct 400 "Finish
reading this book to unlock your certificate," not one generic 403 for both.
Certificate is a single-page landscape PDF (backend/utils/certificateRenderer.js)
built with pdfkit's base-14 fonts (no new font-embedding dependency, matching
the rest of this project's PDF output) — double border frame, Kenlibs
wordmark, reader name/book title/author/completion date, a drawn
checkmark-in-circle seal, and an optional cover thumbnail when the book has
a usable absolute cover URL. KenlibsReadPage shows a restrained "You finished
this book!" card (Award icon, one spring pop-in, no confetti) at the bottom
of the final chapter's content with a Download Certificate button, flushing
the final-chapter progress save immediately (not the usual debounce) so the
button doesn't race completedAt being set. KenlibsMyBooksPage surfaces a
Certificate button next to Read Book (and per-book inside a completed
bundle) for any book with completedAt set, fetched per-book via the existing
progress endpoint — no new bulk endpoint, matching this catalog's small
scale (same call as the earlier legacy-path audit's client-side-filtering
reasoning).
Two real bugs found only by actually opening the generated PDF, not just
trusting it compiled: (1) pdfkit auto-inserts a page break when
explicitly-positioned text falls within the configured bottom margin —
a generous 90pt bottom margin silently produced a 3-page certificate with 2
blank trailing pages; fixed by using small uniform 20pt margins throughout,
since every element here is manually positioned anyway. (2) embedding a
book's cover at full upload resolution bloated the certificate past 1.6MB
and hung Chrome's own PDF.js renderer; worse, Cloudinary's q_auto/f_jpg
combination returned a *progressive* JPEG for at least one real cover, which
pdfkit's bundled JPEG parser mishandles (DCTDecode bytes embedded directly,
no re-encoding) — fixed by requesting a small Cloudinary-transformed
thumbnail with fl_progressive:none forcing baseline encoding.

**Step 36 — Word explanation popup (DONE, commit d288028)**
Select/tap a word in the reader → popup definition
(frontend/src/components/kenlibs/WordExplainPopup.jsx). Primary: free
Dictionary API (api.dictionaryapi.dev) queried directly from the client, no
backend involvement for the common case. Fallback for dictionary misses
(proper nouns, invented terms, multi-word phrases): explicit "Explain in
context" button calling a new backend endpoint (kenlibsController.js,
reusing the existing AI auth/rate-limit pattern) that sends the word +
surrounding sentence to Gemini. AI fallback is opt-in-per-lookup only, never
automatic, matching the cost-control intent this step was scoped around.

**Step 37 — Multi-language translation, Nigerian languages first (DONE,
commit d0122e9)**
Built with Gemini (the existing GEMINI_API_KEY and quota handling) rather
than the originally planned Google Cloud Translation API, so no GCP project
or new credentials were needed. Languages: Nigerian Pidgin, Yoruba, Igbo,
Hausa, French, kept in one config constant
(backend/config/translationLanguages.js). Known tradeoff unchanged: machine
translation for these languages is real but behind major global
languages, so every translated chapter carries an "AI-translated" label
and nothing reaches readers without the admin's review and publish.
Architecture, as built:
- Pre-generated and stored, NEVER translated live per read: a separate
  BookTranslation collection, one document per (book, language), with a
  draft and a published copy of each chapter. Status per chapter: draft →
  reviewed → published; publishing is per chapter and manual only.
  Editing or re-translating a published chapter changes only its draft;
  readers keep the published copy until it's republished.
- Admin-triggered background job per book, language and chapter
  (utils/translationJobs.js), the same design as audiobook narration:
  database as the queue, one chapter and one Gemini request at a time,
  chunked by paragraph and resumable per chunk, "Waiting for quota" when
  Gemini's daily limit is hit, heartbeat + restart recovery. Paragraph
  alignment is enforced (JSON array in, same-length array out); markdown,
  numbers and ₦ amounts are preserved and checked; names of people, brands
  and places are not translated. A source chapter edited after translation
  flags its translation "Out of date" (text hash).
- Admin endpoints under /api/books/:id/translations (owner-checked, like
  every book endpoint) and an editor "Translations" tab with a side-by-side
  draft editor.
- Readers: GET /api/kenlibs/translations/:bookId and
  GET /api/kenlibs/read/:bookId/translation/:lang, both behind
  hasBookAccess like readBook; published chapters only. The public detail
  page lists published languages by name (no text); the share link never
  includes translations. KenlibsReadPage and the book detail page get a
  language selector (only languages with something published), remembered
  per device. Chapters not yet translated show the original with a note.
- Listening: no audio narration for translations (the audiobook player
  stays on the original, and the UI says so). Listen Mode (device voice) is
  off for Pidgin, Yoruba, Igbo and Hausa, and on for French with a French
  device voice where available.
- Resume position (ReaderProgress) stays per book, not per language:
  translations keep the same chapters and paragraph structure, so it lines
  up either way.

**Highlights, notes and bookmarks (DONE, commit d92493c)**
Readers can highlight text in four colors, attach a note to a highlight,
copy or "Explain" a selection (the word-explain popup now opens from the
selection toolbar instead of on every selection), and bookmark a chapter or
the paragraph they're on, with an optional label. A "My highlights & notes"
panel in the reader lists everything by chapter with jump-to, editing,
delete, copy all and Markdown download.
- Stored on the server (new ReaderAnnotation collection), so they sync
  across devices; loaded once per book, saved in small debounced requests.
  Private: every endpoint (/api/kenlibs/annotations/:bookId) requires
  hasBookAccess and only ever touches the requesting reader's own
  annotations. Nothing appears on public or admin endpoints. Limits: notes
  1,000 characters, 2,000 annotations per book per reader, rate-limited
  writes. Deleted with the book or the reader's account.
- Anchored to the paragraph (the same paragraph numbering Listen Mode uses)
  plus offsets, the quoted text and a little surrounding context. If the
  author edits the chapter, the highlight is found again by its quote; if
  the text is gone, it stays in the panel marked "text changed" instead of
  being deleted. One paragraph per highlight in v1.
- Translations: a highlight belongs to the language it was made in, so
  switching language shows that language's highlights; bookmarks show in
  every language.
- Separate from the saved reading position (ReaderProgress), which
  bookmarks never change.
- Also fixed: images in a chapter now show in the gated reader (they were
  dropped along with other non-spoken blocks), without changing Listen
  Mode's paragraph numbering.

**Chapter recaps (AI chapter summaries, DONE)**
Each chapter can have a short reader-facing summary (Book.chapters[].summary,
max 1,200 characters), shown as a collapsible "Chapter recap" at the top of
the chapter in the gated reader only (readBook, behind hasBookAccess). Never
on the public share link or the storefront. Drafted one chapter at a time by
POST /api/ai/chapter-summary (admin + owner, returns a draft, saves nothing)
or written by hand in the editor's Details tab. AI drafts follow the teaser's
safety pattern: they pause all autosave until the admin reviews them and
clicks Save, and an admin-edited summary is never replaced without asking.
"Generate for all" skips chapters that already have one, so it resumes after
a quota stop.

**Step 38 — Design revisit of Step 31 (DONE, commits b2a998e + bd2ab21)**
Step 31's Framer Motion pass was flagged as not meeting the bar wanted
("physical outlook... so so poor"). The revisit landed as a real palette/
typography overhaul rather than a motion-only patch: b2a998e redesigned
every reader-facing Kenlibs page (storefront, book/bundle detail, checkout,
login/signup, my-books, the reader itself) onto the classical terracotta/
navy/cream bookstore palette referenced elsewhere in this doc; bd2ab21
followed up by unifying the admin pages onto the same palette, so the
product no longer reads as two visually distinct halves. A related
regression from Step 31's original Framer Motion usage — a widespread
AnimatePresence freeze bug — was found and fixed separately in d9bc0e8
(which also added the mobile admin sidebar).

**Error monitoring (DONE, commit 81b2016)**
Self-hosted, no third-party service. Server errors (5xx responses only),
failed background jobs (audio narration, translation) and readers'
browser errors are recorded in an ErrorLog collection, grouped so a
repeating error is one entry with a count. Reviewed at /admin/errors
(admin-only, in the admin navigation): sorted by last seen, filter for
unresolved, expandable stack trace, "mark resolved" and delete. Entries
delete themselves 30 days after they were last seen (ERROR_LOG_TTL_DAYS).
- Privacy: no passwords, tokens, headers, cookies, request bodies, chapter
  text, notes or highlights are stored; emails and token-like strings are
  scrubbed from messages and stacks; only a user id, never a name or email.
- Alerts: an email to ADMIN_NOTIFY_EMAIL (Brevo) when a new kind of error
  appears, when a resolved one comes back, or when one spikes, at most
  ERROR_ALERT_MAX_PER_HOUR per hour.
- Readers see a friendly "Something went wrong, please refresh" page
  instead of a blank screen, or "A new version is available" after a
  deploy. Logging never slows or breaks a request, and can be turned off
  with ERROR_LOG_ENABLED=false.

**Backups and restore (DONE, commit 355fad6)**
Free, local backups of the whole MongoDB database, run on the admin's own
PC (never on Render), using backend/.env's MONGO_URI. From backend/:
- `npm run backup`: every collection to backups/<date_time>/ as Extended
  JSON (exact ObjectIds and Dates), streamed, with a manifest of document
  counts and a checksum per file. `--out <dir>` for elsewhere, `--keep N`
  to keep only the newest N (off unless asked).
- `npm run backup:verify`: proves a backup restores, by restoring it into
  a temporary database, comparing counts, and dropping it. The real
  database is never written.
- `npm run restore -- <folder>`: a dry run unless `--apply`; checks every
  checksum and count first; refuses to overwrite the database the backup
  came from unless `--yes-overwrite` AND the database name is typed;
  `--target-uri`/`--target-db` to restore elsewhere, `--only` for some
  collections; never drops a collection without `--drop` (otherwise it
  only adds missing documents).
WARNING: a backup contains personal data: readers' emails and names,
password hashes, purchases and payment evidence links, the admin's bank
details, readers' private notes and highlights. Keep backups private;
never commit, upload or share them (backups/ is git-ignored). Book images,
covers and audio live in Cloudinary and are NOT in a backup; it only holds
their URLs/ids.

**Admin analytics redesign**
/admin/analytics (controller/analyticsController.js, GET /api/admin/analytics
and /api/admin/attention). Definitions:
- Days are Lagos calendar days (Africa/Lagos). Range: from/to (YYYY-MM-DD)
  or range=all; every figure is compared with the previous range of the
  same length (trend chips). Percentages from fewer than 30 people carry
  a "based on N" warning.
- Revenue = CASH RECEIVED: amount − creditApplied, counted on the day a
  purchase was approved. Gross sales and store credit used are shown under
  it. Only approved purchases count (revoked ones drop out).
- Readers = every account that is not an admin (role != 'admin'). Old
  accounts have no role field at all, so never query { role: 'reader' };
  the admin Users page uses the same rule.
- Conversion = readers who have ever had an approved purchase / readers,
  as of the end of the range (and as of its start, for the trend).
- "Hide test data" (off by default, shown as a banner when on): leaves out
  purchases cheaper than minPrice (default ₦100) and everything from admin
  accounts and accounts flagged isTestAccount (toggle on the Users page,
  PUT /api/admin/users/:id/test-account).
- Funnel: book page views → sign-ups → purchase requests → approved, each a
  total for the range (not a cohort). Views come from BookViewDaily
  ({ book, day, views }), counted by POST /api/public/kenlibs/books/:id/view
  from the book detail page (utils/bookViews.js: once per book per day per
  browser via localStorage). Anonymous: no IP, account, cookie or
  fingerprint is stored. Bots and prefetches are skipped, rate limited
  60/10 min per IP, off with BOOK_VIEW_TRACKING_ENABLED=false. There is no
  view history from before it shipped and the page says so.
- PurchaseRequest.itemTitle is a snapshot of the title when the request
  was made, so a deleted book or bundle still shows its real name; only
  when neither the live item nor a snapshot exists does it show "Deleted
  book (title unknown)". Older requests can be filled in with
  `node scripts/backfill-purchase-titles.js` (from backend/): a dry run by
  default that prints every change; `--apply` writes; it only fills empty
  itemTitle fields from items that still exist, never changes anything
  else; `--set-title <requestId> "Title"` supplies a title by hand for a
  deleted item. Take a backup first.
- "Needs attention" row: pending purchase requests (and how long the
  oldest has waited), unresolved errors, audio and translation chapters
  that failed or are waiting for quota, and licences of books by other
  authors that have expired or expire within 30 days. Not affected by the
  date range.
- One Naira format everywhere (utils/kenlibsPricing.js formatNaira, and
  backend utils/sendEmail.js): thousands separators, decimals only when
  there are any (₦5,000, ₦1,500.50).
- Admin nav groups (components/layout/DashboardLayout.jsx): Catalog
  (Bundles, Client Books, Import a book), Sales (Purchases, Analytics,
  Royalties, Reviews, Payment Settings), System (Users, Errors) as menus from lg up; below lg, the
  slide-out sidebar lists the same groups as headings.

**Books by other authors: import, rights, royalties, takedown**
Admin-only. Readers only ever see the author's name (the existing
`Book.author` field: "by <author>" on cards, the book page, checkout, the
purchase decision email and the link preview).
- Import (/admin/import, pages/AdminImportPage.jsx; POST
  /api/admin/import/parse then /commit, controller/importController.js):
  .docx, .epub, .md, .txt and PDFs with selectable text, up to
  IMPORT_MAX_FILE_MB (25). The file type is checked from its bytes (and must
  match the extension); executables, old .doc, gzip/rar/7z are refused. The
  file is parsed in memory and thrown away: never stored, never public.
  Every format becomes HTML or Markdown and goes through one whitelist
  converter (utils/import/htmlToMarkdown.js): no scripts, iframes, forms,
  SVG, raw HTML or javascript: links survive; text is escaped. Zip bombs:
  entry count, declared and actual unpacked size, per-entry size, path
  depth and unsafe paths are capped (utils/import/zipSafe.js). PDFs are read
  by unpdf in a worker thread with a memory cap and a 30s timeout; scanned
  PDFs (no text) are refused, and PDF imports are text only. Images
  (PNG/JPEG/GIF/WebP, checked by signature, count and size caps) stay in
  the draft as `kenlibs-import:<key>` placeholders and are uploaded to
  Cloudinary only on save, only if still used. Rate limits per admin:
  parse 30/hour, commit 60/hour.
- Review screen: title, author, description, cover (the one found in the
  file, or upload one), rights type, holder and royalty %; chapters can be
  renamed, merged (the next title becomes a heading), split before any
  paragraph, reordered and deleted (utils/importDraft.js, unit-tested).
  Saving always creates a draft and opens the editor.
- Rights (`Book.rights`, admin-only, PUT /api/books/:id/rights,
  components/editor/RightsPanel.jsx): type own (default; existing books need
  no migration) / licensed / public domain, holder name and contact,
  licence notes, reference, expiry, territory, royalty % (0-100) of cash
  revenue, plus who confirmed / unpublished and when. `updateBook` strips
  `rights`, `status` and `importedFrom`, so the autosave can't touch them.
- Publish guard (backend utils/bookRights.js publishGuard, mirrored in
  frontend utils/bookRights.js): a non-own book needs `confirmRights: true`
  (the "I have the rights or written permission to sell this book" tick in
  components/editor/PublishControls.jsx) plus licence notes; licensed also
  needs the holder's name; public domain needs the note on why. Otherwise
  400 `code: "rights_required"` with `missing`. confirmedAt/By are recorded.
  An expired licence only shows a warning (editor and Needs attention);
  nothing is unpublished automatically.
- Takedown: "Unpublish immediately" (POST /api/books/:id/unpublish,
  optional private takedownNote). The store page, public preview, share
  link and checkout stop at once; readers who already bought it keep
  access (hasBookAccess is unchanged).
- Royalties (/admin/royalties, GET /api/admin/royalties,
  controller/royaltyController.js): per book and per author for a date
  range: units, cash revenue (the Analytics definition: amount minus store
  credit, on the approval day, Lagos; hideTest respected), royalty % and
  owed. A bundle's cash is shared between its books by list price. Owed
  uses each book's current %. Authors are grouped by name
  (case-insensitive). "Mark as paid" records a RoyaltyPayment (POST/DELETE
  /api/admin/royalties/payments); balance = owed all time minus paid all
  time. CSV download (formula injection neutralised). Nothing is paid out
  from the app.
- Never public: rights, royalty and import data are in no public
  whitelist; tests/bookImport.test.js checks the public endpoints.

**Passkeys (fingerprint / Face ID / screen lock sign-in)**
An addition to email+password, for readers and admins (WebAuthn,
@simplewebauthn/server + /browser). Routes under /api/auth/passkeys
(routes/passkeyRoute.js, controller/passkeyController.js):
- POST /login/options { email? } and /login/verify { flowId, response }:
  public. The options never depend on the email or any account (no
  allowCredentials, "discoverable" passkeys only), so they reveal nothing;
  verify returns exactly the POST /api/auth/login response (same JWT).
- GET /, POST /register/options { password? } + /register/verify
  { flowId, response, nickname }, PUT and DELETE /:passkeyId: signed in,
  own passkeys only. Adding needs a sign-in in the last 10 minutes or the
  password. Max 5 per user. User verification required.
- Relying party: the FRONTEND (WEBAUTHN_ORIGIN / WEBAUTHN_RP_ID /
  WEBAUTHN_RP_NAME, defaults from FRONTEND_URL), never the Render API.
  The RP ID is the domain passkeys belong to: today kenlibs-sooty.vercel.app.
  Moving to a custom domain later makes existing passkeys unusable
  (passwords keep working; readers add a new passkey). Vercel preview URLs
  can't use them.
- Storage: Passkey (publicKey never returned or logged), WebAuthnChallenge
  (5 minutes, TTL index, single use), AuthEvent (passkey added / removed /
  renamed / sign-in; user id, type and nickname only; 90 days). Deleted
  with the account; password reset doesn't touch passkeys.
- Signature counter: 0 that stays 0 is accepted (synced passkeys); a
  non-zero counter that doesn't increase is rejected as a possible clone.
- Rate limits per IP and per passkey/account (middleware/passkeyRateLimits.js).
- UI: "Sign in with fingerprint / passkey" on /kenlibs/login and /login
  (only when the browser supports WebAuthn), "Fingerprint & passkeys" on
  /kenlibs/profile (new reader profile page, in the Kenlibs nav) and the
  admin /profile, a one-time "Sign in faster with your fingerprint next
  time" prompt after a password sign-in. The WebAuthn library loads only
  when a passkey is used.
- Needs Node 20+ (engines; server.js exits with a clear message; on Render
  set NODE_VERSION if needed).

**Brute-force limits on the password endpoints**
middleware/authRateLimits.js (separate from the passkey limits), limits
from env with safe defaults (backend/.env.example):
- POST /api/auth/login: failed attempts only, 10 per 15 min per IP + email
  (a successful login resets it, other people's failures never count) and
  100 per 15 min per IP across all emails.
- POST /api/auth/forgot-password: 20/hour per IP (429) and 5/hour per email
  (same generic 200 reply, no email sent).
- POST /api/auth/register: 10/hour per IP. POST /api/auth/reset-password/:token:
  20/hour per IP.
- 429 { code: "rate_limited", retryAfterSeconds, message: "Too many
  attempts. Please wait N minutes and try again." }, shown inline on both
  login pages and both forgot-password pages; never says whether an
  account exists. Successful responses unchanged. In memory, per process.

**Storefront redesign (brand flier)**
Reference: design-ref/Gemini_Generated_Image_.jpg (the phone screen in the
launch flier). Reader-facing pages use a dark green (forest tokens in
index.css) for the header bar (KenlibsNav, the reader's own header via
ViewBook headerTheme="brand", the footer); admin keeps navy. The home page
(/kenlibs) opens with a full-width green hero: inline SVG leaves (no
photo), the serif headline "Discover Great Books on Kenlibs" (Fraunces
Soft, the only preloaded font) with "Kenlibs" in orange, "Read anytime,
anywhere." in Nunito, and a white pill search that filters the loaded
books by title or author on the client. Phones then show Featured as two
upright covers per row (first 4); tablet and desktop keep the fanned
Featured row and the existing desktop navigation. Phones get a bottom tab
bar (Home, Library = /kenlibs/my-books, Profile = /kenlibs/profile) on storefront
and account pages only, never on the reader, checkout, sign-in pages or
admin; the page reserves its height (plus the safe-area inset) and the
WhatsApp button sits above it. Fonts are self-hosted (src/fonts.css,
@fontsource-variable packages), no Google Fonts request. Reduced-motion
preferences are respected app-wide.

**Library page and cross-device reading progress**
/kenlibs/my-books (the "Library" tab) loads everything in one request,
GET /api/kenlibs/library (metadata only, the signed-in reader's own data):
purchase requests with their status, owned books (approved book or book in
an approved bundle) with progress, audiobook availability, translation
languages and highlight/note/bookmark counts, and a summary (books owned,
finished, store credit). The page shows a "Continue reading" card, a
"Needs attention" list (rejected with the admin's reason, resubmit and
support; revoked), and a searchable, filterable (All, Reading, Not
started, Finished, Pending), sortable cover grid. Pending items are visible
but can't be opened. Signed-out visitors see a sign-in prompt.
Reading progress was already stored per reader and book (ReaderProgress);
it now also records the chapter id, how far down the chapter the reader
is (0–1) and when their device recorded it. Saves are validated,
rate-limited (240 per 10 minutes per reader) and merged across devices
"latest wins". The reader keeps a local copy as the offline fallback,
opens at the newer of the two, scrolls back to the saved spot, and saves on
chapter change, after a pause in scrolling and when the page is left.

**Dark mode**
Readers choose Light, Dark or System (default; follows the device and
changes with it) on their Profile page (Appearance) or with the sun/moon
button in the Kenlibs nav, phone header and mobile menu. The choice is
kept per browser (localStorage) and applies to every reader-facing page,
the reader included. Admin pages are never themed: the dark attribute is
only set on /, /kenlibs/* and /read/* (admin screenshots are pixel-identical
with a dark preference). A small inline script in index.html applies the
theme before the first paint, so there is no white flash, and sets the
browser bar colour (green header; deeper green in dark) and color-scheme
(native controls, scrollbars). The installed app's theme and splash colour
are now the brand green.
Palette (dark): page #171412, cards #221e1b, text #f3efe9 (16:1), muted
#a8a097 (6.4–7.1:1), placeholder/icons #8f877e (4.7:1), orange text #f08f58
(6.9–7.7:1), orange buttons #b8502a with white text (5.0:1; 3.3:1+ against
the page as a control colour), status chips on dark tints 8.4–11.8:1,
highlight colours re-tuned so text on them stays 7.2:1+. Chapter images are
dimmed slightly in dark mode; covers never are.
Light mode on reader pages now meets AA as well (same scoping: reader pages
carry data-theme="light", admin none): muted gray-500 #5f6672 (5.25:1 on
cream), gray-400 notes #656c78 (4.8:1), orange #b34d28 for text and buttons
(4.75:1 on cream, white on it 5.24:1), "Owned" badge #047857 (5.48:1). The
logo keeps the exact brand orange. An automated audit of every visible
text element on the reader pages finds no AA failures in either theme.
The audiobook seek bar is a themed native range slider (keyboard and
screen-reader support kept, 44px touch height).
Unknown URLs show a branded, themed 404 page ("Page not found", Search
books / Home); theme rules treat every non-admin path as reader-facing.

---

## 9. Open decisions worth confirming before Step 23

- Should a **rejected** request let the reader resubmit (new evidence) without
  creating a whole new request, or is a fresh request each time fine?
- Bundles: can a book belong to multiple bundles simultaneously, or is each book
  exclusive to one bundle? (Recommend: multiple is fine, simpler data model, no
  real downside.)
- Do you want **email notification** on approval/rejection (would need an email
  service, e.g. Resend/SendGrid — a real new dependency), or is checking
  `/kenlibs/my-books` manually acceptable for now? (Recommend: skip email for v1,
  add later if it becomes a real friction point.)