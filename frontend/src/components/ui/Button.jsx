import React from "react";

const Button = ({
  variant = "primary",
  size = "md",
  loading = false,
  children,
  className = "",
  ...props
}) => {
  const variants = {
    primary: "bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white shadow-lg shadow-violet-500/30",
    secondary: "bg-gray-100 text-gray-800 hover:bg-gray-200",
  };

  const sizes = {
    sm: "px-5 py-2.5 text-sm rounded-2xl",
    md: "px-8 py-3.5 text-base rounded-3xl font-semibold",
    lg: "px-10 py-4 text-lg rounded-3xl",
  };

  return (
    <button
      className={`inline-flex items-center justify-center font-medium transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed ${variants[variant]} ${sizes[size]} ${className}`}
      disabled={loading}
      {...props}
    >
      {loading ? (
        <svg 
          className="animate-spin h-5 w-5 text-white" 
          xmlns="http://www.w3.org/2000/svg" 
          fill="none" 
          viewBox="0 0 24 24"
        >
          <circle 
            className="opacity-25" 
            cx="12" 
            cy="12" 
            r="10" 
            stroke="currentColor" 
            strokeWidth="4"
          ></circle>
          <path 
            className="opacity-75" 
            fill="currentColor" 
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      ) : (
        children
      )}
    </button>
  );
};

export default Button;