# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

AI eBook Creator: a full-stack app for generating, editing, and exporting eBooks. Users create a book, generate a chapter outline and chapter content via Gemini, edit chapters in a markdown editor, and export the finished book as PDF or DOCX.

Two independent apps, no shared code or monorepo tooling:
- `backend/` — Node/Express + MongoDB (Mongoose) REST API, CommonJS.
- `frontend/` — React 19 + Vite + Tailwind v4 SPA, ES modules.

## Commands

Run each app from its own directory (`backend/` or `frontend/`) — there is no root package.json.

**Backend** (`backend/`):
- `npm run dev` — start with nodemon (auto-reload)
- `npm start` — start with node
- No test suite and no lint script configured.

**Frontend** (`frontend/`):
- `npm run dev` — start Vite dev server
- `npm run build` — production build
- `npm run lint` — ESLint (flat config, `eslint.config.js`)
- `npm run preview` — preview a production build
- No test suite configured.

## Environment

Backend expects a `.env` file in `backend/` (gitignored) with at least: `PORT` (8000 in dev), `MONGO_URI`, `JWT_SECRET`, `GEMINI_API_KEY`.

The frontend's API base URL is **hardcoded** in `frontend/src/utils/apiPaths.js` (`BASE_URL`), not read from a Vite env var — it must be kept in sync with the backend's actual port/URL manually, including for production.

## Architecture

### Backend (`backend/`)

Standard Express MVC-ish layering: `routes/` → `controller/` → `models/`, with `middleware/` for cross-cutting concerns. `server.js` wires everything together and mounts routers under `/api/auth`, `/api/books`, `/api/ai`, `/api/export`.

- **Auth**: JWT-based. `middleware/authMiddleware.js`'s `protect` reads a `Bearer` token, verifies it, and attaches `req.user` (password excluded). Every books/ai/export route is protected; ownership is enforced in each controller by comparing `book.userId` to `req.user._id`, not by middleware.
- **Data model** (`models/Book.js`): a `Book` embeds its `chapters` as a subdocument array (title/description/content) rather than a separate collection — chapters are always loaded/saved with their parent book. `models/User.js` hashes passwords via a `pre('save')` hook and exposes `matchPassword`.
- **AI generation** (`controller/aiController.js`): uses `@google/genai` (Gemini, model `gemini-2.5-flash`) with large hand-tuned prompts to (1) generate a JSON chapter outline and (2) generate markdown content for a single chapter. Outline responses are parsed by locating the first `[` and last `]` in the raw text — the prompt format must keep producing a bare JSON array for this to keep working.
- **File uploads** (`middleware/uploadMiddleware.js`): Multer disk storage into `backend/uploads/`, single field `coverImage`, 3MB limit, image mimetypes only. `backend/uploads/` is also served statically at `/uploads`. Cover image paths are stored on the `Book` doc as `/uploads/<filename>`.
- **Export** (`controller/exportController.js`): the largest/most intricate file. Two independent hand-rolled markdown-to-document renderers share the same `markdown-it` token stream but are otherwise separate implementations:
  - `exportAsDocument` walks markdown-it tokens into `docx` `Paragraph`/`TextRun` trees (headings, lists, blockquotes, code blocks, inline bold/italic) and streams a `.docx` via `Packer.toBuffer`.
  - `exportAsPDF` walks the same token stream directly into a `pdfkit` `PDFDocument` (manual cursor/`moveDown` layout), and separately strips markdown to plain text for the DOCX chapter body (note: DOCX chapter *body* text uses a simpler regex-strip approach, not the token walker, while headings/title page do use rich formatting).
  - Both embed the book's cover image from disk (resolved from the `coverImage` DB path) if present and not a placeholder (`pravatar`) URL.
  - When modifying markdown rendering, changes generally need to be made in both places to keep PDF/DOCX output consistent.

### Frontend (`frontend/src/`)

- **Routing** (`App.jsx`): `react-router-dom` v7, flat `Routes`. Public: `/`, `/login`, `/signup`. Protected (wrapped in `components/auth/ProtectedRoute.jsx`): `/dashboard`, `/profile`, `/editor/:bookId`, `/view-book/:bookId`.
- **Auth state** (`context/AuthContext.jsx`): custom context (`useAuth`), not a library — token/user persisted in `localStorage` (`token`, `user`), consulted synchronously at mount. `logout()` hard-redirects via `window.location.href`.
- **API layer** (`utils/apiPaths.js` + `utils/axiosInstance.js`): all endpoint paths centralized in `API_PATHS`; a single shared `axiosInstance` attaches the bearer token from `localStorage` on every request via an interceptor. Always add new endpoints to `API_PATHS` rather than inlining URL strings.
- **Editor** (`pages/EditorPage.jsx` + `components/editor/*`): the core workflow screen. Holds the whole `book` object (including all chapters) in local state, mutates it locally, and calls `PUT /api/books/:id` to persist — there's no autosave/debounce, saves are explicit ("Save" button) or triggered right after AI content generation (`handleSaveChanges(updatedBook, false)`). Chapter reordering uses `@dnd-kit` (`arrayMove`). Chapter markdown editing uses `@uiw/react-md-editor` (`SimpleMDEditor.jsx`). Export buttons hit `/api/export/:id/pdf|doc` with `responseType: "blob"` and trigger a client-side download.
- **Styling**: Tailwind v4 via `@tailwindcss/vite` plugin (no `tailwind.config.js` — v4 uses CSS-based config in `index.css`). Icons via `lucide-react`. Toasts via `react-hot-toast`, mounted once in `main.jsx`.

### Cross-cutting notes

- CORS is wide open (`origin: '*'`) in `server.js` — tighten before any real deployment.
- `express.json()` is registered twice in `server.js` (once with a 50mb limit, once default); harmless but redundant if touching that file.
- There's no shared types/schema between frontend and backend — chapter/book shapes are duplicated implicitly (Mongoose schema vs. JS object literals in React state). Keep them in sync by hand when changing the `Book`/chapter shape.
