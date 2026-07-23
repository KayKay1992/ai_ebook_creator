import React from "react";

const InputField = ({ 
  icon: Icon, 
  label, 
  ...props 
}) => {
  return (
    <div className="space-y-1.5">
      {label && (
        <label 
          htmlFor={props.id || props.name} 
          className="block text-sm font-medium text-gray-700"
        >
          {label}
        </label>
      )}
      
      <div className="relative">
        {Icon && (
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
            <Icon className="w-5 h-5" />
          </div>
        )}
        
        <input
          {...props}
          className="w-full bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3.5 pl-11 
                     text-gray-900 placeholder:text-gray-400 
                     focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 
                     transition-all duration-200"
        />
      </div>
    </div>
  );
};

export default InputField;