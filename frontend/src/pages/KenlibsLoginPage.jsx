import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence, useAnimation } from "framer-motion";
import { Mail, Lock, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";

import InputField from "../components/ui/inputField";
import Button from "../components/ui/Button";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import { useAuth } from "../context/AuthContext";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";
import useDocumentTitle from "../hooks/useDocumentTitle";

const SUCCESS_DISPLAY_MS = 700;

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } },
};

// Deliberately separate from the admin LoginPage — same underlying
// register/login endpoints and AuthContext, but shopper-facing copy, a
// Kenlibs-branded header, and (unlike the admin page) support for
// redirecting back to wherever the reader came from — e.g. Request to Buy
// on a book sends them here, then back to checkout after they sign in.
const KenlibsLoginPage = () => {
  useDocumentTitle("Log In — Kenlibs");
  const [formData, setFormData] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const cardControls = useAnimation();

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from;

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await axiosInstance.post(API_PATHS.AUTH.LOGIN, formData);
      const { token } = response.data;

      const profileResponse = await axiosInstance.get(API_PATHS.AUTH.PROFILE, {
        headers: { Authorization: `Bearer ${token}` },
      });

      login(profileResponse.data, token);
      toast.success("Welcome back!");
      setIsSuccess(true);
      setTimeout(
        () => navigate(from || (profileResponse.data.role === "admin" ? "/dashboard" : "/kenlibs")),
        SUCCESS_DISPLAY_MS
      );
    } catch (error) {
      toast.error(getErrorMessage(error, "Login failed. Please try again."));
      setLoading(false);
      // A short shake reinforces the toast without replacing it — the form
      // itself flags the problem, not just a transient notification.
      cardControls.start({
        x: [0, -8, 8, -6, 6, 0],
        transition: { duration: 0.4 },
      });
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
            <h1 className="text-3xl font-bold text-gray-900">Welcome back</h1>
            <p className="text-gray-500 mt-2">Sign in to continue to Kenlibs</p>
          </motion.div>

          <motion.div variants={fadeUp}>
            {/* Entrance (fade/slide) is driven by the parent's stagger via
                `variants` above; the shake below is a separate, imperative
                animation on this inner element so the two never fight over
                the `animate` prop. */}
            <motion.div
              animate={cardControls}
              className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 overflow-hidden"
            >
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
                  <p className="font-semibold text-gray-900">Welcome back!</p>
                </motion.div>
              ) : (
                <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <InputField
                      type="email"
                      name="email"
                      label="Email Address"
                      placeholder="you@example.com"
                      icon={Mail}
                      onChange={handleChange}
                      value={formData.email}
                      required
                    />
                    <InputField
                      type="password"
                      name="password"
                      label="Password"
                      placeholder="Enter your password"
                      icon={Lock}
                      onChange={handleChange}
                      value={formData.password}
                      required
                    />
                    <motion.div whileTap={{ scale: 0.98 }}>
                      <Button type="submit" className="w-full py-3.5 text-base" loading={loading}>
                        Sign In
                      </Button>
                    </motion.div>
                  </form>

                  <div className="text-center mt-6">
                    <p className="text-gray-600 text-sm">
                      New to Kenlibs?{" "}
                      <Link
                        to="/kenlibs/signup"
                        state={from ? { from } : undefined}
                        className="text-accent hover:text-accent-hover font-medium"
                      >
                        Create an account
                      </Link>
                    </p>
                  </div>
                </motion.div>
              )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
};

export default KenlibsLoginPage;
