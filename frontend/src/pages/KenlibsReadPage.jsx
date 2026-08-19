import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Lock, BookX, ArrowLeft } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import ViewBook from "../components/view/ViewBook";
import Button from "../components/ui/Button";
import ViewBookSkeleton from "../components/skeletons/ViewBookSkeleton";

// The gated reader — same ViewBook rendering as the creator's own preview
// (/view-book/:bookId) and the public share link (/read/:shareId), but
// sourced from the access-checked /api/kenlibs/read/:bookId endpoint. The
// access decision is entirely server-side; this page just reacts to
// whatever comes back (200 = readable, 403 = not authorized yet).
const KenlibsReadPage = () => {
  const { bookId } = useParams();
  const navigate = useNavigate();
  const [book, setBook] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ok | forbidden | not-found

  useEffect(() => {
    const fetchBook = async () => {
      try {
        const res = await axiosInstance.get(API_PATHS.KENLIBS.READ(bookId));
        setBook(res.data);
        setStatus("ok");
      } catch (error) {
        setStatus(error.response?.status === 403 ? "forbidden" : "not-found");
      }
    };
    fetchBook();
  }, [bookId]);

  if (status === "loading") {
    return <ViewBookSkeleton />;
  }

  if (status === "ok") {
    return <ViewBook book={book} backTo="/kenlibs/my-books" backLabel="My Books" />;
  }

  const isForbidden = status === "forbidden";

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center py-32 text-center px-6">
      <div className="w-20 h-20 bg-accent-50 rounded-3xl flex items-center justify-center mb-6">
        {isForbidden ? (
          <Lock className="w-10 h-10 text-accent-500" />
        ) : (
          <BookX className="w-10 h-10 text-accent-500" />
        )}
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-3">
        {isForbidden ? "You don't have access to this book" : "Book not found"}
      </h2>

      <p className="text-gray-500 max-w-md mb-8">
        {isForbidden
          ? "You'll be able to read this once your purchase request for it is approved."
          : "This book may have been removed."}
      </p>

      <Button onClick={() => navigate("/kenlibs/my-books")} className="flex items-center gap-2">
        <ArrowLeft className="w-4 h-4" />
        Back to My Books
      </Button>
    </div>
  );
};

export default KenlibsReadPage;
