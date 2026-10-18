import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Award,
  Ban,
  BookOpen,
  Bookmark,
  CheckCircle2,
  Clock,
  Headphones,
  Highlighter,
  Languages,
  Library,
  MessageCircle,
  RefreshCw,
  Search,
  UploadCloud,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import { formatNaira } from "../utils/kenlibsPricing";
import { buildWhatsAppHref } from "../utils/kenlibsSupport";
import {
  FILTERS,
  SORTS,
  buildLibraryEntries,
  continueReadingEntry,
  loadLibraryPrefs,
  progressLabel,
  progressPercent,
  readerLink,
  readingState,
  saveLibraryPrefs,
  statusChip,
  visibleEntries,
} from "../utils/library";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import KenlibsFooter from "../components/kenlibs/KenlibsFooter";
import CoverPreview from "../components/cards/CoverPreview";
import Button from "../components/ui/Button";
import useDocumentTitle from "../hooks/useDocumentTitle";
import { useAuth } from "../context/AuthContext";

// The reader's Library (the "Library" tab, /kenlibs/my-books): everything
// they own or asked for, from GET /api/kenlibs/library in one request.
// Owned books show reading progress (synced across devices, see
// KenlibsReadPage) and shortcuts; pending requests are visible but not
// openable; rejected/revoked ones explain why and keep the resubmit and
// support options. Metadata only: no chapter text is ever loaded here.
// Signed-out visitors get a sign-in prompt (this route has no ReaderRoute
// redirect, so the tab bar's Library tab never lands on a blank page).

const formatDate = (value) =>
  value ? new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "";

const CHIP_STYLES = {
  ready: ["bg-emerald-50 text-emerald-800 border-emerald-200", CheckCircle2],
  pending: ["bg-amber-50 text-amber-900 border-amber-200", Clock],
  rejected: ["bg-red-50 text-red-800 border-red-200", XCircle],
  revoked: ["bg-slate-100 text-slate-700 border-slate-200", Ban],
};

const StatusChip = ({ entry }) => {
  const chip = statusChip(entry, formatDate);
  const [style, Icon] = CHIP_STYLES[chip.tone] || CHIP_STYLES.pending;
  return (
    <span className={`inline-flex items-start gap-1 px-2 py-1 rounded-lg border text-[11px] font-semibold leading-tight ${style}`}>
      <Icon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
      <span>{chip.label}</span>
    </span>
  );
};

const ProgressBar = ({ percent, label }) => (
  <div>
    <div
      className="h-1.5 rounded-full bg-gray-200 overflow-hidden"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-label={label}
    >
      <div className="h-full rounded-full bg-accent" style={{ width: `${percent}%` }} />
    </div>
    <p className="text-xs text-gray-600 mt-1">{label}</p>
  </div>
);

const Cover = ({ book, title }) => (
  <CoverPreview
    title={book?.title || title}
    subtitle={book?.subtitle}
    author={book?.author}
    coverImage={book?.coverImage}
    coverDesign={book?.coverDesign}
    size="sm"
    rounded="rounded-xl"
    className="shadow-md"
  />
);

const actionLabel = (entry) => {
  const state = readingState(entry);
  if (state === "finished") return "Read again";
  if (state === "reading") return "Continue reading";
  return "Start reading";
};

const Extras = ({ entry }) => {
  const { book } = entry;
  const { highlights = 0, bookmarks = 0 } = book.annotations || {};
  const languages = book.translations || [];
  if (!book.hasAudio && !languages.length && !highlights && !bookmarks) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs text-gray-600">
      {book.hasAudio && (
        <li>
          <Link
            to={readerLink(entry.bookId, { listen: true })}
            className="inline-flex items-center gap-1 min-h-[32px] font-semibold text-accent-hover hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            <Headphones className="w-3.5 h-3.5" aria-hidden="true" />
            Audiobook · Listen
          </Link>
        </li>
      )}
      {languages.length > 0 && (
        <li className="flex items-start gap-1">
          <Languages className="w-3.5 h-3.5 mt-px flex-shrink-0" aria-hidden="true" />
          <span>Also in {languages.map((l) => l.nativeName || l.name).join(", ")}</span>
        </li>
      )}
      {(highlights > 0 || bookmarks > 0) && (
        <li>
          <Link
            to={readerLink(entry.bookId, { panel: highlights > 0 ? "highlights" : "bookmarks" })}
            className="inline-flex items-center gap-1 min-h-[32px] hover:text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            {highlights > 0 ? <Highlighter className="w-3.5 h-3.5" aria-hidden="true" /> : <Bookmark className="w-3.5 h-3.5" aria-hidden="true" />}
            {[
              highlights > 0 && `${highlights} highlight${highlights === 1 ? "" : "s"}`,
              bookmarks > 0 && `${bookmarks} bookmark${bookmarks === 1 ? "" : "s"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Link>
        </li>
      )}
    </ul>
  );
};

const BookCard = ({ entry, onDownloadCertificate, downloadingId }) => {
  const percent = progressPercent(entry);
  const finished = readingState(entry) === "finished";
  return (
    <li className="flex flex-col min-w-0">
      <Link
        to={readerLink(entry.bookId)}
        className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-surface-warm"
        aria-label={`${actionLabel(entry)}: ${entry.title}`}
      >
        <Cover book={entry.book} title={entry.title} />
      </Link>
      <div className="mt-3 flex-1 flex flex-col min-w-0">
        <StatusChip entry={entry} />
        <h3 className="mt-2 font-serif font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{entry.title}</h3>
        {entry.author && <p className="text-xs text-gray-600 truncate">{entry.author}</p>}
        {entry.fromBundle && <p className="text-[11px] text-gray-500 truncate">From {entry.fromBundle}</p>}
        <div className="mt-2">
          <ProgressBar percent={percent} label={progressLabel(entry)} />
        </div>
        <Extras entry={entry} />
        <div className="mt-auto pt-3 space-y-2">
          <Link
            to={readerLink(entry.bookId)}
            className="flex items-center justify-center min-h-[44px] px-3 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            {actionLabel(entry)}
          </Link>
          {finished && (
            <button
              type="button"
              onClick={() => onDownloadCertificate(entry.bookId, entry.title)}
              disabled={downloadingId === entry.bookId}
              className="w-full flex items-center justify-center gap-1.5 min-h-[44px] px-3 rounded-xl border border-gray-300 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50 disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              {downloadingId === entry.bookId ? <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Award className="w-4 h-4" aria-hidden="true" />}
              Certificate
            </button>
          )}
        </div>
      </div>
    </li>
  );
};

// Pending (and, in the "All" view, rejected/revoked) requests: visible, not
// openable.
const RequestCard = ({ entry }) => (
  <li className="flex flex-col min-w-0" aria-label={`${entry.title}: ${statusChip(entry, formatDate).label}`}>
    <div className="relative opacity-70 grayscale-[35%]" aria-hidden="true">
      {entry.book ? (
        <Cover book={entry.book} title={entry.title} />
      ) : (
        <div className="aspect-[2/3] rounded-xl bg-gradient-to-br from-forest-deep to-forest-deeper flex items-center justify-center p-3 text-center">
          <span className="font-headline font-bold text-white text-sm leading-snug">{entry.title}</span>
        </div>
      )}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="w-11 h-11 rounded-full bg-white/90 flex items-center justify-center shadow">
          <Clock className="w-5 h-5 text-gray-700" />
        </span>
      </span>
    </div>
    <div className="mt-3 min-w-0">
      <StatusChip entry={entry} />
      <h3 className="mt-2 font-serif font-semibold text-gray-900 text-sm leading-snug line-clamp-2">{entry.title}</h3>
      {entry.author && <p className="text-xs text-gray-600 truncate">{entry.author}</p>}
      {entry.includedBooks?.length > 0 && (
        <p className="text-xs text-gray-600 mt-1">
          Bundle of {entry.includedBooks.length}: {entry.includedBooks.map((b) => b.title).join(", ")}
        </p>
      )}
      <p className="text-[11px] text-gray-500 mt-1">{entry.status === "pending" ? "Opens once your payment is approved." : "See “Needs attention” above."}</p>
    </div>
  </li>
);

const SupportLink = ({ entry, children = "Contact support" }) => (
  <a
    href={buildWhatsAppHref(
      `Hi, I need help with my purchase request for "${entry.title}" — it was ${entry.status}${entry.adminNote ? ` (note: "${entry.adminNote}")` : ""}.`
    )}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-accent-hover hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
  >
    <MessageCircle className="w-4 h-4" aria-hidden="true" />
    {children}
  </a>
);

// Rejected / revoked: why, what to do. Resubmitting new evidence is the
// existing flow (PUT /api/purchases/:id/resubmit), only from "rejected".
const AttentionItem = ({ entry, onResubmitted }) => {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileId = useId();
  const rejected = entry.status === "rejected";

  const submit = async () => {
    if (!file) {
      toast.error("Please choose a new evidence image first.");
      return;
    }
    setBusy(true);
    try {
      const formData = new FormData();
      formData.append("evidenceImage", file);
      await axiosInstance.put(API_PATHS.PURCHASES.RESUBMIT(entry.requestId), formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Evidence resubmitted — back in review.");
      setOpen(false);
      setFile(null);
      onResubmitted();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to resubmit evidence"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="bg-white rounded-2xl border border-gray-200 p-4">
      <div className="flex items-start gap-3">
        <div className="w-12 flex-shrink-0" aria-hidden="true">
          {entry.book ? <Cover book={entry.book} title={entry.title} /> : <div className="aspect-[2/3] rounded-lg bg-forest-deep" />}
        </div>
        <div className="min-w-0 flex-1">
          <StatusChip entry={entry} />
          <h3 className="mt-1.5 font-semibold text-gray-900 leading-snug">{entry.title}</h3>
          <p className="text-sm text-gray-700 mt-1">
            {entry.adminNote
              ? `Reason: ${entry.adminNote}`
              : rejected
                ? "Your payment couldn't be confirmed."
                : "Access to this item was removed."}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
            {rejected && !open && (
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-semibold text-gray-900 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
              >
                <UploadCloud className="w-4 h-4" aria-hidden="true" />
                Resubmit evidence
              </button>
            )}
            <SupportLink entry={entry} />
          </div>
          {open && (
            <div className="mt-2 pt-3 border-t border-gray-100 space-y-3">
              <label htmlFor={fileId} className="flex items-center gap-3 border-2 border-dashed border-gray-300 rounded-2xl px-4 min-h-[48px] cursor-pointer hover:border-accent-300 focus-within:ring-2 focus-within:ring-accent">
                <UploadCloud className="w-5 h-5 text-gray-500 flex-shrink-0" aria-hidden="true" />
                <span className="text-sm text-gray-700 truncate">{file ? file.name : "Choose a new screenshot or photo"}</span>
                <input id={fileId} type="file" accept="image/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
              </label>
              <div className="flex gap-2">
                <Button size="sm" loading={busy} onClick={submit}>
                  Submit
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
};

const ContinueCard = ({ entry }) => (
  <section aria-labelledby="continue-heading" className="bg-white rounded-3xl border border-gray-200 shadow-sm p-4 sm:p-5 flex gap-4 sm:gap-6 items-center">
    <Link to={readerLink(entry.bookId)} className="w-20 sm:w-24 flex-shrink-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-accent" tabIndex={-1} aria-hidden="true">
      <Cover book={entry.book} title={entry.title} />
    </Link>
    <div className="min-w-0 flex-1">
      <p id="continue-heading" className="text-xs font-bold uppercase tracking-wider text-accent-hover">
        Continue reading
      </p>
      <h2 className="font-headline font-bold text-gray-900 text-lg sm:text-xl leading-snug mt-1 line-clamp-2">{entry.title}</h2>
      {entry.author && <p className="text-sm text-gray-600 truncate">{entry.author}</p>}
      <div className="mt-2 max-w-sm">
        <ProgressBar percent={progressPercent(entry)} label={progressLabel(entry)} />
      </div>
      <Link
        to={readerLink(entry.bookId)}
        className="mt-3 inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-accent text-white text-sm font-semibold hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
      >
        <BookOpen className="w-4 h-4" aria-hidden="true" />
        Continue reading
      </Link>
    </div>
  </section>
);

const SummaryStrip = ({ summary }) => (
  <dl className="flex flex-wrap gap-2 mt-4">
    <div className="flex items-baseline gap-1.5 px-3 py-2 rounded-xl bg-white/10 text-white">
      <dt className="sr-only">Books owned</dt>
      <dd className="font-bold text-lg leading-none">{summary.owned}</dd>
      <span className="text-sm text-white/85">{summary.owned === 1 ? "book" : "books"}</span>
    </div>
    <div className="flex items-baseline gap-1.5 px-3 py-2 rounded-xl bg-white/10 text-white">
      <dt className="sr-only">Finished</dt>
      <dd className="font-bold text-lg leading-none">{summary.finished}</dd>
      <span className="text-sm text-white/85">finished</span>
    </div>
    {summary.creditBalance > 0 && (
      <div className="px-3 py-2 rounded-xl bg-white/10 text-white">
        <dt className="sr-only">Store credit</dt>
        <dd>
          <Link to="/kenlibs/referrals" className="inline-flex items-center gap-1.5 text-sm hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-white rounded">
            <Wallet className="w-4 h-4" aria-hidden="true" />
            <span className="font-bold">{formatNaira(summary.creditBalance)}</span> credit
          </Link>
        </dd>
      </div>
    )}
  </dl>
);

const PageHeader = ({ summary }) => (
  <section className="bg-gradient-to-b from-forest-deep to-forest-deeper">
    <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 pt-7 pb-7 sm:pt-10 sm:pb-9">
      <h1 className="font-headline font-extrabold text-white text-3xl sm:text-4xl tracking-tight [font-variation-settings:'SOFT'_100]">
        Your <span className="text-accent-on-dark">Library</span>
      </h1>
      <p className="font-rounded font-semibold text-white/90 mt-1">Everything you own, right where you left off.</p>
      {summary && <SummaryStrip summary={summary} />}
    </div>
  </section>
);

const Skeleton = () => (
  <div aria-hidden="true">
    <div className="h-28 rounded-3xl bg-white border border-gray-200 animate-pulse" />
    <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 sm:gap-x-6 gap-y-8 mt-8">
      {Array.from({ length: 4 }).map((_, i) => (
        <li key={i}>
          <div className="aspect-[2/3] rounded-xl bg-gray-200 animate-pulse" />
          <div className="h-3 w-3/4 rounded bg-gray-200 animate-pulse mt-3" />
          <div className="h-3 w-1/2 rounded bg-gray-200 animate-pulse mt-2" />
        </li>
      ))}
    </ul>
  </div>
);

const EmptyState = ({ icon: Icon = Library, title, children, action }) => (
  <div className="text-center py-14 px-4">
    <div className="w-16 h-16 mx-auto rounded-2xl bg-accent-50 flex items-center justify-center mb-5">
      <Icon className="w-8 h-8 text-accent-hover" aria-hidden="true" />
    </div>
    <h2 className="text-xl font-bold text-gray-900">{title}</h2>
    <div className="text-gray-600 mt-2 max-w-md mx-auto">{children}</div>
    {action && <div className="mt-6">{action}</div>}
  </div>
);

const BrowseButton = () => (
  <Link
    to="/kenlibs"
    className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-accent text-white font-semibold hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
  >
    <BookOpen className="w-4 h-4" aria-hidden="true" />
    Browse books
  </Link>
);

const Tools = ({ query, setQuery, filter, setFilter, sort, setSort }) => {
  const searchId = useId();
  const sortId = useId();
  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
        <div className="relative flex-1 max-w-md">
          <label htmlFor={searchId} className="sr-only">
            Search your library by title or author
          </label>
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" aria-hidden="true" />
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your library..."
            className="w-full h-11 pl-11 pr-11 rounded-full bg-white border border-gray-300 text-sm text-gray-900 placeholder:text-gray-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:border-transparent [&::-webkit-search-cancel-button]:appearance-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-0.5 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full text-gray-500 hover:text-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={sortId} className="text-sm text-gray-700 whitespace-nowrap">
            Sort by
          </label>
          <select
            id={sortId}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-11 rounded-xl bg-white border border-gray-300 px-3 text-sm text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto -mx-5 px-5 sm:mx-0 sm:px-0 sm:flex-wrap pb-1" role="group" aria-label="Show">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`flex-shrink-0 min-h-[44px] px-4 rounded-full text-sm font-semibold border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 ${
              filter === f.key ? "bg-forest text-white border-forest" : "bg-white text-gray-800 border-gray-300 hover:border-gray-400"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
};

const SignedOut = () => (
  <>
    <PageHeader summary={null} />
    <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8">
      <EmptyState
        title="Sign in to see your library"
        action={
          <div className="flex flex-wrap justify-center gap-3">
            <Link
              to="/kenlibs/login"
              state={{ from: "/kenlibs/my-books" }}
              className="inline-flex items-center justify-center min-h-[44px] px-6 rounded-xl bg-accent text-white font-semibold hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
            >
              Sign in
            </Link>
            <Link
              to="/kenlibs/signup"
              state={{ from: "/kenlibs/my-books" }}
              className="inline-flex items-center justify-center min-h-[44px] px-6 rounded-xl border border-gray-300 bg-white text-gray-900 font-semibold hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Create an account
            </Link>
          </div>
        }
      >
        Books you buy on Kenlibs live here, with your reading progress on every device.
      </EmptyState>
    </div>
  </>
);

const KenlibsMyBooksPage = () => {
  useDocumentTitle("Your Library — Kenlibs");
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | error
  const [prefs, setPrefs] = useState(loadLibraryPrefs);
  const [query, setQuery] = useState("");
  const [downloadingId, setDownloadingId] = useState(null);

  const fetchLibrary = useCallback(
    () =>
      axiosInstance
        .get(API_PATHS.KENLIBS.LIBRARY)
        .then((res) => {
          setData(res.data);
          setStatus("ok");
        })
        .catch(() => setStatus("error")),
    []
  );
  // Retry / refresh after a resubmission.
  const load = () => {
    setStatus("loading");
    fetchLibrary();
  };

  useEffect(() => {
    if (isAuthenticated) fetchLibrary();
  }, [isAuthenticated, fetchLibrary]);

  const setFilter = (filter) => setPrefs((p) => (saveLibraryPrefs({ ...p, filter }), { ...p, filter }));
  const setSort = (sort) => setPrefs((p) => (saveLibraryPrefs({ ...p, sort }), { ...p, sort }));

  const entries = useMemo(() => buildLibraryEntries(data), [data]);
  const shown = useMemo(() => visibleEntries(entries, { filter: prefs.filter, query, sort: prefs.sort }), [entries, prefs, query]);
  const continueEntry = useMemo(() => continueReadingEntry(entries), [entries]);
  const attention = entries.filter((e) => e.kind === "request" && (e.status === "rejected" || e.status === "revoked"));
  const ownedCount = entries.filter((e) => e.kind === "book").length;
  const pendingCount = entries.filter((e) => e.kind === "request" && e.status === "pending").length;
  // Rejected/revoked live in "Needs attention", not the grid.
  const gridEntries = shown.filter((e) => !(e.kind === "request" && e.status !== "pending"));

  const downloadCertificate = async (bookId, title) => {
    setDownloadingId(bookId);
    try {
      const response = await axiosInstance.get(API_PATHS.KENLIBS.CERTIFICATE(bookId), { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${title || "certificate"} — Kenlibs Certificate.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to generate certificate"));
    } finally {
      setDownloadingId(null);
    }
  };

  let body;
  if (status === "loading" && !data) {
    body = <Skeleton />;
  } else if (status === "error" && !data) {
    body = (
      <EmptyState
        icon={AlertTriangle}
        title="Couldn't load your library"
        action={
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-2 min-h-[44px] px-5 rounded-xl bg-accent text-white font-semibold hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
          >
            <RefreshCw className="w-4 h-4" aria-hidden="true" />
            Try again
          </button>
        }
      >
        Check your connection and try again. Your books and progress are safe.
      </EmptyState>
    );
  } else if (entries.length === 0) {
    body = (
      <EmptyState title="Your library is waiting for its first book" action={<BrowseButton />}>
        Books you buy appear here, ready to read on your phone, tablet or computer, with your place saved.
      </EmptyState>
    );
  } else {
    body = (
      <div className="space-y-8">
        {continueEntry && <ContinueCard entry={continueEntry} />}

        {ownedCount === 0 && pendingCount > 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">Your {pendingCount === 1 ? "book is" : "books are"} almost here</p>
            <p className="mt-1">
              We check each payment by hand, usually within a few hours (sometimes up to a day). You'll get an email the moment
              it's approved, and the book opens right here.
            </p>
            <SupportLink entry={{ title: "my pending order", status: "pending", adminNote: "" }}>Questions? Contact support</SupportLink>
          </div>
        )}

        {attention.length > 0 && (
          <section aria-labelledby="attention-heading">
            <h2 id="attention-heading" className="flex items-center gap-2 font-semibold text-gray-900 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-600" aria-hidden="true" />
              Needs attention
            </h2>
            <ul className="space-y-3">
              {attention.map((entry) => (
                <AttentionItem key={entry.key} entry={entry} onResubmitted={load} />
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="books-heading">
          <h2 id="books-heading" className="sr-only">
            Your books
          </h2>
          <Tools query={query} setQuery={setQuery} filter={prefs.filter} setFilter={setFilter} sort={prefs.sort} setSort={setSort} />
          <p className="sr-only" aria-live="polite">
            {gridEntries.length} {gridEntries.length === 1 ? "item" : "items"} shown
          </p>
          {gridEntries.length === 0 ? (
            <EmptyState icon={Search} title="Nothing here">
              {query ? `No books match “${query.trim()}”.` : "No books in this view yet."}
            </EmptyState>
          ) : (
            <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 sm:gap-x-6 gap-y-9 mt-6">
              {gridEntries.map((entry) =>
                entry.kind === "book" ? (
                  <BookCard key={entry.key} entry={entry} onDownloadCertificate={downloadCertificate} downloadingId={downloadingId} />
                ) : (
                  <RequestCard key={entry.key} entry={entry} />
                )
              )}
            </ul>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-warm flex flex-col">
      <KenlibsNav />
      {authLoading ? (
        <div className="flex-1" />
      ) : !isAuthenticated ? (
        <SignedOut />
      ) : (
        <>
          <PageHeader summary={data?.summary} />
          <main className="flex-1 max-w-7xl w-full mx-auto px-5 sm:px-6 lg:px-8 py-7 sm:py-10">{body}</main>
        </>
      )}
      <KenlibsFooter />
    </div>
  );
};

export default KenlibsMyBooksPage;
