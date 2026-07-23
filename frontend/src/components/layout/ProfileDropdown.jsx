import React from 'react';
import { ChevronDown, User, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const ProfileDropdown = ({
  onToggle,
  isOpen,
  avatar,
  companyName,
  email,
  onLogout
}) => {
  const navigate = useNavigate();

  return (
    <div className="relative">
      {/* Trigger Button */}
      <button
        onClick={onToggle}
        className="flex items-center gap-3 px-3 py-2 rounded-2xl hover:bg-gray-100 transition-all group"
      >
        {/* Avatar */}
        <div className="w-9 h-9 rounded-2xl overflow-hidden border-2 border-white shadow-sm">
          {avatar ? (
            <img 
              src={avatar} 
              alt="User Avatar" 
              className="w-full h-full object-cover" 
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
              <span className="text-white font-semibold text-lg">
                {companyName ? companyName.charAt(0).toUpperCase() : "U"}
              </span>
            </div>
          )}
        </div>

        {/* User Info */}
        <div className="text-left hidden md:block">
          <p className="font-medium text-gray-900 text-sm">{companyName}</p>
          <p className="text-gray-500 text-xs">{email}</p>
        </div>

        {/* Chevron */}
        <ChevronDown 
          className={`w-4 h-4 text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} 
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-white rounded-3xl shadow-xl border border-gray-100 py-2 z-50">
          {/* User Info in Dropdown */}
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl overflow-hidden border-2 border-white shadow-sm flex-shrink-0">
                {avatar ? (
                  <img src={avatar} alt="User" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                    <span className="text-white font-semibold text-2xl">
                      {companyName?.charAt(0).toUpperCase() || "U"}
                    </span>
                  </div>
                )}
              </div>
              <div>
                <p className="font-semibold text-gray-900">{companyName}</p>
                <p className="text-sm text-gray-500">{email}</p>
              </div>
            </div>
          </div>

          {/* Menu Items */}
          <div className="py-2">
            <button
              onClick={() => {
                navigate('/profile');
                onToggle(); // Close dropdown
              }}
              className="w-full flex items-center gap-3 px-5 py-3 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <User className="w-5 h-5" />
              <span>View Profile</span>
            </button>

            <button
              onClick={() => {
                onLogout();
                onToggle(); // Close dropdown
              }}
              className="w-full flex items-center gap-3 px-5 py-3 text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-5 h-5" />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProfileDropdown;