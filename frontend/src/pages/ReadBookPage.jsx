import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { BookX, ArrowLeft, Lock, ShoppingBag } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import ViewBook from "../components/view/ViewBook";
import Button from "../components/ui/Button";
import MarkdownContent from "../components/shared/MarkdownContent";
import ViewBookSkeleton from "../components/skeletons/ViewBookSkeleton";
import useDocumentTitle from "../hooks/useDocumentTitle";

// Public, unauthenticated share link (/read/:shareId), sourced from
// /api/public/books/:shareId. That endpoint returns a PREVIEW only
// (backend/utils/sharePreview.js): excerpts of the first chapter(s) and
// every other chapter as a locked title. The server decides what's in it;
// this page just shows it, with a way to buy the full book on its Kenlibs
// page (/kenlibs/book/:id, which handles the signup-first buy flow).
// Full text is only in the gated reader (KenlibsReadPage) and the owner's
// own preview (ViewBookPage), which use their own endpoints.

const BuyButton = ({ bookId, className = "" }) => (
  <Link
    to={`/kenlibs/book/${bookId}`}
    className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-2xl text-sm font-semibold text-white bg-gradient-to-r from-accent to-accent-secondary hover:from-accent-hover hover:to-accent-secondary-hover shadow-lg shadow-accent-500/30 transition-all ${className}`}
  >
    <ShoppingBag className="w-4 h-4" />
    Preview only: buy the full book
  </Link>
);

const PreviewEnd = ({ book }) => (
  <div className="mt-12 rounded-3xl border border-accent-100 bg-gradient-to-br from-accent-50 to-white p-8 text-center">
    <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center mx-auto mb-4">
      <Lock className="w-6 h-6 text-accent" />
    </div>
    <h3 className="font-serif text-2xl font-bold text-gray-900">That's the end of the preview</h3>
    <p className="text-gray-500 mt-2 max-w-md mx-auto">
      Get the full book to keep reading all {book.totalChapters} chapter{book.totalChapters === 1 ? "" : "s"}.
    </p>
    <BuyButton bookId={book._id} className="mt-6" />
  </div>
);

const ReadBookPage = () => {
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const { shareId } = useParams();
  const navigate = useNavigate();

  useDocumentTitle(book ? `${book.title} — Kenlibs` : "Kenlibs");

  useEffect(() => {
    const fetchBook = async () => {
      try {
        const response = await axiosInstance.get(
          `${API_PATHS.PUBLIC.GET_BOOK_BY_SHARE_ID}/${shareId}`
        );
        setBook(response.data);
      } catch {
        // A 404 here just means the link is invalid/unpublished — an
        // expected outcome for a visitor, not something to toast as an error.
        setBook(null);
      } finally {
        setLoading(false);
      }
    };

    if (shareId) fetchBook();
  }, [shareId]);

  if (loading) {
    return <ViewBookSkeleton />;
  }

  if (book) {
    const hasMore = book.chapters.some((chapter) => chapter.locked || chapter.isExcerpt);
    const renderChapterContent = (chapter, chapterIndex, fontSize) => {
      if (chapter.locked) {
        return (
          <div className="rounded-3xl border border-gray-100 bg-gray-50 p-8 text-center">
            <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center mx-auto mb-4">
              <Lock className="w-6 h-6 text-gray-500" />
            </div>
            <p className="font-semibold text-gray-900">This chapter is part of the full book</p>
            <p className="text-sm text-gray-500 mt-1">
              The preview includes the start of the first {book.previewChapters === 1 ? "chapter" : `${book.previewChapters} chapters`}.
            </p>
            <BuyButton bookId={book._id} className="mt-6" />
          </div>
        );
      }
      const isLastPreviewChapter = chapterIndex === book.previewChapters - 1;
      return (
        <>
          <MarkdownContent
            content={chapter.content}
            emptyMessage="No content available for this chapter."
            className="font-serif leading-loose text-gray-700"
            style={{ fontSize: `${fontSize}px` }}
          />
          {chapter.isExcerpt && <p className="mt-6 text-center text-gray-400 tracking-widest">…</p>}
          {isLastPreviewChapter && hasMore && <PreviewEnd book={book} />}
        </>
      );
    };

    return (
      <ViewBook
        book={book}
        backTo="/"
        backLabel="Home"
        animated
        renderChapterContent={renderChapterContent}
        headerControls={
          hasMore ? (
            <Link
              to={`/kenlibs/book/${book._id}`}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-semibold text-accent-hover bg-accent-50 hover:bg-accent-100"
              title="This is a preview. Get the full book on Kenlibs."
            >
              <Lock className="w-3.5 h-3.5" />
              Preview · Buy the full book
            </Link>
          ) : null
        }
      />
    );
  }

  return (
    <div className="min-h-screen bg-surface-warm flex flex-col items-center justify-center py-32 text-center px-6">
      <div className="w-20 h-20 bg-accent-50 rounded-3xl flex items-center justify-center mb-6">
        <BookX className="w-10 h-10 text-accent-500" />
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-3">
        This link isn't available
      </h2>

      <p className="text-gray-500 max-w-md mb-8">
        This book may have been unpublished, or the link may be incorrect.
      </p>

      <Button
        onClick={() => navigate("/")}
        className="flex items-center gap-2"
      >
        <ArrowLeft className="w-4 h-4" />
        Go Home
      </Button>
    </div>
  );
};

export default ReadBookPage;
