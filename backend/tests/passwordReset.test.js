const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const User = require('../models/User');
const { createUser, tokenFor, uniqueEmail } = require('./helpers');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('self-service password reset — full round trip', () => {
    it('lets a reader request a reset, use the token, and log in with the new password', async () => {
        const email = uniqueEmail('self-reset');
        await createUser({ email, password: 'OldPass123' });

        // Old password works before the reset.
        const preLogin = await request(app).post('/api/auth/login').send({ email, password: 'OldPass123' });
        expect(preLogin.status).toBe(200);

        const forgotRes = await request(app).post('/api/auth/forgot-password').send({ email });
        expect(forgotRes.status).toBe(200);
        const { resetToken } = forgotRes.body;
        expect(resetToken).toEqual(expect.any(String));

        const resetRes = await request(app)
            .post(`/api/auth/reset-password/${resetToken}`)
            .send({ password: 'NewPass456' });
        expect(resetRes.status).toBe(200);

        const oldLogin = await request(app).post('/api/auth/login').send({ email, password: 'OldPass123' });
        expect(oldLogin.status).toBe(400);

        const newLogin = await request(app).post('/api/auth/login').send({ email, password: 'NewPass456' });
        expect(newLogin.status).toBe(200);
    });

    it('rejects reusing the same token a second time', async () => {
        const email = uniqueEmail('reuse-token');
        await createUser({ email, password: 'OldPass123' });

        const { body } = await request(app).post('/api/auth/forgot-password').send({ email });
        await request(app).post(`/api/auth/reset-password/${body.resetToken}`).send({ password: 'FirstNew123' });

        const secondAttempt = await request(app)
            .post(`/api/auth/reset-password/${body.resetToken}`)
            .send({ password: 'SecondNew456' });

        expect(secondAttempt.status).toBe(400);
        expect(secondAttempt.body.message).toMatch(/invalid or has expired/i);
    });

    it('rejects an expired token', async () => {
        const email = uniqueEmail('expired-token');
        const user = await createUser({ email, password: 'OldPass123' });

        // Set up an expired token directly — faster and more precise than
        // waiting out the real 1-hour TTL.
        user.resetPasswordToken = 'a-token-that-has-expired';
        user.resetPasswordExpires = Date.now() - 1000; // 1 second in the past
        await user.save();

        const res = await request(app)
            .post('/api/auth/reset-password/a-token-that-has-expired')
            .send({ password: 'NewPass456' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/invalid or has expired/i);
    });

    it('rejects a request for an email that does not exist', async () => {
        const res = await request(app)
            .post('/api/auth/forgot-password')
            .send({ email: uniqueEmail('never-registered') });
        expect(res.status).toBe(404);
    });

    it('rejects a new password shorter than 6 characters', async () => {
        const email = uniqueEmail('short-pw');
        await createUser({ email, password: 'OldPass123' });
        const { body } = await request(app).post('/api/auth/forgot-password').send({ email });

        const res = await request(app)
            .post(`/api/auth/reset-password/${body.resetToken}`)
            .send({ password: '123' });

        expect(res.status).toBe(400);
    });
});

describe('admin-initiated password reset', () => {
    it('lets an admin generate a reset token for a reader, which the reader can use', async () => {
        const admin = await createUser({ role: 'admin' });
        const email = uniqueEmail('admin-reset-target');
        const reader = await createUser({ email, password: 'ReaderOldPass1', role: 'reader' });

        const adminRes = await request(app)
            .post(`/api/admin/users/${reader._id}/reset-password`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(adminRes.status).toBe(200);
        expect(adminRes.body.resetToken).toEqual(expect.any(String));

        const resetRes = await request(app)
            .post(`/api/auth/reset-password/${adminRes.body.resetToken}`)
            .send({ password: 'ReaderNewPass2' });
        expect(resetRes.status).toBe(200);

        const oldLogin = await request(app)
            .post('/api/auth/login')
            .send({ email, password: 'ReaderOldPass1' });
        expect(oldLogin.status).toBe(400);

        const newLogin = await request(app)
            .post('/api/auth/login')
            .send({ email, password: 'ReaderNewPass2' });
        expect(newLogin.status).toBe(200);
    });

    it('rejects a non-admin (reader) calling the admin reset endpoint', async () => {
        const reader = await createUser({ role: 'reader' });
        const target = await createUser({ role: 'reader' });

        const res = await request(app)
            .post(`/api/admin/users/${target._id}/reset-password`)
            .set('Authorization', `Bearer ${tokenFor(reader)}`);

        expect(res.status).toBe(403);
    });

    it('rejects an unauthenticated request to the admin reset endpoint', async () => {
        const target = await createUser({ role: 'reader' });
        const res = await request(app).post(`/api/admin/users/${target._id}/reset-password`);
        expect(res.status).toBe(401);
    });

    it('404s for a nonexistent user id', async () => {
        const admin = await createUser({ role: 'admin' });
        const fakeId = new (require('mongoose').Types.ObjectId)();

        const res = await request(app)
            .post(`/api/admin/users/${fakeId}/reset-password`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(res.status).toBe(404);
    });
});
