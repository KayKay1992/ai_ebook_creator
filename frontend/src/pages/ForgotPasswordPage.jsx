import { useState } from "react";
import { Link } from "react-router-dom";
import { Mail, BookOpen, MailCheck } from "lucide-react";
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
// Step 53: the backend now emails the reset link directly (never returns it
// in the response, and always responds with the same generic message
// whether or not the address has an account — see authController.js's
// forgotPassword) — so this just confirms the request went through and
// points the admin at their inbox, it can't show a "continue" button
// anymore.
const ForgotPasswordPage = () => {
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
          {!isSubmitted ? (
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
            <div className="space-y-4 text-center">
              <div className="w-12 h-12 rounded-full bg-accent-50 flex items-center justify-center mx-auto">
                <MailCheck className="w-6 h-6 text-accent" />
              </div>
              <p className="text-sm text-gray-600">
                If an account exists for <strong>{email}</strong>, a
                password reset link has been sent. Check your inbox (and
                spam folder) — the link expires in 1 hour.
              </p>
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
