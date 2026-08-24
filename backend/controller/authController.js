const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { generateReferralCode } = require('../utils/referralCode');
const { sendPasswordResetEmail } = require('../utils/sendEmail');

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

// Shared by both reset flows so the actual URL shape only ever lives in one
// place — points at the Kenlibs-branded reset page (KenlibsResetPasswordPage),
// not the admin one, since every reader who could receive this email reaches
// the app through the Kenlibs surface.
const buildResetLink = (token) =>
    `${process.env.FRONTEND_URL || 'http://localhost:5173'}/kenlibs/reset-password/${token}`;

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
    const { ref } = req.query;

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

        // Resolved *before* the new account exists — an invalid/unknown
        // code is silently ignored rather than failing the signup.
        let referrer = null;
        if (ref) {
            referrer = await User.findOne({ referralCode: ref });
        }

        const referralCode = await generateReferralCode(name);

        // Create new user
        const user = await User.create({
            name,
            email,
            password,
            referralCode,
            referredBy: referrer ? referrer._id : null,
        });

        // Defensive only — `referrer` is always resolved before this
        // account exists, so it can never actually equal `user._id`. Kept
        // in case that resolution order ever changes.
        if (user.referredBy && user.referredBy.toString() === user._id.toString()) {
            user.referredBy = null;
            await user.save();
        }

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
                referralCode: user.referralCode,
                creditBalance: user.creditBalance,
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

//@desc    Request a password reset for the given email — sends the reset
//         link to the account's real inbox via sendPasswordResetEmail
//         (Step 53; previously this handed the raw token back in the HTTP
//         response, which anyone who could see that response could use to
//         reset the account).
//
//         Always returns the same generic response whether or not an
//         account exists for that email — a different response (e.g. a 404
//         only for unknown emails) would let someone enumerate which email
//         addresses have accounts here just by calling this endpoint
//         repeatedly.
//@route   POST /api/auth/forgot-password
//@access  Public
const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }

        const user = await User.findOne({ email });
        if (user) {
            try {
                const resetToken = await generateResetToken(user);
                await sendPasswordResetEmail({ to: user.email, resetLink: buildResetLink(resetToken) });
            } catch (emailError) {
                // The token is already saved on the user regardless — if
                // the email genuinely never arrives, it just goes unused
                // and expires normally in an hour. Logged, not surfaced:
                // a different response here (e.g. "email failed to send")
                // would itself leak that this address has an account,
                // defeating the enumeration protection above.
                console.error('Failed to send password reset email:', emailError);
            }
        }

        res.status(200).json({
            message: 'If an account exists for that email, a password reset link has been sent.',
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
    buildResetLink,
};