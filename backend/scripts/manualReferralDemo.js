// One-off manual verification script for the referral system (Step 46) —
// NOT part of the app, safe to delete after review. Runs the real app.js
// through real HTTP request/response cycles (via supertest, already a
// devDependency) against a throwaway in-memory MongoDB — never the real
// Atlas database — and prints every relevant value at each step so the
// numbers can be eyeballed directly, not just asserted in Jest.
process.env.JWT_SECRET = 'manual-demo-jwt-secret';
process.env.NODE_ENV = 'test';

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');

// Same intent as the Jest suite's jest.mock('../utils/cloudinaryUpload', ...)
// — this plain script has no jest.mock, so the require-cache is pre-seeded
// directly, before app.js (and its transitive dependents) ever require the
// real module. No real Cloudinary credentials are used anywhere here.
const cloudinaryUploadPath = require.resolve('../utils/cloudinaryUpload');
require.cache[cloudinaryUploadPath] = {
    id: cloudinaryUploadPath,
    filename: cloudinaryUploadPath,
    loaded: true,
    exports: {
        uploadBufferToCloudinary: async () => ({
            secure_url: 'https://res.cloudinary.com/fake/image/upload/manual-demo-evidence.png',
        }),
    },
};

const log = (label, value) => console.log(`\n== ${label} ==`, value === undefined ? '' : value);

const run = async () => {
    const mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());

    const app = require('../app');
    const api = request(app);

    // --- Reader A registers (will become the referrer) ---
    const registerA = await api.post('/api/auth/register').send({
        name: 'Reader A',
        email: 'reader-a@example.com',
        password: 'password123',
    });
    const profileA = await api.get('/api/auth/profile').set('Authorization', `Bearer ${registerA.body.token}`);
    log('Reader A registered — referralCode', profileA.body.referralCode);
    log('Reader A initial creditBalance', profileA.body.creditBalance);

    const referralLink = `https://kenlibs.example/kenlibs/signup?ref=${profileA.body.referralCode}`;
    log('Reader A shares this referral link', referralLink);

    // --- Reader B signs up via A's referral link ---
    const registerB = await api
        .post(`/api/auth/register?ref=${profileA.body.referralCode}`)
        .send({ name: 'Reader B', email: 'reader-b@example.com', password: 'password123' });
    const tokenB = registerB.body.token;
    const profileB = await api.get('/api/auth/profile').set('Authorization', `Bearer ${tokenB}`);
    log('Reader B registered via referral link — status', registerB.status);
    log(
        "Reader B creditBalance (should be 0, they're the referred, not the referrer)",
        profileB.body.creditBalance
    );

    // --- Admin creates purchasable books ---
    const adminRegister = await api
        .post('/api/auth/register')
        .send({ name: 'The Admin', email: 'admin@example.com', password: 'password123' });
    // No public "become admin" path exists (by design) — set the role
    // directly via the same DB write backend/scripts/setAdmin.js uses.
    const User = require('../models/User');
    await User.updateOne({ email: 'admin@example.com' }, { role: 'admin' });
    const adminLogin = await api.post('/api/auth/login').send({ email: 'admin@example.com', password: 'password123' });
    const tokenAdmin = adminLogin.body.token;
    const adminUser = await User.findOne({ email: 'admin@example.com' });

    const Book = require('../models/Book');
    const makeBook = (title, price) =>
        Book.create({
            userId: adminUser._id,
            title,
            author: 'A. Uthor',
            status: 'published',
            isForSale: true,
            price,
            chapters: [{ title: 'Chapter 1', content: 'Hello.' }],
        });

    const book1 = await makeBook('The Manual Demo Book', 2000);
    log('Book #1 created, price', book1.price);

    // --- Reader B buys book #1 (first purchase) ---
    const purchase1 = await api
        .post('/api/purchases')
        .set('Authorization', `Bearer ${tokenB}`)
        .field('itemType', 'book')
        .field('item', book1._id.toString())
        .attach('evidenceImage', Buffer.from('fake-bytes'), 'evidence.png');
    log('Reader B purchase #1 created — status/amount/creditApplied', {
        status: purchase1.status,
        amount: purchase1.body.amount,
        creditApplied: purchase1.body.creditApplied,
    });

    // --- Admin approves purchase #1 ---
    const approve1 = await api.put(`/api/purchases/${purchase1.body._id}/approve`).set('Authorization', `Bearer ${tokenAdmin}`);
    log('Purchase #1 approved — status', approve1.status);

    const profileAAfter1 = await api.get('/api/auth/profile').set('Authorization', `Bearer ${registerA.body.token}`);
    log(
        "Reader A creditBalance after B's FIRST approved purchase (expect 5% of 2000 = 100)",
        profileAAfter1.body.creditBalance
    );

    const referralsA = await api.get('/api/referrals/me').set('Authorization', `Bearer ${registerA.body.token}`);
    log('Reader A GET /api/referrals/me', referralsA.body);

    // --- Reader B buys a second book (should NOT grant A additional credit) ---
    const book2 = await makeBook('The Manual Demo Book II', 5000);
    const purchase2 = await api
        .post('/api/purchases')
        .set('Authorization', `Bearer ${tokenB}`)
        .field('itemType', 'book')
        .field('item', book2._id.toString())
        .attach('evidenceImage', Buffer.from('fake-bytes'), 'evidence.png');
    const approve2 = await api.put(`/api/purchases/${purchase2.body._id}/approve`).set('Authorization', `Bearer ${tokenAdmin}`);
    log('Purchase #2 (second purchase by referred reader B) approved — status', approve2.status);

    const profileAAfter2 = await api.get('/api/auth/profile').set('Authorization', `Bearer ${registerA.body.token}`);
    log(
        "Reader A creditBalance after B's SECOND approved purchase (expect UNCHANGED, still 100)",
        profileAAfter2.body.creditBalance
    );

    const referralsA2 = await api.get('/api/referrals/me').set('Authorization', `Bearer ${registerA.body.token}`);
    log('Reader A rewards list length (expect still 1)', referralsA2.body.rewards.length);

    // --- Reader A applies their earned credit toward a purchase of their own ---
    const book3 = await makeBook('The Manual Demo Book III', 1500);
    const purchase3 = await api
        .post('/api/purchases')
        .set('Authorization', `Bearer ${registerA.body.token}`)
        .field('itemType', 'book')
        .field('item', book3._id.toString())
        .field('creditApplied', '100') // A's full earned balance
        .attach('evidenceImage', Buffer.from('fake-bytes'), 'evidence.png');
    log('Reader A applies their 100 credit at checkout for a 1500 book — amount/creditApplied', {
        amount: purchase3.body.amount,
        creditApplied: purchase3.body.creditApplied,
        effectivePrice: purchase3.body.amount - purchase3.body.creditApplied,
    });

    const profileAFinal = await api.get('/api/auth/profile').set('Authorization', `Bearer ${registerA.body.token}`);
    log('Reader A creditBalance after applying credit at checkout (expect 0)', profileAFinal.body.creditBalance);

    await mongoose.disconnect();
    await mongod.stop();
    console.log('\nDone.');
};

run().catch((err) => {
    console.error(err);
    process.exit(1);
});
