import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Lock, BookOpen } from "lucide-react";
import toast from "react-hot-toast";

import InputField from "../components/ui/InputField";
import Button from "../components/ui/Button";
import { useAuth } from "../context/AuthContext";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";

const LoginPage = () => {
  const [formData, setFormData] = useState({
    email: "",
    password: "",
  });
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

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
      navigate("/dashboard");
    } catch (error) {
      toast.error(
        error.response?.data?.message || "Login failed. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-violet-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-gradient-to-br from-violet-600 to-purple-600 rounded-3xl flex items-center justify-center shadow-xl">
              <BookOpen className="w-9 h-9 text-white" />
            </div>
          </div>
          <h1 className="text-4xl font-bold text-gray-900">Welcome Back</h1>
          <p className="text-gray-600 mt-3">
            Sign in to continue your creative journey
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-3xl shadow-2xl p-8 border border-gray-100">
          <form onSubmit={handleSubmit} className="space-y-6">
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

            <Button
              type="submit"
              className="w-full py-3.5 text-base"
              loading={loading}
            >
              Sign In
            </Button>
          </form>

          <div className="text-center mt-8">
            <p className="text-gray-600">
              Don't have an account?{" "}
              <Link
                to="/signup"
                className="text-violet-600 hover:text-violet-700 font-medium"
              >
                Sign up for free
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
