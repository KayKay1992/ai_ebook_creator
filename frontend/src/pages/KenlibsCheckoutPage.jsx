import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, UploadCloud, ShieldAlert, CheckCircle2, Wallet } from "lucide-react";
import toast from "react-hot-toast";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import KenlibsFooter from "../components/kenlibs/KenlibsFooter";
import CoverPreview from "../components/cards/CoverPreview";
import Button from "../components/ui/Button";
import { formatNaira, getBookBadge } from "../utils/kenlibsPricing";
import useDocumentTitle from "../hooks/useDocumentTitle";
import { useAuth } from "../context/AuthContext";

const VALID_TYPES = ["book", "bundle"];

// How long the success checkmark stays on screen before handing off to
// /kenlibs/my-books — long enough to register as confirmation, short
// enough not to feel like a delay.
const SUCCESS_DISPLAY_MS = 900;

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

const KenlibsCheckoutPage = () => {
  useDocumentTitle("Checkout — Kenlibs");
  const { itemType, id } = useParams();
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();

  const isValidType = VALID_TYPES.includes(itemType);

  const [item, setItem] = useState(null);
  // Only the valid-type branch actually fetches (and later flips this to
  // false) — an invalid itemType is never "loading" in the first place, so
  // there's no separate setState needed to resolve that branch.
  const [isLoading, setIsLoading] = useState(isValidType);
  const [evidenceFile, setEvidenceFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [applyCredit, setApplyCredit] = useState(false);
  const [creditToApply, setCreditToApply] = useState(0);

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
  const creditBalance = user?.creditBalance || 0;
  const maxApplicableCredit = Math.min(creditBalance, price || 0);
  const finalPrice = Math.max(0, (price || 0) - creditToApply);

  // Defaults to applying the maximum available the moment the toggle is
  // switched on — the reader can dial it down from there via the slider.
  // By the time this control is interactive, `item`/`price` have already
  // resolved (this section only renders past the loading/canBuy gates
  // below), so there's no need to re-sync this via an effect.
  const handleToggleApplyCredit = (checked) => {
    setApplyCredit(checked);
    setCreditToApply(checked ? maxApplicableCredit : 0);
  };

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
      if (creditToApply > 0) {
        formData.append("creditApplied", String(creditToApply));
      }

      const res = await axiosInstance.post(API_PATHS.PURCHASES.CREATE, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      // The server caps/deducts credit atomically and is the source of
      // truth — reflect back exactly what it actually applied, not what was
      // requested, in case the two ever diverge (stale balance, etc.).
      const actuallyApplied = res.data?.creditApplied || 0;
      if (actuallyApplied > 0) {
        updateUser({ creditBalance: Math.max(0, creditBalance - actuallyApplied) });
      }

      toast.success("Request submitted! We'll review it shortly.");
      setIsSubmitted(true);
      setTimeout(() => navigate("/kenlibs/my-books"), SUCCESS_DISPLAY_MS);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to submit your request"));
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-surface-warm">
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
      <div className="min-h-screen bg-surface-warm">
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
    <div className="min-h-screen bg-surface-warm">
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

        <motion.div
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.1 } } }}
        >
          {/* Item summary */}
          <motion.div
            variants={fadeUp}
            className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 flex items-center gap-4 mb-6"
          >
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
            <div className="flex-shrink-0 text-right">
              {creditToApply > 0 && (
                <p className="text-xs text-gray-400 line-through">{formatNaira(price)}</p>
              )}
              <span className="px-3 py-1.5 rounded-full text-sm font-semibold bg-accent text-white inline-block">
                {formatNaira(finalPrice)}
              </span>
            </div>
          </motion.div>

          {/* Store credit — only shown when there's actually a positive
              balance to apply. Capped server-side too; this is just the
              picker. */}
          {creditBalance > 0 && (
            <motion.div
              variants={fadeUp}
              className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-6"
            >
              <div className="flex items-center justify-between gap-4 mb-1">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyCredit}
                    onChange={(e) => handleToggleApplyCredit(e.target.checked)}
                    className="w-4 h-4 accent-accent"
                  />
                  <span className="flex items-center gap-2 font-semibold text-gray-900">
                    <Wallet className="w-4 h-4 text-accent" />
                    Apply store credit
                  </span>
                </label>
                <span className="text-sm text-gray-500">
                  {formatNaira(creditBalance)} available
                </span>
              </div>

              {applyCredit && (
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                  <input
                    type="range"
                    min={0}
                    max={maxApplicableCredit}
                    step={Math.min(50, maxApplicableCredit) || 1}
                    value={creditToApply}
                    onChange={(e) => setCreditToApply(Number(e.target.value))}
                    className="w-full accent-accent"
                  />
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">
                      Applying <span className="font-semibold text-gray-800">{formatNaira(creditToApply)}</span>
                    </span>
                    <span className="text-gray-500">
                      Final price:{" "}
                      <span className="font-semibold text-gray-900">{formatNaira(finalPrice)}</span>
                    </span>
                  </div>
                </div>
              )}
            </motion.div>
          )}

          {/* Payment instructions — placeholder static content; the admin
              fills in real bank details later. */}
          <motion.div
            variants={fadeUp}
            className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-6"
          >
            <h3 className="font-semibold text-gray-900 mb-3">Payment Instructions</h3>
            <div className="text-sm text-gray-600 leading-relaxed space-y-1 bg-gray-50 border border-gray-100 rounded-2xl p-4">
              <p>Bank Name: <span className="font-medium text-gray-800">[Your Bank Name]</span></p>
              <p>Account Name: <span className="font-medium text-gray-800">[Your Account Name]</span></p>
              <p>Account Number: <span className="font-medium text-gray-800">[Your Account Number]</span></p>
            </div>
            <p className="text-sm text-gray-500 mt-3">
              {finalPrice > 0 ? (
                <>
                  Transfer <span className="font-semibold text-gray-700">{formatNaira(finalPrice)}</span> to
                  the account above, then upload your proof of payment below.
                </>
              ) : (
                "Your store credit fully covers this — still upload any proof of payment to submit the request."
              )}
            </p>
          </motion.div>

          {/* Evidence upload + submit — swaps for a success checkmark once
              the request lands, instead of jumping straight to /my-books. */}
          <motion.div
            variants={fadeUp}
            className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 overflow-hidden"
          >
            <AnimatePresence mode="wait">
              {isSubmitted ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center text-center py-6"
                >
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4"
                  >
                    <CheckCircle2 className="w-8 h-8 text-emerald-500" />
                  </motion.div>
                  <p className="font-semibold text-gray-900">Request submitted!</p>
                  <p className="text-sm text-gray-500 mt-1">Taking you to My Books…</p>
                </motion.div>
              ) : (
                <motion.form
                  key="form"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  onSubmit={handleSubmit}
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

                  <p className="text-xs text-gray-400 mt-5 leading-relaxed">
                    By submitting, you agree to Kenlibs'{" "}
                    <Link to="/kenlibs/terms" className="text-accent hover:text-accent-hover font-medium">
                      Terms of Service
                    </Link>
                    ,{" "}
                    <Link to="/kenlibs/privacy" className="text-accent hover:text-accent-hover font-medium">
                      Privacy Policy
                    </Link>
                    , and{" "}
                    <Link
                      to="/kenlibs/refund-policy"
                      className="text-accent hover:text-accent-hover font-medium"
                    >
                      Refund Policy
                    </Link>
                    .
                  </p>

                  <motion.div whileTap={{ scale: 0.98 }}>
                    <Button
                      type="submit"
                      loading={isSubmitting}
                      className="w-full mt-3 py-3.5 text-base"
                    >
                      Submit Request
                    </Button>
                  </motion.div>
                </motion.form>
              )}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </div>
      <KenlibsFooter />
    </div>
  );
};

export default KenlibsCheckoutPage;
