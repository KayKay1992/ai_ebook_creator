import { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { Mail, Lock, User } from "lucide-react";
import toast from "react-hot-toast";

import InputField from "../components/ui/inputField";
import Button from "../components/ui/Button";
import KenlibsNav from "../components/kenlibs/KenlibsNav";
import { useAuth } from "../context/AuthContext";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";
import getErrorMessage from "../utils/getErrorMessage";

// New accounts created here default to role: 'reader' server-side
// (registerUser never reads a role from the request body — see
// authController.js) — there is no way for this form to create an admin.
const KenlibsSignupPage = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from;

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast.error("Passwords do not match");
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
      navigate(from || "/kenlibs");
    } catch (error) {
      toast.error(getErrorMessage(error, "Signup failed. Please try again."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <KenlibsNav />
      <div className="flex items-center justify-center px-6 py-16">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">Create your account</h1>
            <p className="text-gray-500 mt-2">Sign up to buy and read books on Kenlibs</p>
          </div>

          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8">
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
              <Button type="submit" className="w-full py-3.5 text-base" loading={loading}>
                Create Account
              </Button>
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default KenlibsSignupPage;
