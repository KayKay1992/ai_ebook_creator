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
```

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
/kenlibs/book/:id       book detail page (price, blurb, back cover, "Request to Buy")
/kenlibs/bundle/:id     bundle detail page
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
/kenlibs/read/:bookId           gated reading view (server-verifies access)
```

### New — admin only
```
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
3. Click "Request to Buy" → if not logged in, prompted to sign up/log in first
   (lightweight — just the standard register/login form, `role: reader` by default)
4. On the checkout page: see the price, your own payment instructions (bank
   details — static content you control, not built by the app), upload a
   screenshot/evidence of the transfer, submit
5. Land on `/kenlibs/my-books` — see the request as "Pending"
6. (You, the admin, review and approve/reject via `/admin/purchases`)
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

**Step 34 — Storefront search + Open Graph tags (DONE, split into two parts)**
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
  built as a follow-up (see "OG crawler route" below).

**OG crawler route (DONE, follow-up to Step 34 Part 2)**
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

**Step 35 — Completion badge/certificate (DONE)**
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

**Step 36 — Word explanation popup (scoped, not yet sent)**
Select/tap a word in the reader → popup definition. Primary: free Dictionary
API (api.dictionaryapi.dev), no backend change. Fallback for dictionary
misses (proper nouns, invented terms): explicit "Explain in context" button
calling a new backend endpoint (reusing existing AI auth/rate-limit pattern)
that sends the word + surrounding sentence to Gemini. AI fallback is
opt-in-per-lookup only, never automatic, to control cost.

**Step 37 — Multi-language translation, Nigerian languages first (scoped, not
yet sent)**
Decision made: start with Yoruba/Igbo/Hausa (confirmed supported by Google
Cloud Translation API, along with Fulani/Kanuri/Tiv) over global languages,
matching the core audience. Known tradeoff: machine translation quality for
these languages is real but meaningfully behind major global languages —
reader-facing UI must set honest expectations ("Machine-translated — quality
may vary"), not present it as equivalent to the original.
Architecture: translations are pre-generated and stored per book+language
(new BookTranslation model: book, language, chapters[], status), NEVER
translated live per-read — full-book translation cost must not scale with
readership. Admin-triggered per book via a new admin-only endpoint
(POST /api/admin/books/:id/translate/:language), not automatic on publish.
Reader gets a language picker on KenlibsReadPage when translations exist;
resume position (ReaderProgress) applies globally per book, not per
language, for v1. Requires a GCP project + Translation API credentials —
not yet set up, needed before this step can start.

**Step 38 — Design revisit of Step 31 (deferred, not scheduled)**
Reader-facing motion/visual design pass was committed but explicitly flagged
as not meeting the bar wanted ("physical outlook... so so poor"). Revisit
scope not yet defined — needs a concrete comparison pass (e.g. against the
Kotobee reference used earlier) to identify specific gaps rather than a
vague "make it better" re-run.

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