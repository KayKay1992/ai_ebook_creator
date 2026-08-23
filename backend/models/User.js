//models/user.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true,
        minlength: 6,
        select: false
    },
    avatar: {
        type: String,
        default: '',
    },
    isPro:{
        type: Boolean,
        default: false
    },
    // Gates access to the whole app surface (see AdminRoute/ReaderRoute on
    // the frontend and KENLIBS-ARCHITECTURE.md). Deliberately no
    // self-service way to become 'admin' — only set directly in the
    // database via backend/scripts/setAdmin.js, never through a public
    // form or request body.
    role: {
        type: String,
        enum: ['admin', 'reader'],
        default: 'reader',
    },
    // Password reset (self-service forgot-password and admin-initiated
    // reset — see controller/authController.js and adminController.js).
    // select: false for the same reason as `password` above: neither should
    // ever come back in a normal find()/findById() unless explicitly asked
    // for via .select('+resetPasswordToken'). Both cleared on successful
    // reset (or left to just expire on their own via resetPasswordExpires).
    resetPasswordToken: {
        type: String,
        select: false,
    },
    resetPasswordExpires: {
        type: Date,
        select: false,
    },
    // Referral system (see controller/purchaseController.js's reward logic
    // and utils/referralCode.js). `sparse: true` on referralCode matters —
    // existing pre-referral-system accounts have no code, and a plain
    // unique index would reject a second `null`/missing value (this is the
    // same sparse-index lesson noted elsewhere in this project).
    referralCode: {
        type: String,
        unique: true,
        sparse: true,
    },
    // Set once at signup from a valid ?ref=CODE link and never changed
    // afterward — a reader's referrer is fixed for the lifetime of the
    // account.
    referredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
    // Store credit earned from referral rewards, in Naira — applicable
    // toward this user's own future purchases (see
    // purchaseController.js's createPurchaseRequest).
    creditBalance: {
        type: Number,
        default: 0,
    },
},
    {
        timestamps: true
    }
);

//Password hashing middleware
// Password hashing middleware
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

//method to compare password
userSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};
const User = mongoose.model('User', userSchema);

module.exports = User;