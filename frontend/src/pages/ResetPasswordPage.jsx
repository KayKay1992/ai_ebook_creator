import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Lock, BookOpen, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";

import InputField from "../components/ui/inputField";
import Button from "../components/ui/Button";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";

// How long the success state stays up before sending the user to sign in
// with their new password — long enough to read, short enough not to stall.
const SUCCESS_REDIRECT_MS = 1800;

// Reads the reset token straight from the URL (see ForgotPasswordPage.jsx —
// no email delivery exists yet, so that page links here directly instead of
// the token arriving via a real emailed link). Deliberately does NOT log the
// user in on success — a password reset is a security-sensitive action, so
// sending them back through a real login with the new password is a
// deliberate, explicit checkpoint rather than a silent auto-login.
const ResetPasswordPage = () => {
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
      setTimeout(() => navigate("/login"), SUCCESS_REDIRECT_MS);
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't reset your password"));
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
          <h1 className="text-4xl font-bold text-gray-900">Set New Password</h1>
          <p className="text-gray-600 mt-3">Choose a new password for your account</p>
        </div>

        <div className="bg-white rounded-3xl shadow-2xl p-8 border border-gray-100">
          {isSuccess ? (
            <div className="flex flex-col items-center text-center py-6">
              <div className="w-14 h-14 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <p className="font-semibold text-gray-900">Password updated!</p>
              <p className="text-sm text-gray-500 mt-1">Taking you to sign in…</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
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
              <Button type="submit" className="w-full py-3.5 text-base" loading={loading}>
                Reset Password
              </Button>
            </form>
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

export default ResetPasswordPage;
