export const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if(!email) return "Email is required";
    if (!emailRegex.test(email)) return "Invalid email address";
      return ''; // Valid email
};

export const validatePassword = (password) => {
  if(!password) return "Password is required";
    if (password.length < 6) return "Password must be at least 6 characters long";
  return ''; // Valid password
};