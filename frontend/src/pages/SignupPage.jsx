import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Mail, Lock, User, BookOpen } from "lucide-react";
import toast from "react-hot-toast";

import InputField from "../components/ui/InputField";
import Button from "../components/ui/Button";
import { useAuth } from "../context/AuthContext";
import axiosInstance from "../utils/axiosInstance";
import { API_PATHS } from "../utils/apiPaths";

const SignupPage = () => {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

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
      const response = await axiosInstance.post(API_PATHS.AUTH.REGISTER, {
        name: formData.name,
        email: formData.email,
        password: formData.password,
      });

      toast.success("Account created successfully!");
      navigate("/login");
    } catch (error) {
      toast.error(error.response?.data?.message || "Signup failed. Please try again.");
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
          <h1 className="text-4xl font-bold text-gray-900">Create Account</h1>
          <p className="text-gray-600 mt-3">Join thousands of creators building amazing books</p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-3xl shadow-2xl p-8 border border-gray-100">
          <form onSubmit={handleSubmit} className="space-y-6">
            <InputField
              type="text"
              name="name"
              label="Full Name"
              placeholder="John Doe"
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
              placeholder="Create a strong password"
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

          <div className="text-center mt-8">
            <p className="text-gray-600">
              Already have an account?{" "}
              <Link to="/login" className="text-violet-600 hover:text-violet-700 font-medium">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignupPage;