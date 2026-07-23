import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Plus, Book, Trash2, X } from "lucide-react";

import DashboardLayout from "../components/layout/DashboardLayout";
import Button from "../components/ui/Button";
import { useAuth } from "../context/AuthContext";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import BookCard from "../components/cards/BookCard";

// Skeleton Loader
const BookCardSkeleton = () => (
  <div className="bg-white rounded-3xl border border-gray-100 p-6 animate-pulse">
    <div className="h-48 bg-gray-100 rounded-2xl mb-5"></div>
    <div className="h-5 bg-gray-100 rounded-lg w-3/4 mb-3"></div>
    <div className="h-4 bg-gray-100 rounded-lg w-1/2"></div>
  </div>
);

// Confirmation Modal
const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose}></div>
      
      <div className="relative bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
        <button 
          onClick={onClose}
          className="absolute top-5 right-5 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mb-6">
          <Trash2 className="w-7 h-7 text-red-500" />
        </div>

        <h3 className="text-2xl font-bold text-gray-900 mb-3">{title}</h3>
        <p className="text-gray-600 mb-8">{message}</p>

        <div className="flex gap-4">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            className="flex-1 bg-red-600 hover:bg-red-700" 
            onClick={onConfirm}
          >
            Delete eBook
          </Button>
        </div>
      </div>
    </div>
  );
};

const DashboardPage = () => {
  const [books, setBooks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bookToDelete, setBookToDelete] = useState(null);

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

  const handleDeleteBook = async () => {
    if (!bookToDelete) return;
    try {
      await axiosInstance.delete(`${API_PATHS.BOOKS.DELETE_BOOK}/${bookToDelete}`);
      setBooks(books.filter((book) => book._id !== bookToDelete));
      toast.success("Book deleted successfully");
    } catch (error) {
      toast.error(error.response?.data?.message || "Error deleting book");
    } finally {
      setBookToDelete(null);
    }
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
            onClick={handleCreateBookClick} 
            className="flex items-center gap-2 px-6 py-3"
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
            <div className="w-24 h-24 bg-violet-50 rounded-3xl flex items-center justify-center mb-8">
              <Book className="w-12 h-12 text-violet-600" />
            </div>
            <h3 className="text-2xl font-semibold text-gray-900 mb-3">
              No eBooks yet
            </h3>
            <p className="text-gray-500 max-w-md mb-8">
              Start your writing journey by creating your first AI-powered ebook. 
              It only takes a few minutes.
            </p>
            <Button onClick={handleCreateBookClick} className="flex items-center gap-2">
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
                onDelete={() => setBookToDelete(book._id)}
              />
            ))}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        <ConfirmationModal
          isOpen={!!bookToDelete}
          onClose={() => setBookToDelete(null)}
          onConfirm={handleDeleteBook}
          title="Delete this eBook?"
          message="This action cannot be undone. The book and all its content will be permanently deleted."
        />
      </div>
    </DashboardLayout>
  );
};

export default DashboardPage;