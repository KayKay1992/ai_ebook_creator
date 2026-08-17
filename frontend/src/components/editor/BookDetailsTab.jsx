import InputField from "../ui/inputField";
import Button from "../ui/Button";
import { UploadCloud } from "lucide-react";
import ExportTemplatePicker from "./ExportTemplatePicker";
import CoverPreview from "../cards/CoverPreview";

const BookDetailsTab = ({
  book,
  onBookChange,
  onCoverUpload,
  isUploading,
  fileInputRef,
}) => {
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