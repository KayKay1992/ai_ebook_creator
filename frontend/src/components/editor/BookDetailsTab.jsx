import InputField from "../ui/InputField";
import Button from "../ui/Button";
import { UploadCloud, Image as ImageIcon } from "lucide-react";
import { BASE_URL } from "../../utils/apiPaths";

const BookDetailsTab = ({
  book,
  onBookChange,
  onCoverUpload,
  isUploading,
  fileInputRef,
}) => {
  const coverImageUrl = book.coverImage
    ? book.coverImage.startsWith("http")
      ? book.coverImage
      : `${BASE_URL}${book.coverImage}`.replace(/\\/g, "/")
    : null;

  return (
    <div className="max-w-3xl mx-auto space-y-10 animate-in fade-in duration-500">
      {/* ===== Book Information ===== */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8">
        <h3 className="text-xl font-bold text-gray-900 mb-6">Book Information</h3>

        <div className="space-y-6">
          <InputField
            label="Book Title"
            name="title"
            value={book.title || ""}
            onChange={onBookChange}
            placeholder="Enter the title of your book"
          />

          <InputField
            label="Author"
            name="author"
            value={book.author || ""}
            onChange={onBookChange}
            placeholder="Author name"
          />

          <InputField
            label="Subtitle (Optional)"
            name="subtitle"
            value={book.subtitle || ""}
            onChange={onBookChange}
            placeholder="A short and catchy subtitle"
          />
        </div>
      </div>

      {/* ===== Cover Image ===== */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8">
        <h3 className="text-xl font-bold text-gray-900 mb-6">Cover Image</h3>

        <div className="flex flex-col md:flex-row gap-8 items-start">
          {/* Cover Preview */}
          <div className="w-full md:w-48 flex-shrink-0">
            <div className="aspect-[2/3] rounded-2xl overflow-hidden border border-gray-200 bg-gradient-to-br from-violet-50 to-purple-50 flex items-center justify-center shadow-sm">
              {coverImageUrl ? (
                <img
                  src={coverImageUrl}
                  alt="Book Cover"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.target.style.display = "none";
                  }}
                />
              ) : (
                <div className="text-center p-4">
                  <ImageIcon className="w-12 h-12 text-violet-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-400">No cover yet</p>
                </div>
              )}
            </div>
          </div>

          {/* Upload Section */}
          <div className="flex-1">
            <p className="text-gray-600 mb-6 leading-relaxed">
              Upload a high-quality cover image for your book.  
              Recommended size: <span className="font-medium">1600 × 2400 px</span>.  
              Supported formats: JPG, PNG. Maximum size: 5MB.
            </p>

            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={onCoverUpload}
              className="hidden"
            />

            <Button
              onClick={() => fileInputRef.current?.click()}
              loading={isUploading}
              variant="secondary"
              className="flex items-center gap-2"
            >
              <UploadCloud className="w-4 h-4" />
              {isUploading ? "Uploading..." : "Upload Cover Image"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookDetailsTab;