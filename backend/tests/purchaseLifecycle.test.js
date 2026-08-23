jest.mock('../utils/cloudinaryUpload', () => ({
    uploadBufferToCloudinary: jest.fn().mockResolvedValue({
        secure_url: 'https://res.cloudinary.com/fake/image/upload/mock-resubmit-evidence.png',
    }),
}));

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const { createUser, tokenFor, createBook, createPurchaseRequest } = require('./helpers');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('reject — only from pending', () => {
    it('rejects a pending request', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'pending' });

        const res = await request(app)
            .put(`/api/purchases/${pr._id}/reject`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ adminNote: 'blurry evidence' });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('rejected');
        expect(res.body.adminNote).toBe('blurry evidence');
    });

    it('refuses to reject a request that is already rejected', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'rejected' });

        const res = await request(app)
            .put(`/api/purchases/${pr._id}/reject`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/rejected/i);
    });

    it('refuses to reject an approved request', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });

        const res = await request(app)
            .put(`/api/purchases/${pr._id}/reject`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(400);
    });
});

describe('approve — from pending OR rejected, never from approved/revoked', () => {
    it.each(['pending', 'rejected'])('approves a request currently %s', async (fromStatus) => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: fromStatus });

        const res = await request(app)
            .put(`/api/purchases/${pr._id}/approve`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('approved');
    });

    it('refuses a no-op re-approval of an already-approved request', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });

        const res = await request(app)
            .put(`/api/purchases/${pr._id}/approve`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/approved/i);
    });

    it('refuses to approve a revoked request', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'revoked' });

        const res = await request(app)
            .put(`/api/purchases/${pr._id}/approve`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(400);
    });
});

describe('revoke — only from approved', () => {
    it('revokes an approved request', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });

        const res = await request(app)
            .put(`/api/purchases/${pr._id}/revoke`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('revoked');
    });

    it('refuses a no-op re-revoke of an already-revoked request', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'revoked' });

        const res = await request(app)
            .put(`/api/purchases/${pr._id}/revoke`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(400);
    });

    it.each(['pending', 'rejected'])('refuses to revoke a request currently %s', async (fromStatus) => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: fromStatus });

        const res = await request(app)
            .put(`/api/purchases/${pr._id}/revoke`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(400);
    });
});

describe('resubmit — only from rejected, only by the owning reader', () => {
    const attachEvidence = (req) =>
        req.attach('evidenceImage', Buffer.from('fresh-evidence-bytes'), 'new-evidence.png');

    it('resets a rejected request back to pending with new evidence', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'rejected' });

        const req = request(app)
            .put(`/api/purchases/${pr._id}/resubmit`)
            .set('Authorization', `Bearer ${tokenFor(reader)}`);
        const res = await attachEvidence(req);

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('pending');
        expect(res.body.evidenceImage).toBe(
            'https://res.cloudinary.com/fake/image/upload/mock-resubmit-evidence.png'
        );
    });

    it.each(['pending', 'approved', 'revoked'])('refuses to resubmit a request currently %s', async (fromStatus) => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: fromStatus });

        const req = request(app)
            .put(`/api/purchases/${pr._id}/resubmit`)
            .set('Authorization', `Bearer ${tokenFor(reader)}`);
        const res = await attachEvidence(req);

        expect(res.status).toBe(400);
    });

    it('refuses resubmit by a reader who does not own the request', async () => {
        const owner = await createUser({ role: 'reader' });
        const otherReader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader: owner, itemType: 'book', item: book._id, status: 'rejected' });

        const req = request(app)
            .put(`/api/purchases/${pr._id}/resubmit`)
            .set('Authorization', `Bearer ${tokenFor(otherReader)}`);
        const res = await attachEvidence(req);

        expect(res.status).toBe(403);
    });

    // Deliberate: resubmit is owner-gated, not adminOnly (see
    // purchaseRoute.js's comment) — an admin who isn't the request's own
    // reader gets the same 403 anyone else would.
    it('refuses resubmit by an admin who does not own the request', async () => {
        const owner = await createUser({ role: 'reader' });
        const admin = await createUser({ role: 'admin' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader: owner, itemType: 'book', item: book._id, status: 'rejected' });

        const req = request(app)
            .put(`/api/purchases/${pr._id}/resubmit`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);
        const res = await attachEvidence(req);

        expect(res.status).toBe(403);
    });

    it('requires an evidence image', async () => {
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'rejected' });

        const res = await request(app)
            .put(`/api/purchases/${pr._id}/resubmit`)
            .set('Authorization', `Bearer ${tokenFor(reader)}`);

        expect(res.status).toBe(400);
    });
});

describe('reviewHistory accumulates additively across the lifecycle', () => {
    it('records reject, then resubmit, then approve as three distinct entries', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook();
        const pr = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'pending' });

        await request(app)
            .put(`/api/purchases/${pr._id}/reject`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`)
            .send({ adminNote: 'unclear' });

        const resubmitReq = request(app)
            .put(`/api/purchases/${pr._id}/resubmit`)
            .set('Authorization', `Bearer ${tokenFor(reader)}`);
        await resubmitReq.attach('evidenceImage', Buffer.from('clearer-bytes'), 'clearer.png');

        const approveRes = await request(app)
            .put(`/api/purchases/${pr._id}/approve`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(approveRes.body.reviewHistory).toHaveLength(3);
        expect(approveRes.body.reviewHistory.map((h) => h.status)).toEqual([
            'rejected',
            'pending',
            'approved',
        ]);
    });
});
