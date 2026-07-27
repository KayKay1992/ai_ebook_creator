import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Book, ArrowLeft } from "lucide-react";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import ViewBook from "../components/view/ViewBook";
import DashboardLayout from "../components/layout/DashboardLayout";
import Button from "../components/ui/Button";

const ViewBookSkeleton = () => (
  <div className="max-w-3xl mx-auto px-6 py-16 animate-pulse">
    <div className="h-8 bg-gray-200 rounded-xl w-2/3 mb-4"></div>
    <div className="h-4 bg-gray-100 rounded-lg w-1/3 mb-12"></div>

    <div className="space-y-4">
      <div className="h-4 bg-gray-100 rounded-lg w-full"></div>
      <div className="h-4 bg-gray-100 rounded-lg w-11/12"></div>
      <div className="h-4 bg-gray-100 rounded-lg w-4/5"></div>
      <div className="h-4 bg-gray-100 rounded-lg w-full"></div>
      <div className="h-4 bg-gray-100 rounded-lg w-3/4"></div>
      <div className="h-4 bg-gray-100 rounded-lg w-5/6"></div>
    </div>
  </div>
);

const ViewBookPage = () => {
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const { bookId } = useParams();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchBook = async () => {
      try {
        const response = await axiosInstance.get(
          `${API_PATHS.BOOKS.GET_BOOK_BY_ID}/${bookId}`
        );
        setBook(response.data);
      } catch (error) {
        toast.error("Failed to fetch book");
      } finally {
        setLoading(false);
      }
    };

    if (bookId) fetchBook();
  }, [bookId]);

  return (
    <DashboardLayout>
      {loading ? (
        <ViewBookSkeleton />
      ) : book ? (
        <ViewBook book={book} />
      ) : (
        <div className="flex flex-col items-center justify-center py-32 text-center px-6">
          <div className="w-20 h-20 bg-violet-50 rounded-3xl flex items-center justify-center mb-6">
            <Book className="w-10 h-10 text-violet-500" />
          </div>

          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            Book not found
          </h2>

          <p className="text-gray-500 max-w-md mb-8">
            The book you are looking for does not exist or may have been deleted.
          </p>

          <Button
            onClick={() => navigate("/dashboard")}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </Button>
        </div>
      )}
    </DashboardLayout>
  );
};

export default ViewBookPage;