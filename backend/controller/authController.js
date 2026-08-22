const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');

// Shared by both the self-service (forgotPassword below) and admin-initiated
// (adminController.js's resetUserPassword) reset paths, so the two can never
// drift into different token formats/lifetimes.
const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

const generateResetToken = async (user) => {
    const token = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + RESET_TOKEN_TTL_MS;
    await user.save();
    return token;
};

//Helpers: Generate JWT Token
const generateToken = (id) => {
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: '30d',
    });
};

//@desc    Register a new user
//@route   POST /api/auth/register
//@access  Public
const registerUser = async (req, res) => {
    const { name, email, password } = req.body;

    try {
        // Validate user data
        if (!name || !email || !password) {
            return res.status(400).json({ message: 'Please provide all required fields' });
        }

        // Check if user already exists
        const userExists = await User.findOne({ email });
        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }

        // Create new user
        const user = await User.create({
            name,
            email,
            password,
        });

        if (user) {
            res.status(201).json({
                message: 'User registered successfully',
                token: generateToken(user._id),
            });
        } else {
            res.status(400).json({ message: 'Invalid user data' });
        }
    } catch (error) {
        console.error("REGISTER ERROR →", error);
        res.status(500).json({ message: 'Registration failed. Please try again.' });
    }
};

//@desc login a user
//@route POST /api/auth/login
//@access Public
const loginUser = async (req, res) => {
    const { email, password } = req.body;

    try {
        const user = await User.findOne({ email }).select('+password');
        if (user && (await user.matchPassword(password))) {
            res.json({
                message: 'Login successful',
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                token: generateToken(user._id),
            });
        } else {
            res.status(400).json({ message: 'Invalid credentials' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc get curreent logged in user
//@route GET /api/auth/profile
//@access Private
const getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user) {
            res.json({
                _id: user._id,
                name: user.name,
                email: user.email,
                isPro: user.isPro,
                avatar: user.avatar,
                role: user.role,
            });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc update user profile
//@route PUT /api/auth/profile
//@access Private
const updateUserProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        if (user) {
            user.name = req.body.name || user.name;
            user.email = req.body.email || user.email;
            if (req.body.password) {
                user.password = req.body.password;
            }
            const updatedUser = await user.save();
            res.json({
                _id: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                isPro: updatedUser.isPro,
                avatar: updatedUser.avatar,
                role: updatedUser.role,
                token: generateToken(updatedUser._id),
            });
        } else {
            res.status(404).json({ message: 'User not found' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Request a password reset token for the given email.
//
//         TODO — SECURITY, MUST FIX BEFORE PRODUCTION: no email service is
//         wired up yet, so this hands the raw reset token back in the HTTP
//         response instead of emailing it privately to the account owner.
//         That means anyone who can see this response (browser devtools, a
//         proxy, a shared screen) can reset this account's password — this
//         is NOT a secure reset flow as-is. Before any real/production use,
//         wire up a real provider (e.g. SendGrid, Resend, Postmark) to send
//         the reset link to the user's actual inbox, and stop returning
//         `resetToken` from this endpoint.
//@route   POST /api/auth/forgot-password
//@access  Public
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: 'No account found for that email' });
        }

        const resetToken = await generateResetToken(user);

        res.status(200).json({
            message: 'Password reset token generated.',
            resetToken,
        });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Complete a password reset using a valid, unexpired token.
//@route   POST /api/auth/reset-password/:token
//@access  Public
const resetPassword = async (req, res) => {
    try {
        const { token } = req.params;
        const { password } = req.body;

        if (!password || password.length < 6) {
            return res.status(400).json({ message: 'Password must be at least 6 characters' });
        }

        const user = await User.findOne({
            resetPasswordToken: token,
            resetPasswordExpires: { $gt: Date.now() },
        });

        if (!user) {
            return res.status(400).json({ message: 'This reset link is invalid or has expired' });
        }

        user.password = password; // pre-save hook rehashes
        user.resetPasswordToken = undefined;
        user.resetPasswordExpires = undefined;
        await user.save();

        res.status(200).json({ message: 'Password has been reset. You can now log in with your new password.' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = {
    registerUser,
    loginUser,
    getProfile,
    updateUserProfile,
    forgotPassword,
    resetPassword,
    generateResetToken,
};