import { useState } from "react";
import { useNavigate } from "react-router-dom";
import InputField from "../ui/inputField";
import Button from "../ui/Button";
import { UploadCloud, Globe, Lock, Copy, Check, Mic, Palette, Tag } from "lucide-react";
import toast from "react-hot-toast";
import ExportTemplatePicker from "./ExportTemplatePicker";
import CoverPreview from "../cards/CoverPreview";
import TonePicker from "../shared/TonePicker";

const BookDetailsTab = ({
  book,
  onBookChange,
  onCoverUpload,
  isUploading,
  fileInputRef,
  onTogglePublish,
  isTogglingPublish,
}) => {
  const navigate = useNavigate();
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

      {/* ===== Voice & Tone ===== */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8">
        <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
          <Mic className="w-5 h-5 text-gray-400" />
          Voice & Tone
        </h3>
        <p className="text-gray-600 mb-6 leading-relaxed">
          Applied consistently to every AI-generated chapter from now on.
          Changing this doesn't rewrite chapters you've already generated.
        </p>

        <TonePicker
          value={book.voiceProfile?.tones || []}
          onChange={(tones) =>
            onBookChange({ target: { name: "voiceProfile", value: { tones } } })
          }
        />

        {book.voiceProfile?.instruction && (
          <p className="mt-4 text-sm text-gray-500 italic bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
            "{book.voiceProfile.instruction}"
          </p>
        )}
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

      {/* ===== Kenlibs Listing ===== */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8">
        <h3 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
          <Tag className="w-5 h-5 text-gray-400" />
          Kenlibs Pricing
        </h3>
        <p className="text-gray-600 mb-4 leading-relaxed">
          Sets whether a <span className="font-medium">Buy</span> button appears
          on Kenlibs and what it costs. This does{" "}
          <span className="font-medium">not</span> control whether the book
          shows up on the storefront at all — that's decided entirely by the{" "}
          <span className="font-medium">Publish</span> status above. A published
          book with no price set is still visible, just shown as
          "coming soon" instead of purchasable.
        </p>

        {!isPublished && (
          <div className="mb-6 flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
            <Lock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800 leading-relaxed">
              This book is still a draft. Pricing it now won't make it appear
              on Kenlibs — publish it above first.
            </p>
          </div>
        )}

        <div className="space-y-6">
          <div className="max-w-xs">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Price (NGN)
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">
                ₦
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={book.price ?? ""}
                onChange={(e) =>
                  onBookChange({
                    target: {
                      name: "price",
                      value: e.target.value === "" ? null : Number(e.target.value),
                    },
                  })
                }
                placeholder="Not priced yet"
                className="w-full bg-gray-50 border border-gray-200 rounded-2xl pl-8 pr-4 py-3 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-accent-500 focus:ring-1 focus:ring-accent-500 transition-all duration-200"
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-gray-700">Purchasable</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {book.isForSale
                  ? "Shows a Buy button on Kenlibs, once published."
                  : "No Buy button — readers can browse it but not purchase it."}
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                onBookChange({ target: { name: "isForSale", value: !book.isForSale } })
              }
              className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${
                book.isForSale ? "bg-accent" : "bg-gray-300"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  book.isForSale ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* ===== Cover Image ===== */}
      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
          <h3 className="text-xl font-bold text-gray-900">Cover Image</h3>
          <Button
            onClick={() => navigate(`/editor/${book._id}/cover`)}
            variant="secondary"
            className="flex items-center gap-2"
          >
            <Palette className="w-4 h-4" />
            Design Full Cover
          </Button>
        </div>

        <div className="flex flex-col md:flex-row gap-8 items-start">
          {/* Cover Preview — updates live as title/subtitle/author/cover change */}
          <div className="w-full md:w-48 flex-shrink-0">
            <CoverPreview
              title={book.title}
              subtitle={book.subtitle}
              author={book.author}
              coverImage={book.coverImage}
              coverDesign={book.coverDesign}
              size="md"
              rounded="rounded-2xl"
              className="border border-gray-200 shadow-sm"
            />
          </div>

          {/* Upload Section */}
          <div className="flex-1">
            <p className="text-gray-600 mb-6 leading-relaxed">
              Upload a quick cover image here, or use the{" "}
              <span className="font-medium">Design Full Cover</span> button
              above for a complete front and back cover with a blurb, author
              bio, and review quotes.
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