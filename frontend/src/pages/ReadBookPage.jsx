import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { BookX, ArrowLeft } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import ViewBook from "../components/view/ViewBook";
import Button from "../components/ui/Button";
import ViewBookSkeleton from "../components/skeletons/ViewBookSkeleton";
import useDocumentTitle from "../hooks/useDocumentTitle";

// Public, unauthenticated reader for a book's share link — sourced from
// /api/public/books/:shareId rather than the protected book endpoints.
// Reader-facing like the Kenlibs pages, so it gets the same Kenlibs tab
// title override rather than the admin default.
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
    return <ViewBook book={book} backTo="/" backLabel="Home" animated />;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center py-32 text-center px-6">
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
