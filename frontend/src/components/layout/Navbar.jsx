import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "../../context/AuthContext";
import ProfileDropdown from "./ProfileDropdown";
import { Menu, X, BookOpen, LogOut } from "lucide-react";

const Navbar = () => {
  const { user, isAuthenticated, logout } = useAuth();
  
  const [isOpen, setIsOpen] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  
  const dropdownRef = useRef(null);

  const navLinks = [
    { name: "Features", href: "#features" },
    { name: "Testimonials", href: "#testimonials" },
  ];

  // Close profile dropdown when clicking outside
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

  const handleLogout = useCallback(() => {
    logout();
    setProfileDropdownOpen(false);
    setIsOpen(false); // Close mobile menu too
  }, [logout]);

  return (
    <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo */}
          <a
            href="/"
            className="flex items-center space-x-2.5 group focus:outline-none focus:ring-2 focus:ring-violet-500 rounded-xl"
            aria-label="AI Book Creator Home"
          >
            <div className="w-9 h-9 bg-gradient-to-r from-violet-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-violet-500/30 transition-all group-hover:scale-105">
              <BookOpen className="w-5 h-5" />
            </div>
            <span className="text-xl font-semibold text-gray-900 tracking-tight">
              AI Book Creator
            </span>
          </a>

          {/* Desktop Navigation */}
          <nav className="hidden lg:flex items-center">
            <ul className="flex items-center space-x-8 text-sm font-medium text-gray-600">
              {navLinks.map((link) => (
                <li key={link.name}>
                  <a
                    href={link.href}
                    className="hover:text-violet-600 transition-colors py-2"
                  >
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* Desktop Auth */}
          <div className="hidden lg:flex items-center gap-3">
            {isAuthenticated ? (
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
                  userRole={user?.role || ""}
                  onLogout={handleLogout}
                />
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <a
                  href="/login"
                  className="px-5 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
                >
                  Log in
                </a>
                <a
                  href="/signup"
                  className="px-6 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 rounded-2xl shadow-md shadow-violet-500/30 transition-all active:scale-95"
                >
                  Get Started
                </a>
              </div>
            )}
          </div>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="lg:hidden p-2 rounded-xl text-gray-600 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-violet-500"
            aria-label="Toggle menu"
            aria-expanded={isOpen}
          >
            {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="lg:hidden border-t border-gray-100 bg-white">
          <nav className="px-6 py-4 flex flex-col space-y-1">
            {navLinks.map((link) => (
              <a
                key={link.name}
                href={link.href}
                className="block py-3 px-4 text-base font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 rounded-xl transition-colors"
                onClick={() => setIsOpen(false)}
              >
                {link.name}
              </a>
            ))}
          </nav>

          <div className="border-t border-gray-100 px-6 py-4">
            {isAuthenticated ? (
              <div className="space-y-4">
                {/* User Info */}
                <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 rounded-2xl">
                  <div className="w-10 h-10 bg-violet-100 text-violet-600 rounded-full flex items-center justify-center font-semibold text-lg">
                    {user?.name?.charAt(0)?.toUpperCase() || "U"}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">{user?.name}</div>
                    <div className="text-sm text-gray-500">{user?.email}</div>
                  </div>
                </div>

                {/* Logout Button */}
                <button
                  onClick={handleLogout}
                  className="flex w-full items-center justify-center gap-2 px-4 py-3 text-red-600 hover:bg-red-50 rounded-2xl transition-colors font-medium"
                >
                  <LogOut className="w-5 h-5" />
                  Log out
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <a
                  href="/login"
                  className="block px-4 py-3 text-center font-medium text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
                  onClick={() => setIsOpen(false)}
                >
                  Log in
                </a>
                <a
                  href="/signup"
                  className="block px-4 py-3 text-center font-semibold text-white bg-gradient-to-r from-violet-600 to-purple-600 rounded-xl hover:from-violet-700 hover:to-purple-700 transition-all"
                  onClick={() => setIsOpen(false)}
                >
                  Get Started
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

export default Navbar;