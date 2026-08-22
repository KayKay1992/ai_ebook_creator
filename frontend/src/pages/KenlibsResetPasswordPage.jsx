import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Lock, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";

import InputField from "../components/ui/inputField";
import Button from "../components/ui/Button";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import useDocumentTitle from "../hooks/useDocumentTitle";

const SUCCESS_REDIRECT_MS = 1800;

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

// Kenlibs-branded counterpart to ResetPasswordPage.jsx — see that file's
// comment for why these are deliberately separate pages. Reads the token
// straight from the URL and, like the admin version, does not auto-login on
// success — sends the reader back through a real sign-in instead.
const KenlibsResetPasswordPage = () => {
  useDocumentTitle("Set New Password — Kenlibs");
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      await axiosInstance.post(API_PATHS.AUTH.RESET_PASSWORD(token), { password });
      setIsSuccess(true);
      setTimeout(() => navigate("/kenlibs/login"), SUCCESS_REDIRECT_MS);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't reset your password"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface-warm">
      <KenlibsNav />
      <div className="flex items-center justify-center px-6 py-16">
        <motion.div
          className="max-w-md w-full"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.08 } } }}
        >
          <motion.div className="text-center mb-8" variants={fadeUp}>
            <h1 className="text-3xl font-bold text-gray-900">Set a new password</h1>
            <p className="text-gray-500 mt-2">Choose a new password for your account</p>
          </motion.div>

          <motion.div variants={fadeUp}>
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 overflow-hidden">
              <AnimatePresence mode="wait">
                {isSuccess ? (
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
                    <p className="font-semibold text-gray-900">Password updated!</p>
                    <p className="text-sm text-gray-500 mt-1">Taking you to sign in…</p>
                  </motion.div>
                ) : (
                  <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <form onSubmit={handleSubmit} className="space-y-5">
                      <InputField
                        type="password"
                        name="password"
                        label="New Password"
                        placeholder="At least 6 characters"
                        icon={Lock}
                        onChange={(e) => setPassword(e.target.value)}
                        value={password}
                        required
                      />
                      <InputField
                        type="password"
                        name="confirmPassword"
                        label="Confirm New Password"
                        placeholder="Re-enter your new password"
                        icon={Lock}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        value={confirmPassword}
                        required
                      />
                      <motion.div whileTap={{ scale: 0.98 }}>
                        <Button type="submit" className="w-full py-3.5 text-base" loading={loading}>
                          Reset Password
                        </Button>
                      </motion.div>
                    </form>

                    <div className="text-center mt-6">
                      <p className="text-gray-600 text-sm">
                        <Link
                          to="/kenlibs/login"
                          className="text-accent hover:text-accent-hover font-medium"
                        >
                          Back to sign in
                        </Link>
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default KenlibsResetPasswordPage;
