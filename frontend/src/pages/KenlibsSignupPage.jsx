import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { motion, AnimatePresence, useAnimation } from "framer-motion";
import { Mail, Lock, User, CheckCircle2 } from "lucide-react";
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

// New accounts created here default to role: 'reader' server-side
// (registerUser never reads a role from the request body — see
// authController.js) — there is no way for this form to create an admin.
const KenlibsSignupPage = () => {
  useDocumentTitle("Sign Up — Kenlibs");
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
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

  const shake = () => {
    cardControls.start({ x: [0, -8, 8, -6, 6, 0], transition: { duration: 0.4 } });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast.error("Passwords do not match");
      shake();
      return;
    }

    setLoading(true);
    try {
      const registerResponse = await axiosInstance.post(API_PATHS.AUTH.REGISTER, {
        name: formData.name,
        email: formData.email,
        password: formData.password,
      });

      // Auto-login right after signup — a shopper shouldn't have to fill
      // out the login form a second time to reach checkout.
      const { token } = registerResponse.data;
      const profileResponse = await axiosInstance.get(API_PATHS.AUTH.PROFILE, {
        headers: { Authorization: `Bearer ${token}` },
      });

      login(profileResponse.data, token);
      toast.success("Account created!");
      setIsSuccess(true);
      setTimeout(() => navigate(from || "/kenlibs"), SUCCESS_DISPLAY_MS);
    } catch (error) {
      toast.error(getErrorMessage(error, "Signup failed. Please try again."));
      setLoading(false);
      shake();
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <KenlibsNav />
      <div className="flex items-center justify-center px-6 py-16">
        <motion.div
          className="max-w-md w-full"
          initial="hidden"
          animate="show"
          variants={{ show: { transition: { staggerChildren: 0.08 } } }}
        >
          <motion.div className="text-center mb-8" variants={fadeUp}>
            <h1 className="text-3xl font-bold text-gray-900">Create your account</h1>
            <p className="text-gray-500 mt-2">Sign up to buy and read books on Kenlibs</p>
          </motion.div>

          <motion.div variants={fadeUp}>
            {/* Entrance is driven by the parent's stagger via `variants`
                above; the shake below is a separate, imperative animation
                on this inner element so the two never fight over `animate`. */}
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
                    <p className="font-semibold text-gray-900">Account created!</p>
                  </motion.div>
                ) : (
                  <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <form onSubmit={handleSubmit} className="space-y-5">
                      <InputField
                        type="text"
                        name="name"
                        label="Full Name"
                        placeholder="Jane Doe"
                        icon={User}
                        onChange={handleChange}
                        value={formData.name}
                        required
                      />
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
                        placeholder="Create a password"
                        icon={Lock}
                        onChange={handleChange}
                        value={formData.password}
                        required
                      />
                      <InputField
                        type="password"
                        name="confirmPassword"
                        label="Confirm Password"
                        placeholder="Confirm your password"
                        icon={Lock}
                        onChange={handleChange}
                        value={formData.confirmPassword}
                        required
                      />
                      <motion.div whileTap={{ scale: 0.98 }}>
                        <Button type="submit" className="w-full py-3.5 text-base" loading={loading}>
                          Create Account
                        </Button>
                      </motion.div>
                    </form>

                    <div className="text-center mt-6">
                      <p className="text-gray-600 text-sm">
                        Already have an account?{" "}
                        <Link
                          to="/kenlibs/login"
                          state={from ? { from } : undefined}
                          className="text-accent hover:text-accent-hover font-medium"
                        >
                          Sign in
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

export default KenlibsSignupPage;
