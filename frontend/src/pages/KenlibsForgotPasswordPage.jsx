import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, AlertTriangle, ArrowRight } from "lucide-react";
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
// TEMPORARY, NOT PRODUCTION-SAFE: no email service is wired up yet (see
// authController.js's forgotPassword), so the backend hands the raw reset
// token back in this request's response instead of emailing it privately.
// This page shows it on-screen and links straight to the reset form as a
// stand-in for "check your email" — anyone who can see this screen can
// reset the account. Replace with real email delivery before production use.
const KenlibsForgotPasswordPage = () => {
  useDocumentTitle("Reset Password — Kenlibs");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetToken, setResetToken] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await axiosInstance.post(API_PATHS.AUTH.FORGOT_PASSWORD, { email });
      setResetToken(response.data.resetToken);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't generate a reset token"));
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
              {!resetToken ? (
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
                <div className="space-y-5">
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 text-amber-700 text-xs rounded-2xl px-4 py-3">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <span>
                      No email service is configured yet — in production
                      this link would be emailed to you privately, not shown
                      here. Anyone who sees this screen can reset this
                      account.
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    A reset token was generated for <strong>{email}</strong>.
                    Continue to set a new password:
                  </p>
                  <Link to={`/kenlibs/reset-password/${resetToken}`}>
                    <Button className="w-full py-3.5 text-base flex items-center justify-center gap-2">
                      Continue to Reset Password
                      <ArrowRight className="w-4 h-4" />
                    </Button>
                  </Link>
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
