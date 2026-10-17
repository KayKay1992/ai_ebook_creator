// Brute-force limits on the password endpoints (middleware/authRateLimits.js):
// login per IP+email and per IP (failures only), forgot-password per IP and
// per email, register and reset-password per IP; friendly 429s that don't
// reveal accounts; successful flows unchanged.
// Small limits for this file, set before the app (and its limiters) load.
Object.assign(process.env, {
    AUTH_LOGIN_WINDOW_MINUTES: '15',
    AUTH_LOGIN_MAX_FAILS_PER_IP_EMAIL: '3',
    AUTH_LOGIN_MAX_FAILS_PER_IP: '6',
    AUTH_FORGOT_MAX_PER_IP: '4',
    AUTH_FORGOT_MAX_PER_EMAIL: '2',
    AUTH_REGISTER_MAX_PER_IP: '3',
    AUTH_RESET_MAX_PER_IP: '3',
});

jest.mock('../utils/sendEmail', () => ({
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    sendEmail: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const { sendPasswordResetEmail } = require('../utils/sendEmail');
const { createUser } = require('./helpers');
const { readAuthRateLimitConfig } = require('../middleware/authRateLimits');

// Each test (and each simulated visitor) gets its own address.
app.set('trust proxy', true);
let ipCounter = 0;
const newIp = () => `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
const from = (ip) => ({
    login: (email, password) => request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email, password }),
    forgot: (email) => request(app).post('/api/auth/forgot-password').set('X-Forwarded-For', ip).send({ email }),
    register: (body) => request(app).post('/api/auth/register').set('X-Forwarded-For', ip).send(body),
    reset: (token, password) => request(app).post(`/api/auth/reset-password/${token}`).set('X-Forwarded-For', ip).send({ password }),
});

const LOGIN_KEYS = ['_id', 'email', 'message', 'name', 'role', 'token'];
const GENERIC_FORGOT = 'If an account exists for that email, a password reset link has been sent.';

beforeAll(db.connect);
afterEach(async () => {
    await db.clearDatabase();
    sendPasswordResetEmail.mockClear();
});
afterAll(db.closeDatabase);

describe('configuration', () => {
    it('has safe defaults and ignores invalid values', () => {
        expect(readAuthRateLimitConfig({})).toEqual({
            loginWindowMs: 15 * 60 * 1000,
            loginMaxFailsPerIpEmail: 10,
            loginMaxFailsPerIp: 100,
            forgotMaxPerIp: 20,
            forgotMaxPerEmail: 5,
            registerMaxPerIp: 10,
            resetMaxPerIp: 20,
        });
        expect(readAuthRateLimitConfig({ AUTH_LOGIN_MAX_FAILS_PER_IP_EMAIL: '0', AUTH_FORGOT_MAX_PER_EMAIL: 'lots' })).toMatchObject({
            loginMaxFailsPerIpEmail: 10,
            forgotMaxPerEmail: 5,
        });
        expect(readAuthRateLimitConfig({ AUTH_LOGIN_WINDOW_MINUTES: '30' }).loginWindowMs).toBe(30 * 60 * 1000);
    });
});

describe('login', () => {
    it('a normal password login is unchanged', async () => {
        const user = await createUser({ email: 'ok@example.com', password: 'password123', name: 'Okay' });
        const res = await from(newIp()).login('ok@example.com', 'password123');
        expect(res.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(LOGIN_KEYS);
        expect(res.body).toMatchObject({ message: 'Login successful', _id: String(user._id), name: 'Okay', email: 'ok@example.com', role: 'reader' });
        const wrong = await from(newIp()).login('ok@example.com', 'nope');
        expect(wrong.status).toBe(400);
        expect(wrong.body).toEqual({ message: 'Invalid credentials' });
    });

    it('blocks an IP + email after too many failures, even with the right password, with a friendly 429', async () => {
        await createUser({ email: 'victim@example.com', password: 'password123' });
        const visitor = from(newIp());
        for (let i = 0; i < 3; i++) expect((await visitor.login('victim@example.com', 'guess' + i)).status).toBe(400);
        const blocked = await visitor.login('victim@example.com', 'password123');
        expect(blocked.status).toBe(429);
        expect(blocked.body).toEqual({ code: 'rate_limited', retryAfterSeconds: expect.any(Number), message: expect.stringMatching(/^Too many attempts\. Please wait \d+ minutes? and try again\.$/) });
        expect(blocked.body.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
        expect(blocked.headers['ratelimit-policy']).toBeDefined();

        // The same message for an email with no account: nothing revealed.
        for (let i = 0; i < 3; i++) await visitor.login('nobody@example.com', 'guess' + i);
        const unknown = await visitor.login('nobody@example.com', 'x');
        expect(unknown.status).toBe(429);
        expect(unknown.body.message).toBe(blocked.body.message);

        // The real owner, from their own address, is not blocked.
        expect((await from(newIp()).login('victim@example.com', 'password123')).status).toBe(200);
    });

    it("other people's failures on the same IP don't block your login, and a success clears your count", async () => {
        await createUser({ email: 'alice@example.com', password: 'password123' });
        await createUser({ email: 'bob@example.com', password: 'password123' });
        const shared = from(newIp());
        for (let i = 0; i < 3; i++) await shared.login('alice@example.com', 'wrong');
        expect((await shared.login('alice@example.com', 'password123')).status).toBe(429);
        expect((await shared.login('bob@example.com', 'password123')).status).toBe(200);

        // Bob: 2 failures, a success, then 2 more failures still don't block him.
        const bobIp = from(newIp());
        await bobIp.login('bob@example.com', 'wrong');
        await bobIp.login('bob@example.com', 'wrong');
        expect((await bobIp.login('bob@example.com', 'password123')).status).toBe(200);
        await bobIp.login('bob@example.com', 'wrong');
        await bobIp.login('bob@example.com', 'wrong');
        expect((await bobIp.login('bob@example.com', 'password123')).status).toBe(200);
        // Successful logins never count.
        for (let i = 0; i < 8; i++) expect((await bobIp.login('bob@example.com', 'password123')).status).toBe(200);
    });

    it('caps failures per IP across many emails', async () => {
        await createUser({ email: 'real@example.com', password: 'password123' });
        const attacker = from(newIp());
        for (let i = 0; i < 6; i++) expect((await attacker.login(`guess${i}@example.com`, 'x')).status).toBe(400);
        expect((await attacker.login('another@example.com', 'x')).status).toBe(429);
        expect((await from(newIp()).login('real@example.com', 'password123')).status).toBe(200);
    });

    it('treats the email case-insensitively for the limit', async () => {
        const visitor = from(newIp());
        await visitor.login('Case@Example.com', 'x');
        await visitor.login('case@example.com ', 'x');
        await visitor.login('CASE@EXAMPLE.COM', 'x');
        expect((await visitor.login('case@example.com', 'x')).status).toBe(429);
    });
});

describe('forgot password', () => {
    it('per email: the same 200 reply, but no more emails after the limit', async () => {
        await createUser({ email: 'forgetful@example.com' });
        for (let i = 0; i < 3; i++) {
            const res = await from(newIp()).forgot('forgetful@example.com');
            expect(res.status).toBe(200);
            expect(res.body).toEqual({ message: GENERIC_FORGOT });
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(sendPasswordResetEmail).toHaveBeenCalledTimes(2);
        // An unknown email behaves the same.
        for (let i = 0; i < 3; i++) expect((await from(newIp()).forgot('ghost@example.com')).body).toEqual({ message: GENERIC_FORGOT });
    });

    it('per IP: a friendly 429', async () => {
        const visitor = from(newIp());
        for (let i = 0; i < 4; i++) expect((await visitor.forgot(`someone${i}@example.com`)).status).toBe(200);
        const blocked = await visitor.forgot('someone-else@example.com');
        expect(blocked.status).toBe(429);
        expect(blocked.body.code).toBe('rate_limited');
        expect(blocked.body.message).toMatch(/Too many attempts/);
    });

    it('still answers 400 without an email', async () => {
        expect((await from(newIp()).forgot('')).status).toBe(400);
    });
});

describe('register and reset password', () => {
    it('limits sign-ups per IP; a normal sign-up is unchanged', async () => {
        const visitor = from(newIp());
        for (let i = 0; i < 3; i++) {
            const res = await visitor.register({ name: 'New', email: `new${i}@example.com`, password: 'password123' });
            expect(res.status).toBe(201);
            expect(Object.keys(res.body).sort()).toEqual(['message', 'token']);
        }
        expect((await visitor.register({ name: 'New', email: 'new9@example.com', password: 'password123' })).status).toBe(429);
        expect((await from(newIp()).register({ name: 'New', email: 'new9@example.com', password: 'password123' })).status).toBe(201);
    });

    it('limits reset attempts per IP; a valid reset still works from elsewhere', async () => {
        const user = await createUser({ email: 'reset@example.com' });
        const visitor = from(newIp());
        for (let i = 0; i < 3; i++) expect((await visitor.reset('f'.repeat(64), 'newpassword123')).status).toBe(400);
        expect((await visitor.reset('f'.repeat(64), 'newpassword123')).status).toBe(429);

        user.resetPasswordToken = 'e'.repeat(64);
        user.resetPasswordExpires = Date.now() + 60000;
        await user.save();
        const ok = await from(newIp()).reset('e'.repeat(64), 'newpassword123');
        expect(ok.status).toBe(200);
        expect(ok.body).toEqual({ message: 'Password has been reset. You can now log in with your new password.' });
        expect((await from(newIp()).login('reset@example.com', 'newpassword123')).status).toBe(200);
    });
});
