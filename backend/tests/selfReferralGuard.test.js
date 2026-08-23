// The self-referral guard in authController.js's registerUser is defensive
// by the user's own admission: `referrer` is always resolved from an
// ALREADY-EXISTING User document, before the new account is even created,
// so `referrer._id` can never actually equal the new account's `_id`
// through the real HTTP flow — there's no way to construct that collision
// against a real, honestly-behaving Mongo instance. To still exercise the
// guard itself (not just assert it's unreachable), this file mocks the
// User model to simulate the collision directly and calls the controller
// function in isolation. Every other test file in this suite intentionally
// avoids mocking the ODM — this is the one deliberate exception, scoped to
// its own file, for exactly this reason.
jest.mock('../models/User', () => ({
    findOne: jest.fn(),
    create: jest.fn(),
}));
jest.mock('../utils/referralCode', () => ({
    generateReferralCode: jest.fn().mockResolvedValue('WOULDBEUNIQUE'),
}));

const mongoose = require('mongoose');
const User = require('../models/User');
const { registerUser } = require('../controller/authController');

describe('registerUser — self-referral guard', () => {
    it("nulls out referredBy if the resolved referrer's id ever collided with the new user's own id", async () => {
        const collidingId = new mongoose.Types.ObjectId();

        User.findOne
            .mockResolvedValueOnce(null) // "does a user with this email already exist" check
            .mockResolvedValueOnce({ _id: collidingId }); // the referral-code lookup

        const savedUser = {
            _id: collidingId,
            referredBy: collidingId,
            save: jest.fn().mockResolvedValue(true),
        };
        User.create.mockResolvedValue(savedUser);

        const req = {
            body: { name: 'Self Referrer', email: 'self-referrer@example.com', password: 'password123' },
            query: { ref: 'OWN-CODE' },
        };
        const json = jest.fn();
        const res = { status: jest.fn(() => ({ json })) };

        await registerUser(req, res);

        expect(savedUser.referredBy).toBeNull();
        expect(savedUser.save).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(201);
    });
});
