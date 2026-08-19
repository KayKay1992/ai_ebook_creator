import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ArrowLeft, UploadCloud, ShieldAlert } from "lucide-react";
import toast from "react-hot-toast";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import CoverPreview from "../components/cards/CoverPreview";
import Button from "../components/ui/Button";
import { formatNaira, getBookBadge } from "../utils/kenlibsPricing";
import useDocumentTitle from "../hooks/useDocumentTitle";

const VALID_TYPES = ["book", "bundle"];

const KenlibsCheckoutPage = () => {
  useDocumentTitle("Checkout — Kenlibs");
  const { itemType, id } = useParams();
  const navigate = useNavigate();

  const isValidType = VALID_TYPES.includes(itemType);

  const [item, setItem] = useState(null);
  // Only the valid-type branch actually fetches (and later flips this to
  // false) — an invalid itemType is never "loading" in the first place, so
  // there's no separate setState needed to resolve that branch.
  const [isLoading, setIsLoading] = useState(isValidType);
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isValidType) return;

    const fetchItem = async () => {
      try {
        const base =
          itemType === "book" ? API_PATHS.PUBLIC.KENLIBS_BOOK : API_PATHS.PUBLIC.KENLIBS_BUNDLE;
        const res = await axiosInstance.get(`${base}/${id}`);
        setItem(res.data);
      } catch {
        setItem(null);
      } finally {
        setIsLoading(false);
      }
    };
    fetchItem();
  }, [itemType, id, isValidType]);

  // Bundles are always purchasable once the (isForSale-gated) fetch above
  // succeeds — a book additionally needs the price/isForSale badge check,
  // same rule as the storefront and detail pages.
  const canBuy =
    itemType === "bundle" ? !!item : itemType === "book" && item && getBookBadge(item)?.type === "price";
  const price = item?.price;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!evidenceFile) {
      toast.error("Please upload proof of payment first.");
      return;
    }

    setIsSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("itemType", itemType);
      formData.append("item", id);
      formData.append("evidenceImage", evidenceFile);

      await axiosInstance.post(API_PATHS.PURCHASES.CREATE, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      toast.success("Request submitted! We'll review it shortly.");
      navigate("/kenlibs/my-books");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to submit your request"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <KenlibsNav />
        <div className="max-w-2xl mx-auto px-6 py-16 animate-pulse space-y-4">
          <div className="h-8 bg-gray-100 rounded-lg w-1/2" />
          <div className="h-64 bg-gray-100 rounded-2xl w-full" />
        </div>
      </div>
    );
  }

  if (!isValidType || !item || !canBuy) {
    return (
      <div className="min-h-screen bg-gray-50">
        <KenlibsNav />
        <div className="flex flex-col items-center justify-center py-32 text-center px-6">
          <div className="w-20 h-20 bg-accent-50 rounded-3xl flex items-center justify-center mb-6">
            <ShieldAlert className="w-10 h-10 text-accent-500" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-3">
            This isn't available for purchase
          </h2>
          <p className="text-gray-500 max-w-md mb-8">
            It may have been unlisted, or the link may be incorrect.
          </p>
          <Link to="/kenlibs">
            <Button className="flex items-center gap-2">
              <ArrowLeft className="w-4 h-4" />
              Back to Kenlibs
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <KenlibsNav />

      <div className="max-w-2xl mx-auto px-6 lg:px-8 py-12">
        <Link
          to={`/kenlibs/${itemType}/${id}`}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 mb-6">Checkout</h1>

        {/* Item summary */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 flex items-center gap-4 mb-6">
          <div className="w-16 flex-shrink-0">
            <CoverPreview
              title={item.title}
              author={item.author}
              coverImage={item.coverImage}
              coverDesign={item.coverDesign}
              size="sm"
              rounded="rounded-lg"
            />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-serif font-semibold text-gray-900 truncate">{item.title}</h2>
            {itemType === "book" && item.author && (
              <p className="text-sm text-gray-500">{item.author}</p>
            )}
          </div>
          <span className="px-3 py-1.5 rounded-full text-sm font-semibold bg-accent text-white flex-shrink-0">
            {formatNaira(price)}
          </span>
        </div>

        {/* Payment instructions — placeholder static content; the admin
            fills in real bank details later. */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-3">Payment Instructions</h3>
          <div className="text-sm text-gray-600 leading-relaxed space-y-1 bg-gray-50 border border-gray-100 rounded-2xl p-4">
            <p>Bank Name: <span className="font-medium text-gray-800">[Your Bank Name]</span></p>
            <p>Account Name: <span className="font-medium text-gray-800">[Your Account Name]</span></p>
            <p>Account Number: <span className="font-medium text-gray-800">[Your Account Number]</span></p>
          </div>
          <p className="text-sm text-gray-500 mt-3">
            Transfer <span className="font-semibold text-gray-700">{formatNaira(price)}</span> to
            the account above, then upload your proof of payment below.
          </p>
        </div>

        {/* Evidence upload + submit */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6"
        >
          <h3 className="font-semibold text-gray-900 mb-3">Proof of Payment</h3>

          <label className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-2xl py-10 cursor-pointer hover:border-accent-300 hover:bg-accent-50/30 transition-colors">
            <UploadCloud className="w-8 h-8 text-gray-400" />
            <span className="text-sm text-gray-600">
              {evidenceFile ? evidenceFile.name : "Click to upload a screenshot or photo"}
            </span>
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setEvidenceFile(e.target.files?.[0] || null)}
            />
          </label>

          <Button type="submit" loading={isSubmitting} className="w-full mt-6 py-3.5 text-base">
            Submit Request
          </Button>
        </form>
      </div>
    </div>
  );
};

export default KenlibsCheckoutPage;
