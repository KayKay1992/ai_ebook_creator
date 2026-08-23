const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Book = require('../models/Book');
const Bundle = require('../models/Bundle');
const PurchaseRequest = require('../models/PurchaseRequest');

// Fixture factories used across every test file — deliberately built with
// the Mongoose models directly rather than through the HTTP API, so a test
// exercising (say) the purchase lifecycle isn't also implicitly depending on
// book-creation or registration behavior working correctly. Only the
// behavior actually under test goes through supertest.

let emailCounter = 0;
const uniqueEmail = (prefix = 'user') => `${prefix}-${Date.now()}-${emailCounter++}@example.com`;

const createUser = async (overrides = {}) => {
    return User.create({
        name: overrides.name || 'Test User',
        email: overrides.email || uniqueEmail(overrides.role || 'user'),
        password: overrides.password || 'password123',
        role: overrides.role || 'reader',
    });
};

const tokenFor = (user) => jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

const createBook = async (overrides = {}) => {
    let userId = overrides.userId;
    if (!userId) {
        const admin = await createUser({ role: 'admin' });
        userId = admin._id;
    }
    return Book.create({
        userId,
        title: overrides.title || 'Test Book',
        author: overrides.author || 'Test Author',
        status: overrides.status || 'published',
        isForSale: overrides.isForSale ?? true,
        // `??` would silently turn an explicitly-passed `price: null` back
        // into 1000 — some tests deliberately pass null to exercise the
        // "book with no price set" rejection path, so presence in
        // `overrides` (not nullishness of the value) decides the default.
        price: 'price' in overrides ? overrides.price : 1000,
        chapters: overrides.chapters || [{ title: 'Chapter 1', content: 'Hello world.' }],
    });
};

const createBundle = async (overrides = {}) => {
    return Bundle.create({
        title: overrides.title || 'Test Bundle',
        books: overrides.books || [],
        price: overrides.price ?? 2000,
        isForSale: overrides.isForSale ?? true,
    });
};

// Bypasses the review flow entirely — for tests that need an
// already-approved purchase as a precondition (e.g. reading-access or
// ratings tests) rather than as the thing actually under test.
const createPurchaseRequest = async ({ reader, itemType, item, amount = 1000, status = 'pending' }) => {
    return PurchaseRequest.create({
        reader: reader._id,
        itemType,
        item,
        amount,
        evidenceImage: 'https://res.cloudinary.com/fake/image/upload/fixture-evidence.png',
        status,
        ...(status !== 'pending' ? { reviewedAt: new Date() } : {}),
    });
};

module.exports = {
    uniqueEmail,
    createUser,
    tokenFor,
    createBook,
    createBundle,
    createPurchaseRequest,
};
