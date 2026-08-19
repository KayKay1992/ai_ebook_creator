import React, { useState, useEffect, useRef } from "react";
import { BookOpen, Package, ShieldCheck, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import axiosInstance from "../../utils/axiosInstance";
import { API_PATHS } from "../../utils/apiPaths";
import ProfileDropdown from "./ProfileDropdown";

const DashboardLayout = ({ children }) => {
  const { user, logout } = useAuth();
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const dropdownRef = useRef(null);

  // A single fetch on layout mount (not a polling loop) just to badge the
  // nav link — cheap at this app's scale, and only fires for admins since
  // DashboardLayout is only ever rendered inside AdminRoute.
  useEffect(() => {
    if (user?.role !== "admin") return;
    axiosInstance
      .get(API_PATHS.PURCHASES.ALL)
      .then((res) => {
        setPendingCount(res.data.filter((r) => r.status === "pending").length);
      })
      .catch(() => {});
  }, [user?.role]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setProfileDropdownOpen(false);
      }
    };

    if (profileDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [profileDropdownOpen]);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            
            {/* Logo */}
            <Link 
              to="/dashboard" 
              className="flex items-center gap-3 group"
            >
              <div className="w-10 h-10 bg-gradient-to-br from-accent to-accent-secondary rounded-2xl flex items-center justify-center shadow-lg shadow-accent-500/20 group-hover:scale-105 transition-transform">
                <BookOpen className="w-5 h-5 text-white" />
              </div>
              <span className="text-xl font-bold text-gray-900 tracking-tight">
                AI Book Creator
              </span>
            </Link>

            {/* Admin nav */}
            <div className="flex items-center gap-1">
              {user?.role === "admin" && (
                <Link
                  to="/admin/bundles"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  <Package className="w-4 h-4" />
                  Bundles
                </Link>
              )}
              {user?.role === "admin" && (
                <Link
                  to="/admin/purchases"
                  className="relative flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Purchases
                  {pendingCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-white text-[10px] font-semibold flex items-center justify-center">
                      {pendingCount}
                    </span>
                  )}
                </Link>
              )}
              {user?.role === "admin" && (
                <Link
                  to="/admin/users"
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                >
                  <Users className="w-4 h-4" />
                  Users
                </Link>
              )}
            </div>

            {/* Profile Dropdown */}
            <div ref={dropdownRef}>
              <ProfileDropdown
                isOpen={profileDropdownOpen}
                onToggle={(e) => {
                  e.stopPropagation();
                  setProfileDropdownOpen(!profileDropdownOpen);
                }}
                avatar={user?.avatar || ""}
                companyName={user?.name || ""}
                email={user?.email || ""}
                onLogout={logout}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
        {children}
      </main>
    </div>
  );
};

export default DashboardLayout;