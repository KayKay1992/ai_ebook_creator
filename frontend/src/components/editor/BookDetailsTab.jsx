import { useState } from "react";
import InputField from "../ui/inputField";
import Button from "../ui/Button";
import { UploadCloud, Globe, Lock, Copy, Check } from "lucide-react";
import toast from "react-hot-toast";
import ExportTemplatePicker from "./ExportTemplatePicker";
import CoverPreview from "../cards/CoverPreview";

const BookDetailsTab = ({
  book,
  onBookChange,
  onCoverUpload,
  isUploading,
  fileInputRef,
  onTogglePublish,
  isTogglingPublish,
}) => {
  const [copied, setCopied] = useState(false);
  const isPublished = book.status === "published";
  const shareUrl = book.shareId
    ? `${window.location.origin}/read/${book.shareId}`
    : "";

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy link — copy it manually instead.");
    }
  };

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

      {/* ===== Publish & Share ===== */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
              {isPublished ? (
                <Globe className="w-5 h-5 text-emerald-600" />
              ) : (
                <Lock className="w-5 h-5 text-gray-400" />
              )}
              {isPublished ? "Published" : "Draft"}
            </h3>
            <p className="text-gray-600 leading-relaxed max-w-md">
              {isPublished
                ? "Anyone with the link below can read this book — no account required."
                : "Publish this book to generate a public, read-only share link."}
            </p>
          </div>

          <Button
            onClick={onTogglePublish}
            loading={isTogglingPublish}
            variant={isPublished ? "secondary" : "primary"}
          >
            {isPublished ? "Unpublish" : "Publish Book"}
          </Button>
        </div>

        {isPublished && shareUrl && (
          <div className="mt-6 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-2xl p-2 pl-4">
            <input
              type="text"
              readOnly
              value={shareUrl}
              onClick={(e) => e.target.select()}
              className="flex-1 min-w-0 bg-transparent text-sm text-gray-700 outline-none truncate"
            />
            <Button
              onClick={handleCopyLink}
              variant="secondary"
              className="flex items-center gap-2 flex-shrink-0"
            >
              {copied ? (
                <Check className="w-4 h-4" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}
      </div>

      {/* ===== Cover Image ===== */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8">
        <h3 className="text-xl font-bold text-gray-900 mb-6">Cover Image</h3>

        <div className="flex flex-col md:flex-row gap-8 items-start">
          {/* Cover Preview — updates live as title/subtitle/author/cover change */}
          <div className="w-full md:w-48 flex-shrink-0">
            <CoverPreview
              title={book.title}
              subtitle={book.subtitle}
              author={book.author}
              coverImage={book.coverImage}
              size="md"
              rounded="rounded-2xl"
              className="border border-gray-200 shadow-sm"
            />
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

      {/* ===== Export Template ===== */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8">
        <h3 className="text-xl font-bold text-gray-900 mb-2">Export Template</h3>
        <p className="text-gray-600 mb-6 leading-relaxed">
          Choose the look applied when you export as PDF, DOCX, or EPUB.
        </p>
        <ExportTemplatePicker
          value={book.templateId || "classic"}
          onChange={(templateId) =>
            onBookChange({ target: { name: "templateId", value: templateId } })
          }
        />
      </div>
    </div>
  );
};

export default BookDetailsTab;