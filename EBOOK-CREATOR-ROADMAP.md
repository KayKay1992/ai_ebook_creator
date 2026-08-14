# AI eBook Creator — Execution Roadmap

**How to use this file:**

1. Save this file at the root of your project (`ai_ebook_creator/EBOOK-CREATOR-ROADMAP.md`) alongside `CLAUDE.md`.
2. Open Claude Code in the project root.
3. Copy the **Execution Prompt** block for Step 1 and paste it in as your message.
4. Let Claude Code implement it, then run through the **Test checklist** yourself.
5. If it passes: commit using the suggested message, then reply **`next`** to move to Step 2's prompt.
6. If something's off: tell Claude Code what's wrong in plain language before moving on — don't skip ahead with a broken step, since later steps assume earlier ones work.

Each step is self-contained — it names exact files and doesn't assume Claude Code remembers earlier conversation, so these also work fine as fresh sessions if you clear context between steps.

16 steps total, in 4 phases. Do not skip Phase 1 — everything after it assumes a stable base.

---

## PHASE 1 — STABILIZE

### Step 1 — Fix known bugs (reader highlight, import casing, upload limit mismatch)

**Execution Prompt:**
```
Fix three specific bugs in this codebase. Read the relevant files first, don't guess.

1. Reader sidebar highlight bug: somewhere the active-chapter index is passed from
   ViewBook.jsx to ViewChapterSidebar.jsx under a mismatched prop name (one side is
   missing "ed", e.g. passed as "selectChapterIndex" but destructured as
   "selectedChapterIndex", or vice versa). Find the mismatch and fix the CALL SITE
   (ViewBook.jsx) to match whatever ViewChapterSidebar.jsx actually destructures —
   don't change the destructuring unless you find it's the one that's wrong after
   checking how it's used elsewhere.

2. Import casing bug: find the actual filename of the InputField component under
   frontend/src/components/ui/ (check exact case on disk). Grep every import of it
   across frontend/src and fix any that don't match the exact case of the real
   filename. This currently works locally (case-insensitive filesystem) but will
   break the production build on case-sensitive deploy targets.

3. Upload limit mismatch: backend/middleware/uploadMiddleware.js sets a Multer
   fileSize limit of 3MB, but frontend/src/components/editor/BookDetailsTab.jsx
   tells users the max is 5MB. Change the Multer limit to 5MB (5 * 1024 * 1024) so
   it matches what users are told. Confirm the Multer error handler returns a clean
   JSON error (not a raw stack trace) when the limit is exceeded, and that the
   frontend shows that error via the existing react-hot-toast pattern.

After each fix, tell me exactly which files you changed and why.
```

**Test checklist:**
- [ ] Open a book with 3+ chapters in the reader (`/view-book/:id`), click each chapter in the sidebar, confirm the highlighted chapter matches the one you clicked
- [ ] Run `npm run build` in `frontend/` — should succeed with no case-related module resolution errors
- [ ] Try uploading a cover image between 3-5MB — should succeed; try one over 5MB — should show a clean toast error, not a crash

**Commit message:** `fix: correct selectedChapterIndex prop name, InputField import casing, upload limit mismatch`

---

### Step 2 — Autosave with save-state indicator

**Execution Prompt:**
```
Add debounced autosave to the editor in frontend/src/pages/EditorPage.jsx. Currently
saves only happen via an explicit "Save" button or silently right after AI content
generation — there's no autosave, so closing a tab loses unsaved work with no warning.

1. Add local state: const [saveStatus, setSaveStatus] = useState('saved') with
   possible values 'saved' | 'saving' | 'unsaved' | 'error'.

2. Wherever chapter content/title/description is mutated in local state (the
   markdown editor's onChange, any title/description inputs), after updating state:
   - immediately set saveStatus to 'unsaved'
   - debounce a save by 2.5 seconds using a useRef-held timer (clearTimeout on
     every new edit, standard debounce — don't add a new npm dependency for this)
   - when the debounce fires: set saveStatus to 'saving', call the existing
     handleSaveChanges(updatedBook, false) function, set 'saved' on success or
     'error' + a toast on failure

3. The existing explicit "Save" button should flush any pending debounce timer and
   save immediately when clicked, same as before.

4. Add a small, unobtrusive save-state indicator near the Save button in the editor
   header: a subtle checkmark + "Saved" when saved, small spinner + "Saving…" while
   saving, a dot + "Unsaved changes" when unsaved, red text + "Couldn't save" on
   error (in addition to the toast). Style it to match the existing Tailwind
   conventions already used in the editor header — don't introduce a new visual
   language for this one element.

5. Add a beforeunload guard: register a 'beforeunload' event listener in a useEffect
   that calls e.preventDefault() and sets e.returnValue = '' whenever saveStatus is
   'unsaved' or 'saving'. Clean up the listener properly and re-register whenever
   saveStatus changes.

Show me the diff when done.
```

**Test checklist:**
- [ ] Type in the markdown editor — indicator flips to "Unsaved changes" within a keystroke
- [ ] Stop typing — after ~2.5s indicator shows "Saving…" then "Saved"
- [ ] While unsaved, try to close/refresh the tab — browser shows a native "leave site?" confirmation
- [ ] Click "Save" manually mid-typing — saves immediately, indicator updates without waiting for the debounce

**Commit message:** `feat: add debounced autosave with save-state indicator and unload guard`

---

### Step 3 — Backend hardening (CORS, rate limiting, error handling, cleanup)

**Execution Prompt:**
```
Harden backend/server.js and backend/controller/authController.js. Do these in order:

1. CORS: replace the current wide-open cors({ origin: '*' }) in server.js with an
   explicit allowed-origins config read from a new FRONTEND_URL env var (default to
   http://localhost:5173 if unset for local dev). Add FRONTEND_URL to the list of
   required env vars documented in CLAUDE.md.

2. Rate limiting: install express-rate-limit (npm install express-rate-limit in
   backend/). Apply a limiter to both POST /generate-outline and
   POST /generate-chapter-content in backend/routes/aiRoute.js, keyed per-user via
   req.user._id (not raw IP — these routes are already behind the `protect`
   middleware so req.user exists). Start with 20 requests per user per hour as a
   named constant. On limit exceeded, return a clean JSON 429:
   { message: "Rate limit exceeded, try again later." }

3. Error handling: in backend/controller/authController.js, wrap getProfile and
   updateUserProfile in try/catch matching the exact error-response shape already
   used elsewhere in the same file (check loginUser/registerUser for the pattern).

4. Remove the debug leftover in registerUser's catch block that exposes
   error.message directly to the client (there's a "// temporary – remove later"
   comment marking it). Replace with a generic client-facing message like
   "Registration failed. Please try again." and console.error(error) server-side
   instead. Remove the stale comment.

5. Remove the duplicate express.json() registration in server.js — keep only the
   one with the 50mb limit (needed for AI-generated chapter content), and remove
   the stray "// ← Add this" comment near it.

Show me each changed file.
```

**Test checklist:**
- [ ] Confirm `FRONTEND_URL` is set in `backend/.env`, restart backend, confirm frontend still talks to it fine
- [ ] Call `/api/ai/generate-outline` more than 20 times in an hour as one user — 21st request returns 429 with the clean message
- [ ] Trigger a profile fetch/update failure (e.g. temporarily break the DB connection) — confirm it returns a proper error response, not an unhandled crash
- [ ] Register with a duplicate email — confirm the error message shown to the user is generic, not a raw Mongoose error string

**Commit message:** `chore: harden backend — restrict CORS, add AI rate limiting, fix error handling, cleanup`

---

### Step 4 — DOCX export consistency fix

**Execution Prompt:**
```
Fix an inconsistency in backend/controller/exportController.js's DOCX export path.

Context: the file has a markdown-it token walker (used for headings, title page,
lists, blockquotes, code blocks, inline bold/italic) that renders rich docx
Paragraph/TextRun trees. But the chapter BODY text in exportAsDocument currently
goes through a separate, simpler regex-based markdown stripper instead of that same
token walker — so headings/bold/lists inside chapter content get flattened to plain
paragraphs in the exported .docx, even though the code to render them richly
already exists and is used elsewhere in the same document.

1. Find where exportAsDocument builds each chapter's body content and replace the
   regex-strip call with the existing token-walking function used for the rest of
   the document.
2. Make sure heading levels inside chapter body markdown map sensibly into the
   document's heading hierarchy — don't let a chapter's internal "## Section" H2
   outrank the book title or chapter title. Chapter-body headings should render at
   a level below the chapter title heading.
3. Do NOT touch exportAsPDF — it already uses the token walker correctly for both
   title page and chapter body content per the project's existing notes.
4. After the change, actually generate a test export and visually verify it —
   don't just trust the code. Create a small test book (or use an existing one)
   with a chapter whose markdown content includes a ## heading, **bold** text, and
   a bulleted list, export it as DOCX, and convert it to images to inspect:
     soffice --headless --convert-to pdf test-export.docx
     pdftoppm -jpeg -r 100 test-export.pdf page
   Then look at the resulting page images and confirm real Word formatting shows
   up (heading style, bold run, actual bullet list) rather than flat paragraphs.
```

**Test checklist:**
- [ ] Export a book whose chapter content has a heading, bold text, and a list — confirm all three render as real Word formatting in the `.docx`, not plain paragraphs
- [ ] Confirm PDF export output is unchanged from before this step
- [ ] Confirm heading hierarchy still looks sensible (book title > chapter title > in-chapter headings)

**Commit message:** `fix: route DOCX chapter body through markdown token walker for consistent formatting`

---

## PHASE 2 — DESIGN SYSTEM FOUNDATION

### Step 5 — Establish real Tailwind v4 theme tokens

**Execution Prompt:**
```
This project uses Tailwind v4's CSS-based config (no tailwind.config.js — theme
lives in an @theme block in frontend/src/index.css). Right now the accent color is
hardcoded as violet-600/purple-600 utility classes scattered across components
rather than a real theme token, and a --font-display token exists but a second
"primary" color token defined in @theme is unused (the real accent used everywhere
is the hardcoded violet).

1. In index.css's @theme block, define a proper set of semantic color tokens for
   this app, e.g.:
     --color-accent, --color-accent-hover, --color-accent-muted
     --color-surface, --color-surface-warm (for editor/reader paper-tone backgrounds)
     --color-ink (primary text), --color-ink-muted (secondary text)
   Pick ONE deliberate accent color (you can keep it close to the current violet if
   you like the existing brand, or propose an alternative — tell me which you chose
   and why). Remove the currently-unused --primary token or repurpose it as the
   real accent token instead of leaving two conflicting definitions.

2. Grep the whole frontend/src for hardcoded violet-600/purple-600/etc utility
   classes used for brand/accent purposes (buttons, active nav states, icon
   backgrounds, focus rings) and replace them with the new token-based classes
   (e.g. bg-accent, text-accent, border-accent) so there's one source of truth.
   Leave semantic colors alone (emerald for success, red for errors, gray neutrals)
   — only consolidate the brand/accent color.

3. Check frontend/src/index.css for the Poppins/Urbanist @import statements that
   are currently unused (only Inter is wired to --font-display). Either remove
   those imports entirely if you're not going to use them, or tell me and hold off
   — Step 6 will decide what to do with typography, so don't silently drop them if
   Step 6 might want them.

Show me the updated @theme block and a summary of which components you touched.
```

**Test checklist:**
- [ ] Run the app — visually confirm nothing looks broken (buttons, active states, icon backgrounds still styled)
- [ ] Grep for `violet-` and `purple-` in `frontend/src` — should return zero brand-related hits outside the new token definitions
- [ ] `npm run lint` passes with no new errors

**Commit message:** `refactor: consolidate hardcoded accent colors into Tailwind v4 theme tokens`

---

### Step 6 — Typography pairing (serif headings + sans UI)

**Execution Prompt:**
```
This is a writing/publishing tool — typography should be the visual anchor, not an
afterthought. Currently only Inter is wired up as --font-display; Poppins and
Urbanist are imported but unused.

1. Choose and wire in a serif typeface suited to book titles, chapter headings, and
   cover previews — something like Fraunces, Newsreader, or Lora (pick one, or ask
   me if you want my input first). Add it via Google Fonts @import in index.css
   alongside the existing Inter import, and define a new --font-serif token in the
   @theme block.

2. Remove the unused Poppins/Urbanist imports if you didn't already resolve this in
   Step 5.

3. Apply --font-serif deliberately and consistently to: book titles on the
   dashboard cards, the book title/subtitle on the cover preview and title page in
   exports (mention if export font also needs updating — that's
   backend/controller/exportController.js's PDF title page, flag it separately,
   don't change backend files in this step), chapter titles in the editor sidebar
   and reader, and the landing page hero headline. Keep Inter (--font-display) for
   all UI chrome — buttons, nav, form labels, body copy, dashboard metadata.

4. Show me a short list of every component you changed so I can review the visual
   result.
```

**Test checklist:**
- [ ] Dashboard book titles, editor chapter titles, and reader chapter titles visibly use the new serif font
- [ ] All buttons, nav, and form UI still use Inter — no serif bleeding into UI chrome
- [ ] Landing page hero headline uses the serif font and looks intentional, not broken

**Commit message:** `feat: add serif typography for book titles and headings, remove unused font imports`

---

### Step 7 — Unify loading states

**Execution Prompt:**
```
Loading states are inconsistent across the app. DashboardPage and ViewBookPage have
proper skeleton components (BookCardSkeleton, ViewBookSkeleton), but
ProtectedRoute.jsx shows a bare unstyled <h1>Loading...</h1>, and the Editor and
Profile pages use a plain spinning-border div instead of a skeleton.

1. Look at the existing BookCardSkeleton and ViewBookSkeleton implementations as
   the reference pattern (styling, shimmer/pulse animation if any, layout
   approach).
2. Replace the bare <h1>Loading...</h1> in components/auth/ProtectedRoute.jsx with
   a properly styled loading state consistent with the rest of the app (a centered
   branded spinner or skeleton is fine here since there's no layout to skeleton-match
   yet at that point in the auth check).
3. Replace the plain spinning-border divs in EditorPage.jsx and ProfilePage.jsx
   with skeleton components that roughly match each page's actual layout (e.g. an
   EditorSkeleton showing placeholder sidebar + editor pane shapes, a
   ProfileSkeleton showing placeholder form fields) — build new skeleton components
   following the same pattern as the existing ones rather than reusing
   BookCardSkeleton/ViewBookSkeleton where the layout doesn't match.
4. Keep all skeletons in a consistent location, e.g. alongside their existing
   siblings (components/cards/, components/view/) or a new components/skeletons/
   folder if that's cleaner — your call, just be consistent.
```

**Test checklist:**
- [ ] Throttle network (browser devtools) and reload `/dashboard`, `/editor/:id`, `/profile`, and refresh while logged in (hits ProtectedRoute's loading state) — every loading state now looks intentional and on-brand, no bare text or generic spinners
- [ ] Skeletons roughly match the shape of the real content that replaces them

**Commit message:** `feat: unify loading states with consistent skeleton components`

---

### Step 8 — Restyle the reader for a "book" feel

**Execution Prompt:**
```
The reader (ViewBookPage.jsx, components/view/ViewBook.jsx,
components/view/ViewChapterSidebar.jsx) is the screen where "does this feel like a
real book" matters most, and it currently uses the same neutral gray/white
background as the rest of the app.

1. Give the reading pane (not the whole app, just this view) a warm, paper-toned
   background using the --color-surface-warm token from Step 5 (something like an
   off-white/cream tone, not stark white).
2. Constrain the reading column width to roughly 65-75 characters (use a max-width
   in ch units or an equivalent Tailwind max-w utility) so lines aren't
   uncomfortably long on wide screens — center the column.
3. Increase line-height and paragraph spacing in the chapter content rendering for
   a more comfortable long-form reading rhythm (check leading-relaxed or
   leading-loose equivalents, and space-y utilities between paragraphs).
4. Apply --font-serif (from Step 6) to chapter body text in the reader specifically
   — this is the one place body copy should be serif, since it's meant to read
   like a book page, not an app screen. Keep the sidebar/nav/controls in Inter.
5. Leave the existing font-size controls, sidebar, and prev/next navigation
   functionally as-is — this step is visual only, don't change behavior.
```

**Test checklist:**
- [ ] Open a book in the reader — background is warm/paper-toned, not stark white/gray
- [ ] Text column has a comfortable max width on a wide monitor, doesn't stretch edge-to-edge
- [ ] Chapter body text renders in the serif font with comfortable line spacing; sidebar/controls remain in the sans font
- [ ] Font-size controls, sidebar navigation, and prev/next still work exactly as before

**Commit message:** `feat: restyle reader with warm paper background, constrained column, serif body text`

---

## PHASE 3 — CORE FEATURE COMPLETION

### Step 9 — Consolidate the two markdown renderers

**Execution Prompt:**
```
There are two independent hand-rolled markdown renderers on the frontend that
should behave identically but don't: ChapterEditorTab.jsx's preview (handles
headers, bold, italic, blockquote, lists) and ViewBook.jsx's formatContent
(handles headers, bold, italic only). This means content can render differently in
the editor preview than in the actual reader.

1. Check what markdown rendering approach is already available — @uiw/react-md-editor
   likely already bundles a markdown renderer/preview component. Prefer reusing that
   shared renderer in both places over maintaining two hand-rolled parsers.
2. Extract a single shared MarkdownContent component (e.g.
   components/shared/MarkdownContent.jsx) that both ChapterEditorTab's preview and
   ViewBook use, so formatting support (headers, bold, italic, blockquotes, lists,
   code blocks) is identical in both places by construction, not by manually
   keeping two implementations in sync.
3. Make sure the reader-specific styling from Step 8 (serif font, warm background,
   line-height) still applies correctly when ViewBook uses the shared component —
   the shared component should accept a className or similar so each consumer can
   layer its own container styling without forking the rendering logic itself.
4. Test both the editor preview and the reader with the same chapter content
   containing headers, bold, italic, a blockquote, and a list — confirm they now
   render identically.
```

**Test checklist:**
- [ ] Write a chapter with headers, bold, italic, a blockquote, and a bulleted list
- [ ] Compare the editor's preview pane and the actual reader view side by side — formatting matches exactly
- [ ] Reader retains its Step 8 styling (serif, warm background, spacing)

**Commit message:** `refactor: consolidate editor preview and reader onto a single shared markdown renderer`

---

### Step 10 — Streaming AI generation

**Execution Prompt:**
```
AI chapter content generation (backend/controller/aiController.js, using
@google/genai's gemini-2.5-flash) currently returns the full generated chapter in
one blocking response, so the frontend shows a spinner for several seconds with no
feedback. Switch this to streaming so generated text appears progressively.

1. Check the @google/genai SDK for its streaming generation method (likely
   something like generateContentStream) and update the chapter-content generation
   endpoint in aiController.js to use it.
2. Stream the response to the frontend using Server-Sent Events (SSE) — set the
   response headers appropriately (Content-Type: text/event-stream) and write each
   chunk as it arrives from Gemini, rather than buffering the full response before
   sending anything.
3. On the frontend, in ChapterEditorTab.jsx (or wherever the "generate chapter
   content" action is triggered), replace the blocking axios call for this specific
   endpoint with an EventSource-based or fetch-stream-based reader that appends
   incoming chunks into the markdown editor's content as they arrive, so the user
   watches the chapter get written in real time.
4. Keep the outline generation endpoint (generateOutline) as a normal blocking call
   for now — it's fast and returns structured JSON that's awkward to stream
   meaningfully; only chapter content generation needs streaming.
5. Handle the stream ending / erroring cleanly — make sure partial content isn't
   lost if the stream drops, and that the existing "Save" flow (or Step 2's
   autosave) picks up the fully-streamed content once generation completes.
6. Don't break the JSON-array-parsing approach used for outline generation — that's
   unrelated to this change.
```

**Test checklist:**
- [ ] Trigger chapter content generation — text visibly appears progressively in the editor instead of after one long wait
- [ ] Outline generation still works exactly as before (unchanged, blocking)
- [ ] Interrupt the stream (e.g. close the tab mid-generation) and confirm no server crash; reopening the chapter shows whatever was saved last
- [ ] Once streaming finishes, autosave (Step 2) or manual save correctly persists the full generated content

**Commit message:** `feat: stream AI chapter generation via SSE instead of blocking response`

---

### Step 11 — Per-chapter image upload

**Execution Prompt:**
```
The markdown editor (@uiw/react-md-editor via SimpleMDEditor.jsx) already includes
an image toolbar command, but there's no backend support for it — it currently only
supports pasting external image URLs, since there's no upload endpoint for
in-chapter images (only the single book cover image is actually uploadable today).

1. Backend: add a new authenticated route, e.g. POST /api/books/:bookId/chapters/:chapterId/image
   (or a simpler POST /api/upload/chapter-image if you'd rather keep it decoupled
   from a specific chapter — your call, but keep it consistent with existing route
   naming conventions in bookRoute.js). Reuse the existing Multer disk-storage
   pattern from uploadMiddleware.js (same size limit and image-mimetype
   restrictions as the cover upload, or slightly larger if reasonable for in-content
   images — use your judgment and tell me what you chose). Store uploaded images in
   backend/uploads/chapters/ (create the subfolder) to keep them separate from
   cover images, and serve them statically the same way /uploads already is.
   Return the resulting path so the frontend can insert it into the markdown.
2. Frontend: wire the MDEditor's image toolbar command (or add a custom one if the
   default only supports URL insertion) to open a file picker, upload the selected
   file to the new endpoint, and insert the returned image path into the markdown
   content as a standard ![alt](path) image reference at the cursor position.
3. Confirm the reader (ViewBook via the shared MarkdownContent component from Step
   9) correctly renders inline images from chapter markdown, including resolving
   the relative /uploads/chapters/... path against the backend's base URL.
4. Add basic client-side validation (file type, rough size) before upload with a
   toast on failure, matching the pattern used for cover image upload.
```

**Test checklist:**
- [ ] In the chapter editor, use the image toolbar command, select a local image file, confirm it uploads and inserts into the markdown
- [ ] Save the chapter, reload the editor — image still renders correctly in the preview
- [ ] Open the same book in the reader — the in-chapter image renders correctly there too
- [ ] Try uploading a non-image file — clean toast error, not a crash

**Commit message:** `feat: add per-chapter image upload support`

---

### Step 12 — EPUB export

**Execution Prompt:**
```
Add EPUB as a third export format alongside the existing PDF and DOCX exports in
backend/controller/exportController.js — this is the actual industry-standard
ebook format (Kindle/Apple Books/Kobo) and its absence is a real gap for a product
called an "ebook creator."

1. Add a suitable EPUB-generation npm package to backend/ (e.g. epub-gen or a
   similar actively-maintained library — check what's available and pick a
   reasonable one, tell me which you chose and why).
2. Add a new exportAsEPUB controller function following the same structure as the
   existing exportAsPDF/exportAsDocument functions: pull the book and its chapters,
   embed the cover image the same way the other two formats do (resolved from the
   coverImage DB path, skipping placeholder/pravatar URLs same as existing logic),
   and generate a properly structured EPUB with a table of contents, one section
   per chapter, and the book's title/author metadata set correctly.
3. For chapter content, convert the markdown to HTML for the EPUB (most EPUB
   libraries expect HTML chapter content) — reuse markdown-it, which is already a
   dependency, rather than adding a second markdown parser.
4. Add a new route in backend/routes/exportRoute.js (e.g. GET /api/export/:id/epub)
   protected the same way as the existing export routes, with the same ownership
   check pattern (book.userId vs req.user._id) as the rest of the export
   controller.
5. Add EPUB to API_PATHS in frontend/src/utils/apiPaths.js and add a third export
   option to whatever UI currently offers "Export as PDF / Export as DOCX" in the
   editor, using the same blob-download pattern already used for the other two
   formats.
6. Verify the output by actually opening the generated .epub in a reader or
   validator, not just trusting it was created — e.g. check it opens in Apple
   Books/calibre if available, or at minimum unzip it and confirm the structure
   (mimetype, META-INF, OEBPS/content) looks like a valid EPUB.
```

**Test checklist:**
- [ ] Export a book as EPUB from the editor — file downloads successfully
- [ ] Open the `.epub` in any reader app (Apple Books, calibre, or an online EPUB validator) — cover, title/author, and all chapters with correct formatting appear
- [ ] Table of contents navigation inside the EPUB reader works and matches chapter order
- [ ] PDF and DOCX export still work unchanged

**Commit message:** `feat: add EPUB export alongside existing PDF/DOCX`

---

### Step 13 — PWA (installable app + offline reading)

**Execution Prompt:**
```
Turn the frontend into a installable Progressive Web App with offline support for
the reader specifically — this lets users install the app to their home
screen/desktop and read previously-opened books without a network connection,
which is a meaningful feature for an ebook product.

1. Install and configure vite-plugin-pwa in frontend/ (npm install -D vite-plugin-pwa),
   add it to frontend/vite.config.js alongside the existing react() and
   tailwindcss() plugins.
2. Create a web app manifest (via the plugin's manifest config option, or a
   standalone manifest.webmanifest if you prefer) with: app name, short name, theme
   color matching the new --color-accent token from Step 5, background color
   matching --color-surface, and icons (generate or reference simple placeholder
   icons at 192x192 and 512x512 if no branded icon assets exist yet — tell me if
   you need real icon assets from me instead of a placeholder).
3. Configure a service worker via the plugin (use its generateSW / Workbox-based
   strategy rather than hand-rolling one) with these caching rules:
   - Cache the app shell (JS/CSS/HTML) with a stale-while-revalidate or precache
     strategy so the app itself loads offline.
   - Cache API responses for GET /api/books and GET /api/books/:id (the read paths
     used by the dashboard and reader) with a network-first, falling back to cache
     strategy — so a previously-viewed book is readable offline, but always prefers
     fresh data when online.
   - Cache uploaded cover/chapter images (/uploads/**) with a cache-first strategy
     since they rarely change once uploaded.
   - Do NOT cache POST/PUT/DELETE requests, auth endpoints, or AI generation
     endpoints — those must always require network and should not have stale/cached
     behavior.
4. Add a simple "you're offline" indicator somewhere unobtrusive in the app shell
   (e.g. a small banner) using the browser's online/offline events, so users
   understand why editing/AI features are unavailable when offline versus assuming
   the app is broken.
5. Confirm the editor and any write operations behave sensibly offline — they
   don't need to work offline (that's a much bigger feature, out of scope here),
   but they should fail gracefully with a clear "you're offline" message rather
   than a confusing network error, reusing the offline indicator/state from step 4.
6. Test installability: build for production (npm run build && npm run preview),
   open in Chrome, confirm the browser offers an "Install app" prompt, and confirm
   the app opens in its own window when installed.
```

**Test checklist:**
- [ ] `npm run build && npm run preview`, open in Chrome — browser shows an install prompt; installing opens the app standalone
- [ ] After visiting a book in the reader once while online, go offline (devtools network throttling → offline) and reopen that same book — it still loads and is readable
- [ ] Dashboard still shows previously-loaded books when offline
- [ ] Try to save an edit or generate AI content while offline — clean "you're offline" messaging, not a confusing raw network error
- [ ] Go back online — app resumes normal behavior, offline banner disappears

**Commit message:** `feat: add PWA support with offline reading for previously-viewed books`

---

## PHASE 4 — DIFFERENTIATORS

### Step 14 — Export design templates

**Execution Prompt:**
```
Export styling in backend/controller/exportController.js is currently hardcoded —
every book exports with the same fonts, margins, and heading styles regardless of
genre or preference. Add a small set of selectable design templates.

1. Define 3 starter templates as config objects (not database-driven yet, keep it
   simple) in a new backend/config/exportTemplates.js — e.g. "Classic" (serif body,
   traditional margins), "Modern" (sans body, tighter spacing, minimal chapter
   headers), "Manuscript" (double-spaced, courier/monospace-adjacent, standard
   manuscript format conventions). Each template defines: body font choice, heading
   font/size scale, page margins, and chapter-heading style (e.g. centered vs
   left-aligned, presence of a decorative rule).
2. Add a templateId field to the Book schema (models/Book.js) defaulting to
   "classic".
3. Update exportAsPDF and exportAsDocument to read the book's templateId and apply
   the corresponding template's font/margin/heading settings instead of the current
   hardcoded values, for both PDF (pdfkit) and DOCX (docx) generation paths.
4. Frontend: add a template picker (simple selectable cards, not a dropdown — this
   is a visual choice, show a small preview thumbnail or at least a labeled swatch
   for each) somewhere sensible, likely in BookDetailsTab.jsx near the export
   buttons or as a step before triggering export. Persist the choice via the
   existing PUT /api/books/:id update flow.
5. Verify each template actually looks visually distinct by generating a test
   export in each and visually inspecting per the docx skill's render-and-check
   pattern used in Step 4.
```

**Test checklist:**
- [ ] Export the same book under all 3 templates — each looks visibly distinct (fonts/margins/heading style)
- [ ] Template choice persists after saving and reopening the book
- [ ] Both PDF and DOCX respect the selected template

**Commit message:** `feat: add selectable export design templates (Classic, Modern, Manuscript)`

---

### Step 15 — Live book cover preview

**Execution Prompt:**
```
Replace the flat cover-image-only presentation with a live cover preview that
renders the book's actual title/author/subtitle text over the cover image (or a
generated placeholder background if no image is uploaded yet), both on the
dashboard book cards and in BookDetailsTab.jsx during editing.

1. Build a CoverPreview component (e.g. components/cards/CoverPreview.jsx) that
   takes title, subtitle, author, and coverImage as props and renders a book-cover
   shaped element (portrait aspect ratio, e.g. 2:3) with the title/author text
   overlaid using --font-serif from Step 6, styled to look like real cover
   typography (appropriate contrast/shadow against the background image so text
   stays legible over any photo).
2. If no coverImage is set, render a tasteful placeholder background (a gradient
   using --color-accent, or a simple abstract pattern) rather than a blank gray box,
   so books without an uploaded cover still look intentional.
3. Use this component on BookCard.jsx (replacing the current flat thumbnail) with a
   subtle hover tilt/shadow effect for a "physical book" feel — keep it tasteful
   and performant (CSS transform, not a heavy animation library).
4. Use the same component live in BookDetailsTab.jsx so users see the actual cover
   update in real time as they edit title/subtitle/author or upload a new cover
   image, before saving.
5. Keep this purely visual/frontend — no backend changes needed, since title/
   subtitle/author/coverImage already exist on the Book model.
```

**Test checklist:**
- [ ] Dashboard book cards now show title/author text rendered over the cover image, styled like a real book cover
- [ ] Books without an uploaded cover show a tasteful placeholder, not a blank box
- [ ] In BookDetailsTab, editing the title/subtitle/author updates the live cover preview immediately, before saving
- [ ] Hover effect on dashboard cards feels smooth, not janky

**Commit message:** `feat: add live book cover preview with rendered title/author typography`

---

### Step 16 — Publish flow with shareable read-only link

**Execution Prompt:**
```
The Book model already has a status field ('draft'/'published') but nothing in the
app ever changes it or does anything with it. Give it a real purpose: a public,
read-only share link for published books.

1. Backend: add a new unauthenticated route, e.g. GET /api/public/books/:shareId —
   this should NOT reuse the existing protected book routes. Add a shareId field to
   the Book schema (a short random string, generated when a book is first
   published — use crypto.randomBytes or a small nanoid-style helper, don't use the
   Mongo _id directly as the public share identifier for basic obscurity). The
   public route returns only what's needed to render the read-only view (title,
   subtitle, author, coverImage, chapters) and must check status === 'published'
   before returning anything — return 404 for draft/unpublished books even if the
   shareId is somehow guessed.
2. Add a controller action to toggle a book's status between draft/published
   (generating a shareId the first time it's published if one doesn't exist yet),
   exposed via the existing protected book routes with the standard ownership check.
3. Frontend: add a "Publish" toggle/button in BookDetailsTab.jsx or the editor
   header. When published, show the resulting shareable URL (e.g.
   {frontendUrl}/read/{shareId}) with a copy-to-clipboard button.
4. Add a new public route in App.jsx, e.g. /read/:shareId, rendering a read-only
   view reusing as much of the existing reader (ViewBook.jsx / the shared
   MarkdownContent component from Step 9) as possible, but sourced from the new
   public API endpoint instead of the protected one, and NOT wrapped in
   ProtectedRoute since this must be accessible to logged-out visitors.
5. Make sure unpublishing a book immediately invalidates the share link (the public
   endpoint should stop returning data the moment status flips back to draft, per
   the status check in step 1 — no separate invalidation logic needed if that check
   is correct).
```

**Test checklist:**
- [ ] Publish a book — a shareable URL appears with a working copy button
- [ ] Open that URL in an incognito window (logged out) — book renders correctly in read-only view
- [ ] Unpublish the book — the same URL now returns a 404 / "not found" state instead of the book
- [ ] Try guessing/modifying a shareId for a draft book — confirm it correctly 404s

**Commit message:** `feat: add publish flow with shareable public read-only link`

---

## Quick reference — all 16 steps

| # | Step | Phase |
|---|------|-------|
| 1 | Fix known bugs (reader highlight, casing, upload limit) | Stabilize |
| 2 | Autosave + save-state indicator | Stabilize |
| 3 | Backend hardening (CORS, rate limit, error handling) | Stabilize |
| 4 | DOCX export consistency fix | Stabilize |
| 5 | Tailwind v4 theme tokens | Design |
| 6 | Serif/sans typography pairing | Design |
| 7 | Unified loading states | Design |
| 8 | Reader restyle (paper tone, reading column) | Design |
| 9 | Consolidate markdown renderers | Features |
| 10 | Streaming AI generation | Features |
| 11 | Per-chapter image upload | Features |
| 12 | EPUB export | Features |
| 13 | PWA + offline reading | Features |
| 14 | Export design templates | Differentiators |
| 15 | Live book cover preview | Differentiators |
| 16 | Publish flow + share link | Differentiators |

Say **`next`** after each commit to get the next step's prompt (they're all already written above — just tell me which number, or say `next` and I'll confirm which one we're on).
