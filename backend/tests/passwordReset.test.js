// Real email delivery (Step 53) is mocked here, same reasoning as
// cloudinaryUpload's mock elsewhere in this suite — no test ever needs (or
// should risk) actually sending mail through the real Gmail SMTP transport.
// The mock lets tests assert *who* an email was sent to without caring how
// it's actually delivered.
jest.mock('../utils/sendEmail', () => ({
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    sendEmail: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const User = require('../models/User');
const { sendPasswordResetEmail } = require('../utils/sendEmail');
const { createUser, tokenFor, uniqueEmail } = require('./helpers');

beforeAll(async () => db.connect());
afterEach(async () => {
    await db.clearDatabase();
    sendPasswordResetEmail.mockClear();
});
afterAll(async () => db.closeDatabase());

// forgotPassword/resetUserPassword no longer hand the token back in the
// HTTP response (Step 53 — it's emailed instead) — tests read it straight
// off the User document, the same source of truth the real email's link is
// built from.
const readTokenFor = async (email) => {
    const user = await User.findOne({ email }).select('+resetPasswordToken');
    return user.resetPasswordToken;
};

describe('self-service password reset — full round trip', () => {
    it('lets a reader request a reset, use the token, and log in with the new password', async () => {
        const email = uniqueEmail('self-reset');
        await createUser({ email, password: 'OldPass123' });

        // Old password works before the reset.
        const preLogin = await request(app).post('/api/auth/login').send({ email, password: 'OldPass123' });
        expect(preLogin.status).toBe(200);

        const forgotRes = await request(app).post('/api/auth/forgot-password').send({ email });
        expect(forgotRes.status).toBe(200);
        expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
        expect(sendPasswordResetEmail.mock.calls[0][0].to).toBe(email);

        const resetToken = await readTokenFor(email);
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

        await request(app).post('/api/auth/forgot-password').send({ email });
        const resetToken = await readTokenFor(email);
        await request(app).post(`/api/auth/reset-password/${resetToken}`).send({ password: 'FirstNew123' });

        const secondAttempt = await request(app)
            .post(`/api/auth/reset-password/${resetToken}`)
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

    it('returns the same generic response for an email that does not exist — no account enumeration', async () => {
        const res = await request(app)
            .post('/api/auth/forgot-password')
            .send({ email: uniqueEmail('never-registered') });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/if an account exists/i);
        // Nothing to email — confirms the "no account" path never even
        // tries, not just that the HTTP response looks generic.
        expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('still returns the generic success response even if sending the email fails', async () => {
        sendPasswordResetEmail.mockRejectedValueOnce(new Error('SMTP is down'));
        const email = uniqueEmail('email-fails');
        await createUser({ email, password: 'OldPass123' });

        const res = await request(app).post('/api/auth/forgot-password').send({ email });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/if an account exists/i);
        // The token was still generated and saved despite the send failure
        // — a later retry (or a manually-shared link) would still work.
        expect(await readTokenFor(email)).toEqual(expect.any(String));
    });

    it('rejects a new password shorter than 6 characters', async () => {
        const email = uniqueEmail('short-pw');
        await createUser({ email, password: 'OldPass123' });
        await request(app).post('/api/auth/forgot-password').send({ email });
        const resetToken = await readTokenFor(email);

        const res = await request(app)
            .post(`/api/auth/reset-password/${resetToken}`)
            .send({ password: '123' });

        expect(res.status).toBe(400);
    });
});

describe('admin-initiated password reset', () => {
    it("emails the reset link directly to the reader, who can use it to log in", async () => {
        const admin = await createUser({ role: 'admin' });
        const email = uniqueEmail('admin-reset-target');
        const reader = await createUser({ email, password: 'ReaderOldPass1', role: 'reader' });

        const adminRes = await request(app)
            .post(`/api/admin/users/${reader._id}/reset-password`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(adminRes.status).toBe(200);
        expect(adminRes.body.emailSent).toBe(true);
        // Never included in the success response — only the fallback path
        // (see the failure test below) ever hands back a raw link.
        expect(adminRes.body.resetLink).toBeUndefined();
        expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
        expect(sendPasswordResetEmail.mock.calls[0][0]).toMatchObject({ to: email, isAdminInitiated: true });

        const resetToken = await readTokenFor(email);
        const resetRes = await request(app)
            .post(`/api/auth/reset-password/${resetToken}`)
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

    it('falls back to returning the raw reset link when email sending fails, so the admin can still deliver it manually', async () => {
        sendPasswordResetEmail.mockRejectedValueOnce(new Error('SMTP is down'));
        const admin = await createUser({ role: 'admin' });
        const email = uniqueEmail('admin-reset-email-fails');
        const reader = await createUser({ email, role: 'reader' });

        const adminRes = await request(app)
            .post(`/api/admin/users/${reader._id}/reset-password`)
            .set('Authorization', `Bearer ${tokenFor(admin)}`);

        expect(adminRes.status).toBe(200);
        expect(adminRes.body.emailSent).toBe(false);
        expect(adminRes.body.resetLink).toEqual(expect.stringContaining('/kenlibs/reset-password/'));

        // The token behind that fallback link is still genuinely valid.
        const tokenFromLink = adminRes.body.resetLink.split('/').pop();
        expect(tokenFromLink).toBe(await readTokenFor(email));
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
