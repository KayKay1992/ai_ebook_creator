import React from "react";
import { useNavigate } from "react-router-dom";
import { Edit, Trash2, Palette } from "lucide-react";
import CoverPreview from "./CoverPreview";

const BookCard = ({ book, onDelete }) => {
  const navigate = useNavigate();

  return (
    <div
      onClick={() => navigate(`/view-book/${book._id}`)}
      className="group bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer"
    >
      {/* Cover — real 3D tilt on hover (perspective + rotateY), with a thin
          page-edge/spine face so it reads as a physical object, not a flat
          card spinning in place. No overflow-hidden on these wrappers: the
          spine needs room to render outside the cover's own box as it turns. */}
      <div className="relative [perspective:1200px]">
        <div
          className="relative transition-transform duration-500 ease-out [transform-style:preserve-3d] [transform-origin:right_center] group-hover:[transform:rotateY(-14deg)]"
        >
          <CoverPreview
            title={book.title}
            subtitle={book.subtitle}
            author={book.author}
            coverImage={book.coverImage}
            coverDesign={book.coverDesign}
            size="sm"
            rounded="rounded-t-3xl"
          />

          {/* Spine / page-edge face — perpendicular to the cover, only reads
              as a strip once the parent rotates in 3D. */}
          <div
            className="absolute top-0 left-0 h-full w-3 rounded-l-sm bg-gradient-to-b from-gray-100 via-white to-gray-200 shadow-[inset_2px_0_4px_rgba(0,0,0,0.25)] [transform:rotateY(90deg)] [transform-origin:left_center]"
          />
        </div>

        {/* Action Buttons — flat UI chrome, deliberately outside the 3D
            rotating layer so they stay easy to click and undistorted. */}
        <div className="absolute top-3 right-3 z-10 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/editor/${book._id}`);
            }}
            className="w-9 h-9 bg-white/90 backdrop-blur-sm rounded-xl flex items-center justify-center text-gray-700 hover:bg-accent hover:text-white shadow-md transition-all"
            title="Edit book"
          >
            <Edit className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/editor/${book._id}/cover`);
            }}
            className="w-9 h-9 bg-white/90 backdrop-blur-sm rounded-xl flex items-center justify-center text-gray-700 hover:bg-accent hover:text-white shadow-md transition-all"
            title="Design cover"
          >
            <Palette className="w-4 h-4" />
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
      <div className="p-5 rounded-b-3xl bg-white">
        <h3 className="font-serif font-semibold text-gray-900 text-lg leading-tight line-clamp-2 mb-1">
          {book.title || "Untitled Book"}
        </h3>
        <p className="text-sm text-gray-500">
          {book.author || "Unknown Author"}
        </p>

        {/* Optional: Progress or status */}
        {book.status && (
          <div className="mt-4">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-accent-50 text-accent-hover">
              {book.status}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

export default BookCard;
