import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, BookOpen, AlertTriangle, ArrowRight } from "lucide-react";
import toast from "react-hot-toast";

import InputField from "../components/ui/inputField";
import Button from "../components/ui/Button";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";

// Mirrors LoginPage.jsx's chrome exactly (same gradient background, same
// icon badge/card shape) — this is reached from LoginPage's own "Forgot
// password?" link, so it should read as the same surface, not a jump to an
// unrelated page.
//
// TEMPORARY, NOT PRODUCTION-SAFE: no email service is wired up yet (see
// authController.js's forgotPassword), so the backend hands the raw reset
// token back in this request's response instead of emailing it privately.
// This page shows it on-screen and links straight to the reset form as a
// stand-in for "check your email" — anyone who can see this screen can
// reset the account. Replace with real email delivery before production use.
const ForgotPasswordPage = () => {
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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-accent-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-10">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-accent to-accent-secondary rounded-3xl flex items-center justify-center shadow-xl">
              <BookOpen className="w-9 h-9 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-gray-900">Reset Password</h1>
          <p className="text-gray-600 mt-3">
            Enter your account email to get a reset link
          </p>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl p-8 border border-gray-100">
          {!resetToken ? (
            <form onSubmit={handleSubmit} className="space-y-6">
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
              <Button type="submit" className="w-full py-3.5 text-base" loading={loading}>
                Send Reset Link
              </Button>
            </form>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 text-amber-700 text-xs rounded-2xl px-4 py-3">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span>
                  No email service is configured yet — in production this
                  link would be emailed to you privately, not shown here.
                  Anyone who sees this screen can reset this account.
                </span>
              </div>
              <p className="text-sm text-gray-600">
                A reset token was generated for <strong>{email}</strong>.
                Continue to set a new password:
              </p>
              <Link to={`/reset-password/${resetToken}`}>
                <Button className="w-full py-3.5 text-base flex items-center justify-center gap-2">
                  Continue to Reset Password
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          )}

          <div className="text-center mt-8">
            <p className="text-gray-600">
              <Link to="/login" className="text-accent hover:text-accent-hover font-medium">
                Back to Sign In
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
