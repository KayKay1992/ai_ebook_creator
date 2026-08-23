const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const User = require('../models/User');
const { createUser, tokenFor, uniqueEmail } = require('./helpers');

beforeAll(async () => db.connect());
afterEach(async () => db.clearDatabase());
afterAll(async () => db.closeDatabase());

describe('POST /api/auth/register', () => {
    it('registers a new user and returns a token', async () => {
        const email = uniqueEmail('register');
        const res = await request(app).post('/api/auth/register').send({
            name: 'Jane Reader',
            email,
            password: 'password123',
        });

        expect(res.status).toBe(201);
        expect(res.body.token).toEqual(expect.any(String));

        const stored = await User.findOne({ email });
        expect(stored).not.toBeNull();
        expect(stored.name).toBe('Jane Reader');
    });

    it('defaults role to reader', async () => {
        const email = uniqueEmail('default-role');
        await request(app).post('/api/auth/register').send({
            name: 'Default Role',
            email,
            password: 'password123',
        });

        const stored = await User.findOne({ email });
        expect(stored.role).toBe('reader');
    });

    // registerUser destructures only { name, email, password } from the
    // request body — a client-sent `role` field is silently ignored, not
    // rejected. This test locks in that there is genuinely no way to
    // self-register as admin, not just that the happy path defaults to
    // reader.
    it('ignores a client-supplied role: admin and still creates a reader', async () => {
        const email = uniqueEmail('admin-attempt');
        const res = await request(app).post('/api/auth/register').send({
            name: 'Wannabe Admin',
            email,
            password: 'password123',
            role: 'admin',
        });

        expect(res.status).toBe(201);
        const stored = await User.findOne({ email });
        expect(stored.role).toBe('reader');
    });

    it('rejects a duplicate email', async () => {
        const email = uniqueEmail('dupe');
        await request(app).post('/api/auth/register').send({
            name: 'First',
            email,
            password: 'password123',
        });

        const res = await request(app).post('/api/auth/register').send({
            name: 'Second',
            email,
            password: 'password456',
        });

        expect(res.status).toBe(400);
        expect(await User.countDocuments({ email })).toBe(1);
    });

    it('rejects missing required fields', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ email: uniqueEmail('incomplete') });

        expect(res.status).toBe(400);
    });
});

describe('POST /api/auth/login', () => {
    it('logs in with correct credentials and returns a token + role', async () => {
        const email = uniqueEmail('login');
        await createUser({ email, password: 'correct-password', role: 'reader' });

        const res = await request(app)
            .post('/api/auth/login')
            .send({ email, password: 'correct-password' });

        expect(res.status).toBe(200);
        expect(res.body.token).toEqual(expect.any(String));
        expect(res.body.role).toBe('reader');
    });

    it('rejects the wrong password', async () => {
        const email = uniqueEmail('wrong-pw');
        await createUser({ email, password: 'correct-password' });

        const res = await request(app)
            .post('/api/auth/login')
            .send({ email, password: 'totally-wrong' });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/invalid credentials/i);
    });

    it('rejects a nonexistent email', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: uniqueEmail('never-registered'), password: 'whatever123' });

        expect(res.status).toBe(400);
    });
});

describe('protected route access', () => {
    it('rejects a request with no token at all', async () => {
        const res = await request(app).get('/api/auth/profile');
        expect(res.status).toBe(401);
        expect(res.body.message).toMatch(/no token/i);
    });

    it('rejects a garbage/invalid token', async () => {
        const res = await request(app)
            .get('/api/auth/profile')
            .set('Authorization', 'Bearer not-a-real-token');

        expect(res.status).toBe(401);
    });

    it('allows access with a valid token and never leaks the password hash', async () => {
        const user = await createUser({ role: 'reader' });
        const res = await request(app)
            .get('/api/auth/profile')
            .set('Authorization', `Bearer ${tokenFor(user)}`);

        expect(res.status).toBe(200);
        expect(res.body.email).toBe(user.email);
        expect(res.body.password).toBeUndefined();
    });
});
