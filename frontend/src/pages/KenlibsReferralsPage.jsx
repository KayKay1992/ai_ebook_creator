import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Copy, Check, Gift, Users } from "lucide-react";
import toast from "react-hot-toast";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import KenlibsFooter from "../components/kenlibs/KenlibsFooter";
import { formatNaira } from "../utils/kenlibsPricing";
import useDocumentTitle from "../hooks/useDocumentTitle";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

const KenlibsReferralsPage = () => {
  useDocumentTitle("Referrals — Kenlibs");
  const [summary, setSummary] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchSummary = async () => {
      try {
        const res = await axiosInstance.get(API_PATHS.REFERRALS.MINE);
        setSummary(res.data);
      } catch {
        setSummary(null);
      } finally {
        setIsLoading(false);
      }
    };
    fetchSummary();
  }, []);

  const referralLink = summary?.referralCode
    ? `${window.location.origin}/kenlibs/signup?ref=${summary.referralCode}`
    : "";

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast.success("Referral link copied!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy — please copy it manually.");
    }
  };

  return (
    <div className="min-h-screen bg-surface-warm">
      <KenlibsNav />

      <div className="max-w-3xl mx-auto px-6 lg:px-8 py-12">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Referrals</h1>
        <p className="text-gray-500 mb-8">
          Share your link — when someone you refer completes their first approved purchase,
          you earn store credit toward your own.
        </p>

        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-32 bg-white border border-gray-100 rounded-3xl" />
            <div className="h-20 bg-white border border-gray-100 rounded-2xl" />
          </div>
        ) : !summary ? (
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-10 text-center text-gray-500">
            Couldn't load your referral details. Please try again shortly.
          </div>
        ) : (
          <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.08 } } }}>
            <motion.div
              variants={fadeUp}
              className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 mb-6"
            >
              <p className="text-sm font-medium text-gray-500 mb-2">Your referral link</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={referralLink}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 px-4 py-3 rounded-2xl bg-gray-50 border border-gray-100 text-sm text-gray-700 truncate"
                />
                <motion.button
                  whileTap={{ scale: 0.96 }}
                  onClick={handleCopy}
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-3 rounded-2xl text-sm font-semibold text-white bg-gradient-to-r from-accent to-accent-secondary"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? "Copied" : "Copy"}
                </motion.button>
              </div>

              <div className="mt-6 pt-6 border-t border-gray-100 flex items-center gap-3">
                <div className="w-11 h-11 rounded-2xl bg-accent-50 flex items-center justify-center flex-shrink-0">
                  <Gift className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <p className="text-xs text-gray-500">Your store credit balance</p>
                  <p className="text-xl font-bold text-gray-900">{formatNaira(summary.creditBalance)}</p>
                </div>
              </div>
            </motion.div>

            <motion.div variants={fadeUp}>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-900 mb-3">
                <Users className="w-4 h-4 text-gray-400" />
                Successful referrals
              </h2>

              {summary.rewards.length === 0 ? (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 text-center text-gray-500 text-sm">
                  No referral rewards yet — share your link above to start earning credit.
                </div>
              ) : (
                <div className="space-y-3">
                  {summary.rewards.map((reward) => (
                    <div
                      key={reward._id}
                      className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between gap-4"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 truncate">{reward.referredReaderName}</p>
                        <p className="text-xs text-gray-400">
                          {new Date(reward.createdAt).toLocaleDateString()}
                        </p>
                      </div>
                      <span className="flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-semibold bg-emerald-50 text-emerald-700">
                        +{formatNaira(reward.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </div>
      <KenlibsFooter />
    </div>
  );
};

export default KenlibsReferralsPage;
