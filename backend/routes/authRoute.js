const express = require("express");
const {
  registerUser,
  loginUser,
  getProfile,
  updateUserProfile,
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

module.exports = router;
