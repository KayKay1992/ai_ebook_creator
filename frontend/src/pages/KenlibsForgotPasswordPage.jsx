import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, MailCheck } from "lucide-react";
import toast from "react-hot-toast";

import InputField from "../components/ui/inputField";
import Button from "../components/ui/Button";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import KenlibsFooter from "../components/kenlibs/KenlibsFooter";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import useDocumentTitle from "../hooks/useDocumentTitle";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

// Deliberately separate from the admin ForgotPasswordPage — same reasoning
// as KenlibsLoginPage.jsx vs LoginPage.jsx: same underlying
// forgot-password/reset-password endpoints, but Kenlibs-branded chrome so a
// reader who clicked "Forgot password?" from KenlibsLoginPage never lands on
// an unrelated-looking admin screen.
//
// Step 53: the backend now emails the reset link directly (never returns it
// in the response, and always responds with the same generic message
// whether or not the address has an account — see authController.js's
// forgotPassword) — so this just confirms the request went through and
// points the reader at their inbox, it can't show a "continue" button
// anymore.
const KenlibsForgotPasswordPage = () => {
  useDocumentTitle("Reset Password — Kenlibs");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await axiosInstance.post(API_PATHS.AUTH.FORGOT_PASSWORD, { email });
      setIsSubmitted(true);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't request a password reset"));
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
            <h1 className="text-3xl font-bold text-gray-900">Reset your password</h1>
            <p className="text-gray-500 mt-2">Enter your account email to get a reset link</p>
          </motion.div>

          <motion.div variants={fadeUp}>
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
              {!isSubmitted ? (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <InputField
                    type="email"
                    name="email"
                    label="Email Address"
                    placeholder="you@example.com"
                    icon={Mail}
                    onChange={(e) => setEmail(e.target.value)}
                    value={email}
                    required
                  />
                  <motion.div whileTap={{ scale: 0.98 }}>
                    <Button type="submit" className="w-full py-3.5 text-base" loading={loading}>
                      Send Reset Link
                    </Button>
                  </motion.div>
                </form>
              ) : (
                <div className="space-y-4 text-center">
                  <div className="w-12 h-12 rounded-full bg-accent/10 flex items-center justify-center mx-auto">
                    <MailCheck className="w-6 h-6 text-accent" />
                  </div>
                  <p className="text-sm text-gray-600">
                    If an account exists for <strong>{email}</strong>, a
                    password reset link has been sent. Check your inbox
                    (and spam folder) — the link expires in 1 hour.
                  </p>
                </div>
              )}

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
            </div>
          </motion.div>
        </motion.div>
      </div>
      <KenlibsFooter />
    </div>
  );
};

export default KenlibsForgotPasswordPage;
