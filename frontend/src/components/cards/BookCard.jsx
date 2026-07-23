import React from "react";
import { useNavigate } from "react-router-dom";
import { BASE_URL } from "../../utils/apiPaths";
import { Edit, Trash2, BookOpen } from "lucide-react";

const BookCard = ({ book, onDelete }) => {
  const navigate = useNavigate();

  const coverImageUrl = book.coverImage
    ? `${BASE_URL}${book.coverImage}`.replace(/\\/g, "/")
    : null;

  return (
    <div
      onClick={() => navigate(`/view-book/${book._id}`)}
      className="group bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer"
    >
      {/* Cover Image */}
      <div className="relative aspect-[3/4] bg-gradient-to-br from-violet-50 to-purple-50 overflow-hidden">
        {coverImageUrl ? (
          <img
            src={coverImageUrl}
            alt={book.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            onError={(e) => {
              e.target.style.display = "none";
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <BookOpen className="w-16 h-16 text-violet-300" />
          </div>
        )}

        {/* Action Buttons (appear on hover) */}
        <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/editor/${book._id}`);
            }}
            className="w-9 h-9 bg-white/90 backdrop-blur-sm rounded-xl flex items-center justify-center text-gray-700 hover:bg-violet-600 hover:text-white shadow-md transition-all"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(book._id);
            }}
            className="w-9 h-9 bg-white/90 backdrop-blur-sm rounded-xl flex items-center justify-center text-gray-700 hover:bg-red-500 hover:text-white shadow-md transition-all"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Book Info */}
      <div className="p-5">
        <h3 className="font-semibold text-gray-900 text-lg leading-tight line-clamp-2 mb-1">
          {book.title || "Untitled Book"}
        </h3>
        <p className="text-sm text-gray-500">
          {book.author || "Unknown Author"}
        </p>

        {/* Optional: Progress or status */}
        {book.status && (
          <div className="mt-4">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-violet-50 text-violet-700">
              {book.status}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default BookCard;