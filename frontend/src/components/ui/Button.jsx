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
    primary: "bg-gradient-to-r from-accent to-accent-secondary hover:from-accent-hover hover:to-accent-secondary-hover text-white shadow-lg shadow-accent-500/30",
    secondary: "bg-gray-100 text-gray-800 hover:bg-gray-200",
    // Solid colors, deliberately with no gradient/background-image at all
    // (unlike primary) — a `className="bg-red-500 ..."` override on
    // variant="primary" looks like it should work but doesn't: the
    // primary variant's background-image gradient still paints on top of
    // an overridden background-color, since they're different CSS
    // properties, not a single class Tailwind can resolve a conflict
    // between. These exist so a destructive/warning action can actually
    // render as a plain color, not fall back to looking primary.
    danger: "bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30",
    warning: "bg-amber-500 hover:bg-amber-600 text-white shadow-lg shadow-amber-500/30",
  };

  const sizes = {
    sm: "px-5 py-2.5 text-sm rounded-2xl",
    md: "px-8 py-3.5 text-base rounded-3xl font-semibold",
    lg: "px-10 py-4 text-lg rounded-3xl",
    // Reserved for genuinely promotional CTAs (Kenlibs "Request to Buy",
    // the reading-completion certificate moment — see Step 39) — bigger and
    // bolder than lg, not a general-purpose size, so nothing existing opts
    // into it by default.
    xl: "px-11 py-5 text-lg rounded-3xl font-extrabold tracking-tight",
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