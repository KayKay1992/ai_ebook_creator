const jwt = require('jsonwebtoken');
const User = require('../models/User');

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
        console.error("REGISTER ERROR →", error);   // ← Add this line
        res.status(500).json({ 
            message: 'Server Error', 
            error: error.message     // temporary – remove later
        });
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
    const user = await User.findById(req.user.id);
    if (user) {
        res.json({
            _id: user._id,
            name: user.name,
            email: user.email,
            isPro: user.isPro,
            avatar: user.avatar,
        });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
};

//@desc update user profile
//@route PUT /api/auth/profile
//@access Private
const updateUserProfile = async (req, res) => {
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
            token: generateToken(updatedUser._id),
        });
    } else {
        res.status(404).json({ message: 'User not found' });
    }
};

module.exports = {
    registerUser,
    loginUser,
    getProfile,
    updateUserProfile,
};