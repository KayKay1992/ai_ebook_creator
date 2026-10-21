import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Plus, Book } from "lucide-react";

import DashboardLayout from "../components/layout/DashboardLayout";
import Button from "../components/ui/Button";
import { useAuth } from "../context/AuthContext";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import BookCard from "../components/cards/BookCard";
import CreateBookModal from "../components/modals/CreateBookModal";
import BookCardSkeleton from "../components/skeletons/BookCardSkeleton";
import DeleteBookDialog from "../components/dashboard/DeleteBookDialog";

const DashboardPage = () => {
  const [books, setBooks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bookToDelete, setBookToDelete] = useState(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const fetchBooks = async () => {
      try {
        const response = await axiosInstance.get(API_PATHS.BOOKS.GET_BOOKS);
        setBooks(response.data);
      } catch (error) {
        toast.error("Error fetching books");
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchBooks();
  }, []);

  // The dialog asks for two or three confirmations and does the request
  // (components/dashboard/DeleteBookDialog.jsx).
  const handleBookDeleted = (bookId) => {
    setBooks((prev) => prev.filter((book) => book._id !== bookId));
    setBookToDelete(null);
    toast.success("Book deleted");
  };
  const handleBookUnpublished = (updated) => {
    setBooks((prev) => prev.map((book) => (book._id === updated._id ? { ...book, status: updated.status } : book)));
    setBookToDelete(null);
    toast.success("Unpublished: it's off the store, and buyers keep it in their Library.");
  };

  const handleCreateBookClick = () => {
    // You can open a create modal here later
    // For now navigate to a create page or open modal
    navigate("/create-book");
  };

  return (
    <DashboardLayout>
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6 mb-12">
          <div>
            <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 tracking-tight">
              My eBooks
            </h1>
            <p className="text-gray-500 mt-2">
              Create, manage and publish your AI-powered books
            </p>
          </div>

          <Button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-2"
          >
            <Plus className="w-5 h-5" />
            Create New eBook
          </Button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <BookCardSkeleton key={i} />
            ))}
          </div>
        ) : books.length === 0 ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-24 h-24 bg-accent-50 rounded-3xl flex items-center justify-center mb-8">
              <Book className="w-12 h-12 text-accent" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-3">
              No eBooks yet
            </h3>
            <p className="text-gray-500 max-w-md mb-8">
              Start your writing journey by creating your first AI-powered
              ebook. It only takes a few minutes.
            </p>
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Create Your First eBook
            </Button>
          </div>
        ) : (
          /* Books Grid */
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {books.map((book) => (
              <BookCard
                key={book._id}
                book={book}
                onDelete={() => setBookToDelete(book)}
              />
            ))}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {bookToDelete && (
          <DeleteBookDialog
            key={bookToDelete._id}
            book={bookToDelete}
            onClose={() => setBookToDelete(null)}
            onDeleted={handleBookDeleted}
            onUnpublished={handleBookUnpublished}
          />
        )}

        {/* Create Book Modal */}
        <CreateBookModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
          onBookCreated={(bookId) => {
            setIsCreateModalOpen(false);
            navigate(`/editor/${bookId}`);
          }}
        />
      </div>
    </DashboardLayout>
  );
};

export default DashboardPage;
