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
