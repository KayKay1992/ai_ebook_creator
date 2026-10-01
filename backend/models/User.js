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
    // Set by an admin-initiated delete (adminController.js's deleteUser)
    // when the account has real purchase/referral history worth keeping for
    // accounting/dispute purposes — the account is anonymized in place
    // (name/email/password cleared to something unusable and unguessable)
    // rather than the User document being removed. `protect` rejects any
    // request for an isDeleted account outright, so this also cuts off an
    // already-issued JWT immediately rather than only blocking future
    // logins. A reader with zero history is hard-deleted instead and never
    // gets this flag at all — see deleteUser's own comment for the full
    // decision.
    isDeleted: {
        type: Boolean,
        default: false,
    },
    deletedAt: {
        type: Date,
    },
    // The admin's own receiving-account details — used both to show real
    // payment instructions to readers at checkout (see
    // kenlibsController.js's getCheckoutPaymentDetails, which deliberately
    // omits `notes`) and as the admin's own reference when sending refunds.
    // There's only ever one admin account in this app (see
    // KENLIBS-ARCHITECTURE.md), so this lives directly on the User document
    // rather than a separate singleton collection. `notes` is admin-only —
    // never returned by the reader-facing endpoint.
    paymentDetails: {
        bankName: { type: String, default: '' },
        accountNumber: { type: String, default: '' },
        accountHolderName: { type: String, default: '' },
        notes: { type: String, default: '' },
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