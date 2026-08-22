const express = require("express");
const {
  registerUser,
  loginUser,
  getProfile,
  updateUserProfile,
  forgotPassword,
  resetPassword,
} = require("../controller/authController");
const { protect } = require("../middleware/authMiddleware");

const router = express.Router();

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post("/register", registerUser);

// @route   POST /api/auth/login
// @desc    Login a user
// @access  Public
router.post("/login", loginUser);

// @route   GET /api/auth/profile
// @desc    Get current user profile
// @access  Private
router.get("/profile", protect, getProfile);

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put("/profile", protect, updateUserProfile);

// @route   POST /api/auth/forgot-password
// @desc    Request a password reset token (see authController.js's TODO —
//          not production-safe until real email delivery is wired up)
// @access  Public
router.post("/forgot-password", forgotPassword);

// @route   POST /api/auth/reset-password/:token
// @desc    Complete a password reset with a valid token
// @access  Public
router.post("/reset-password/:token", resetPassword);

module.exports = router;
