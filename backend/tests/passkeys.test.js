// Passkeys (controller/passkeyController.js): adding one, signing in with
// and without an email, single-use and expiring challenges, signature
// counter replay, the 5-passkey limit, ownership, rate limits, account
// deletion, audit events, and that the password login is unchanged.
// Real WebAuthn verification against a software authenticator
// (tests/softAuthenticator.js); nothing in @simplewebauthn is mocked.
process.env.WEBAUTHN_ORIGIN = 'http://localhost:5173';
delete process.env.WEBAUTHN_RP_ID;

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const Passkey = require('../models/Passkey');
const AuthEvent = require('../models/AuthEvent');
const WebAuthnChallenge = require('../models/WebAuthnChallenge');
const User = require('../models/User');
const { createUser, tokenFor } = require('./helpers');
const { createSoftAuthenticator } = require('./softAuthenticator');
const { getWebAuthnConfig, originsMatchRpId } = require('../config/webauthn');
const { isSupportedNode, unsupportedNodeMessage } = require('../utils/nodeVersion');

// Each test gets its own client address, so the in-memory per-IP rate
// limits from one test never affect another (app trusts X-Forwarded-For
// only in this file).
app.set('trust proxy', true);
let ipCounter = 0;
let ip;
const api = () => {
    const withIp = (req) => req.set('X-Forwarded-For', ip);
    return {
        post: (path) => withIp(request(app).post(path)),
        get: (path) => withIp(request(app).get(path)),
        put: (path) => withIp(request(app).put(path)),
        delete: (path) => withIp(request(app).delete(path)),
    };
};
const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });
const staleAuth = (user) => ({
    Authorization: `Bearer ${jwt.sign({ id: user._id, iat: Math.floor(Date.now() / 1000) - 3600 }, process.env.JWT_SECRET, { expiresIn: '2h' })}`,
});

const BASE = '/api/auth/passkeys';

// Adds a passkey for `user` through the API; returns the authenticator.
const addPasskey = async (user, { nickname = 'My Tecno phone', authenticator = createSoftAuthenticator(), headers = auth(user) } = {}) => {
    const start = await api().post(`${BASE}/register/options`).set(headers).send({});
    expect(start.status).toBe(200);
    const res = await api()
        .post(`${BASE}/register/verify`)
        .set(headers)
        .send({ flowId: start.body.flowId, response: authenticator.register(start.body.options), nickname });
    expect(res.status).toBe(201);
    return { authenticator, passkey: res.body.passkey };
};

const signIn = async (authenticator, { email, overrides } = {}) => {
    const start = await api().post(`${BASE}/login/options`).send(email === undefined ? {} : { email });
    expect(start.status).toBe(200);
    return api()
        .post(`${BASE}/login/verify`)
        .send({ flowId: start.body.flowId, response: authenticator.authenticate(start.body.options, overrides) });
};

beforeAll(async () => {
    await db.connect();
    await Promise.all([Passkey.init(), WebAuthnChallenge.init(), AuthEvent.init()]);
});
beforeEach(() => {
    ip = `10.0.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;
});
afterEach(async () => {
    await db.clearDatabase();
    await Promise.all([Passkey.init(), WebAuthnChallenge.init(), AuthEvent.init()]);
});
afterAll(async () => {
    await db.closeDatabase();
});

describe('configuration', () => {
    it('uses the frontend origin and its host as RP ID by default, with documented overrides', () => {
        expect(getWebAuthnConfig({ FRONTEND_URL: 'https://kenlibs-sooty.vercel.app/' })).toEqual({
            rpID: 'kenlibs-sooty.vercel.app',
            rpName: 'Kenlibs',
            origins: ['https://kenlibs-sooty.vercel.app'],
        });
        expect(getWebAuthnConfig({})).toEqual({ rpID: 'localhost', rpName: 'Kenlibs', origins: ['http://localhost:5173'] });
        const custom = getWebAuthnConfig({
            FRONTEND_URL: 'https://ignored.example',
            WEBAUTHN_ORIGIN: 'https://kenlibs.ng, https://www.kenlibs.ng',
            WEBAUTHN_RP_ID: 'kenlibs.ng',
            WEBAUTHN_RP_NAME: 'Kenlibs Books',
        });
        expect(custom).toEqual({ rpID: 'kenlibs.ng', rpName: 'Kenlibs Books', origins: ['https://kenlibs.ng', 'https://www.kenlibs.ng'] });
        expect(originsMatchRpId(custom)).toBe(true);
        expect(originsMatchRpId({ rpID: 'kenlibs.ng', origins: ['https://evil-kenlibs.ng'] })).toBe(false);
    });

    it('needs Node 20 or newer, with a clear message', () => {
        expect(isSupportedNode('18.19.0')).toBe(false);
        expect(isSupportedNode('20.0.0')).toBe(true);
        expect(isSupportedNode(process.versions.node)).toBe(true);
        expect(unsupportedNodeMessage('18.19.0')).toMatch(/Node 20 or newer.*Node 18\.19\.0.*NODE_VERSION/);
    });
});

describe('adding a passkey', () => {
    it('works right after signing in, requires user verification and prefers discoverable credentials', async () => {
        const user = await createUser({ email: 'ada@example.com' });
        const start = await api().post(`${BASE}/register/options`).set(auth(user)).send({});
        expect(start.status).toBe(200);
        const { options } = start.body;
        expect(options.rp).toEqual({ name: 'Kenlibs', id: 'localhost' });
        expect(options.user.name).toBe('ada@example.com');
        expect(options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
        expect(options.attestation).toBe('none');
        // The user handle is the account id bytes, never the email.
        expect(Buffer.from(options.user.id, 'base64url').toString('hex')).toBe(String(user._id));

        const authenticator = createSoftAuthenticator();
        const res = await api()
            .post(`${BASE}/register/verify`)
            .set(auth(user))
            .send({ flowId: start.body.flowId, response: authenticator.register(options), nickname: '  My <b>Tecno</b>\nphone  ' });
        expect(res.status).toBe(201);
        expect(res.body.passkey).toEqual({
            _id: expect.any(String),
            nickname: 'My b Tecno /b phone',
            createdAt: expect.any(String),
            lastUsedAt: null,
            deviceType: 'singleDevice',
            backedUp: false,
        });
        const stored = await Passkey.findOne({ userId: user._id }).select('+publicKey').lean();
        expect(stored.credentialID).toBe(authenticator.credentialId);
        expect(Buffer.from(stored.publicKey.buffer).length).toBeGreaterThan(60);
        expect(stored.transports).toEqual(['internal', 'hybrid']);

        const list = await api().get(BASE).set(auth(user));
        expect(list.status).toBe(200);
        expect(list.body.max).toBe(5);
        expect(list.body.passkeys).toHaveLength(1);
        // No credential data ever leaves the server.
        expect(JSON.stringify(list.body)).not.toMatch(/publicKey|credentialID|counter/);
    });

    it('needs the password when the sign-in is older than 10 minutes', async () => {
        const user = await createUser({ password: 'password123' });
        const noPassword = await api().post(`${BASE}/register/options`).set(staleAuth(user)).send({});
        expect(noPassword.status).toBe(403);
        expect(noPassword.body.code).toBe('password_required');
        const wrong = await api().post(`${BASE}/register/options`).set(staleAuth(user)).send({ password: 'nope' });
        expect(wrong.status).toBe(403);
        expect(wrong.body.code).toBe('wrong_password');
        const right = await api().post(`${BASE}/register/options`).set(staleAuth(user)).send({ password: 'password123' });
        expect(right.status).toBe(200);
    });

    it('needs a signed-in user', async () => {
        expect((await api().post(`${BASE}/register/options`).send({})).status).toBe(401);
        expect((await api().post(`${BASE}/register/verify`).send({})).status).toBe(401);
        expect((await api().get(BASE)).status).toBe(401);
    });

    it("excludes the user's existing passkeys, and refuses the same one twice", async () => {
        const user = await createUser();
        const { authenticator } = await addPasskey(user);
        const start = await api().post(`${BASE}/register/options`).set(auth(user)).send({});
        expect(start.body.options.excludeCredentials).toEqual([{ id: authenticator.credentialId, type: 'public-key', transports: ['internal', 'hybrid'] }]);
        const again = await api()
            .post(`${BASE}/register/verify`)
            .set(auth(user))
            .send({ flowId: start.body.flowId, response: authenticator.register(start.body.options) });
        expect(again.status).toBe(409);
        expect(await Passkey.countDocuments({ userId: user._id })).toBe(1);
    });

    it('rejects a response for another origin, RP ID or challenge, or without user verification', async () => {
        const user = await createUser();
        for (const overrides of [{ origin: 'https://evil.example' }, { rpID: 'evil.example' }, { challenge: 'bm90LXRoZS1jaGFsbGVuZ2U' }, { uv: false }]) {
            const start = await api().post(`${BASE}/register/options`).set(auth(user)).send({});
            const res = await api()
                .post(`${BASE}/register/verify`)
                .set(auth(user))
                .send({ flowId: start.body.flowId, response: createSoftAuthenticator().register(start.body.options, overrides) });
            expect(res.status).toBe(400);
        }
        expect(await Passkey.countDocuments()).toBe(0);
    });

    it('allows at most 5 passkeys per user', async () => {
        const user = await createUser();
        for (let i = 0; i < 5; i++) await addPasskey(user, { nickname: `Key ${i + 1}` });
        const sixth = await api().post(`${BASE}/register/options`).set(auth(user)).send({});
        expect(sixth.status).toBe(409);
        expect(sixth.body.code).toBe('limit');

        // Also checked at verify (options fetched while there were 4).
        await Passkey.deleteOne({ userId: user._id, nickname: 'Key 5' });
        const start = await api().post(`${BASE}/register/options`).set(auth(user)).send({});
        await addPasskey(user, { nickname: 'Key 5 again' });
        const late = await api()
            .post(`${BASE}/register/verify`)
            .set(auth(user))
            .send({ flowId: start.body.flowId, response: createSoftAuthenticator().register(start.body.options) });
        expect(late.status).toBe(409);
        expect(await Passkey.countDocuments({ userId: user._id })).toBe(5);
    });

    it("can't use another user's registration challenge", async () => {
        const alice = await createUser();
        const bob = await createUser();
        const start = await api().post(`${BASE}/register/options`).set(auth(alice)).send({});
        const res = await api()
            .post(`${BASE}/register/verify`)
            .set(auth(bob))
            .send({ flowId: start.body.flowId, response: createSoftAuthenticator().register(start.body.options) });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('expired');
        expect(await Passkey.countDocuments()).toBe(0);
    });
});

describe('signing in with a passkey', () => {
    it('works without an email and returns exactly what the password login returns', async () => {
        const user = await createUser({ email: 'reader@example.com', password: 'password123', name: 'Reader' });
        const { authenticator } = await addPasskey(user);

        const start = await api().post(`${BASE}/login/options`).send({});
        expect(start.status).toBe(200);
        expect(start.body.options).toMatchObject({ rpId: 'localhost', userVerification: 'required' });
        expect(start.body.options.allowCredentials ?? []).toEqual([]);

        const res = await api()
            .post(`${BASE}/login/verify`)
            .send({ flowId: start.body.flowId, response: authenticator.authenticate(start.body.options) });
        expect(res.status).toBe(200);

        const password = await api().post('/api/auth/login').send({ email: 'reader@example.com', password: 'password123' });
        expect(password.status).toBe(200);
        expect(Object.keys(res.body).sort()).toEqual(Object.keys(password.body).sort());
        expect({ ...res.body, token: 'x' }).toEqual({ ...password.body, token: 'x' });
        expect(jwt.verify(res.body.token, process.env.JWT_SECRET).id).toBe(String(user._id));

        const profile = await api().get('/api/auth/profile').set('Authorization', `Bearer ${res.body.token}`);
        expect(profile.status).toBe(200);
        expect(profile.body.email).toBe('reader@example.com');

        const stored = await Passkey.findOne({ userId: user._id });
        expect(stored.counter).toBe(1);
        expect(stored.lastUsedAt).toBeInstanceOf(Date);
    });

    it("works with the account's email typed in; another account's email fails generically", async () => {
        const user = await createUser({ email: 'mine@example.com' });
        await createUser({ email: 'other@example.com' });
        const { authenticator } = await addPasskey(user);
        expect((await signIn(authenticator, { email: ' Mine@Example.com ' })).status).toBe(200);
        const wrong = await signIn(authenticator, { email: 'other@example.com' });
        expect(wrong.status).toBe(400);
        const unknownCredential = await signIn(createSoftAuthenticator());
        expect(unknownCredential.status).toBe(400);
        expect(wrong.body).toEqual(unknownCredential.body);
    });

    it("doesn't reveal whether an email has an account or passkeys", async () => {
        const user = await createUser({ email: 'known@example.com' });
        await addPasskey(user);
        const shape = (body) => ({ flowId: typeof body.flowId, options: Object.keys(body.options).sort(), allow: body.options.allowCredentials ?? [] });
        const known = await api().post(`${BASE}/login/options`).send({ email: 'known@example.com' });
        const unknown = await api().post(`${BASE}/login/options`).send({ email: 'nobody@example.com' });
        const none = await api().post(`${BASE}/login/options`).send({});
        expect(known.status).toBe(200);
        expect(unknown.status).toBe(200);
        expect(shape(known.body)).toEqual(shape(unknown.body));
        expect(shape(known.body)).toEqual(shape(none.body));
        expect(JSON.stringify(known.body)).not.toMatch(/known@example/);
    });

    it('uses each challenge once', async () => {
        const user = await createUser();
        const { authenticator } = await addPasskey(user);
        const start = await api().post(`${BASE}/login/options`).send({});
        const response = authenticator.authenticate(start.body.options);
        const first = await api().post(`${BASE}/login/verify`).send({ flowId: start.body.flowId, response });
        expect(first.status).toBe(200);
        const replay = await api().post(`${BASE}/login/verify`).send({ flowId: start.body.flowId, response });
        expect(replay.status).toBe(400);
        expect(replay.body.code).toBe('expired');

        // A failed attempt uses it up too.
        const start2 = await api().post(`${BASE}/login/options`).send({});
        const bad = await api()
            .post(`${BASE}/login/verify`)
            .send({ flowId: start2.body.flowId, response: authenticator.authenticate(start2.body.options, { origin: 'https://evil.example' }) });
        expect(bad.status).toBe(400);
        const retry = await api()
            .post(`${BASE}/login/verify`)
            .send({ flowId: start2.body.flowId, response: authenticator.authenticate(start2.body.options) });
        expect(retry.body.code).toBe('expired');
        expect(await WebAuthnChallenge.countDocuments({ purpose: 'login' })).toBe(0);
    });

    it('rejects an expired challenge, and the collection expires them by TTL', async () => {
        const user = await createUser();
        const { authenticator } = await addPasskey(user);
        const start = await api().post(`${BASE}/login/options`).send({});
        await WebAuthnChallenge.updateOne({ _id: start.body.flowId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
        const res = await api()
            .post(`${BASE}/login/verify`)
            .send({ flowId: start.body.flowId, response: authenticator.authenticate(start.body.options) });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('expired');

        const fresh = await WebAuthnChallenge.findOne().lean();
        expect(fresh === null || fresh.expiresAt - Date.now() <= 5 * 60 * 1000).toBe(true);
        const indexes = await WebAuthnChallenge.collection.indexes();
        expect(indexes).toEqual(expect.arrayContaining([expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 })]));
        const start2 = await api().post(`${BASE}/login/options`).send({});
        const doc = await WebAuthnChallenge.findById(start2.body.flowId).lean();
        expect(doc.expiresAt - Date.now()).toBeLessThanOrEqual(5 * 60 * 1000);
        expect(doc.expiresAt - Date.now()).toBeGreaterThan(4 * 60 * 1000);
    });

    it('rejects a replayed or cloned authenticator whose counter does not increase', async () => {
        const user = await createUser();
        const { authenticator } = await addPasskey(user);
        expect((await signIn(authenticator)).status).toBe(200); // counter 1
        expect((await signIn(authenticator)).status).toBe(200); // counter 2
        const replay = await signIn(authenticator, { overrides: { counterOverride: 2 } });
        expect(replay.status).toBe(400);
        const older = await signIn(authenticator, { overrides: { counterOverride: 1 } });
        expect(older.status).toBe(400);
        expect((await Passkey.findOne({ userId: user._id })).counter).toBe(2);
        expect((await signIn(authenticator, { overrides: { counterOverride: 3 } })).status).toBe(200);
    });

    it('accepts synced passkeys that always report a counter of 0', async () => {
        const user = await createUser();
        const { authenticator } = await addPasskey(user, { authenticator: createSoftAuthenticator({ backedUp: true }) });
        for (let i = 0; i < 3; i++) expect((await signIn(authenticator, { overrides: { step: 0 } })).status).toBe(200);
        const stored = await Passkey.findOne({ userId: user._id });
        expect(stored.counter).toBe(0);
        expect(stored.backedUp).toBe(true);
        expect(stored.deviceType).toBe('multiDevice');
    });

    it('requires user verification, the right origin, RP ID and user handle', async () => {
        const user = await createUser();
        const other = await createUser();
        const { authenticator } = await addPasskey(user);
        const wrongHandle = Buffer.from(String(other._id), 'hex').toString('base64url');
        for (const overrides of [{ uv: false }, { origin: 'https://evil.example' }, { rpID: 'evil.example' }, { userHandle: wrongHandle }]) {
            expect((await signIn(authenticator, { overrides })).status).toBe(400);
        }
        expect((await signIn(authenticator)).status).toBe(200);
    });

    it("doesn't sign in to a deleted (anonymised) account", async () => {
        const user = await createUser();
        const { authenticator } = await addPasskey(user);
        await User.updateOne({ _id: user._id }, { $set: { isDeleted: true } });
        expect((await signIn(authenticator)).status).toBe(400);
    });
});

describe('managing passkeys', () => {
    it('renames and removes your own passkeys; your password keeps working after removing the last', async () => {
        const user = await createUser({ email: 'own@example.com', password: 'password123' });
        const { passkey, authenticator } = await addPasskey(user);
        const renamed = await api().put(`${BASE}/${passkey._id}`).set(auth(user)).send({ nickname: 'Work laptop' });
        expect(renamed.status).toBe(200);
        expect(renamed.body.passkey.nickname).toBe('Work laptop');
        expect((await api().put(`${BASE}/${passkey._id}`).set(auth(user)).send({ nickname: '   ' })).status).toBe(400);

        const removed = await api().delete(`${BASE}/${passkey._id}`).set(auth(user));
        expect(removed.status).toBe(200);
        expect(await Passkey.countDocuments()).toBe(0);
        expect((await signIn(authenticator)).status).toBe(400);
        expect((await api().post('/api/auth/login').send({ email: 'own@example.com', password: 'password123' })).status).toBe(200);
    });

    it("can't rename or remove another user's passkey", async () => {
        const alice = await createUser();
        const mallory = await createUser();
        const { passkey } = await addPasskey(alice, { nickname: 'Alice phone' });

        const rename = await api().put(`${BASE}/${passkey._id}`).set(auth(mallory)).send({ nickname: 'Pwned' });
        expect(rename.status).toBe(404);
        const remove = await api().delete(`${BASE}/${passkey._id}`).set(auth(mallory));
        expect(remove.status).toBe(404);
        const list = await api().get(BASE).set(auth(mallory));
        expect(list.body.passkeys).toEqual([]);

        const stored = await Passkey.findById(passkey._id);
        expect(stored).not.toBeNull();
        expect(stored.nickname).toBe('Alice phone');
        expect(await AuthEvent.countDocuments({ userId: mallory._id })).toBe(0);
    });

    it('a bad id is a 404', async () => {
        const user = await createUser();
        expect((await api().delete(`${BASE}/not-an-id`).set(auth(user))).status).toBe(404);
    });
});

describe('audit events', () => {
    it('records add, login, rename and remove with only the user id, type and nickname', async () => {
        const user = await createUser();
        const { authenticator, passkey } = await addPasskey(user, { nickname: 'My phone' });
        await signIn(authenticator);
        await api().put(`${BASE}/${passkey._id}`).set(auth(user)).send({ nickname: 'Old phone' });
        await api().delete(`${BASE}/${passkey._id}`).set(auth(user));
        await new Promise((resolve) => setTimeout(resolve, 100));
        const events = await AuthEvent.find({ userId: user._id }).sort({ createdAt: 1, _id: 1 }).lean();
        expect(events.map((e) => [e.type, e.nickname])).toEqual([
            ['passkey_added', 'My phone'],
            ['passkey_login', 'My phone'],
            ['passkey_renamed', 'Old phone'],
            ['passkey_removed', 'Old phone'],
        ]);
        for (const event of events) {
            expect(Object.keys(event).sort()).toEqual(['__v', '_id', 'createdAt', 'expiresAt', 'nickname', 'type', 'userId']);
            expect(event.expiresAt - event.createdAt).toBe(90 * 24 * 60 * 60 * 1000);
        }
        expect(JSON.stringify(events)).not.toContain(authenticator.credentialId);
    });
});

describe('accounts', () => {
    it('deleting or anonymising a user deletes their passkeys', async () => {
        const admin = await createUser({ role: 'admin' });
        const a = await createUser();
        const b = await createUser();
        await addPasskey(a);
        await addPasskey(b);
        // b has purchase history, so they're anonymised rather than deleted.
        const PurchaseRequest = require('../models/PurchaseRequest');
        await PurchaseRequest.collection.insertOne({ reader: b._id, itemType: 'book', item: a._id, amount: 1, status: 'approved' });
        expect((await api().delete(`/api/admin/users/${a._id}`).set(auth(admin))).body.action).toBe('hard-deleted');
        expect((await api().delete(`/api/admin/users/${b._id}`).set(auth(admin))).body.action).toBe('anonymized');
        expect(await Passkey.countDocuments()).toBe(0);
    });

    it('a password reset keeps the passkeys', async () => {
        const user = await createUser({ email: 'reset@example.com' });
        const { authenticator } = await addPasskey(user);
        const fresh = await User.findById(user._id);
        fresh.resetPasswordToken = 'a'.repeat(64);
        fresh.resetPasswordExpires = Date.now() + 60000;
        await fresh.save();
        const reset = await api().post(`/api/auth/reset-password/${'a'.repeat(64)}`).send({ password: 'newpassword123' });
        expect(reset.status).toBe(200);
        expect(await Passkey.countDocuments({ userId: user._id })).toBe(1);
        expect((await signIn(authenticator)).status).toBe(200);
    });
});

describe('rate limits', () => {
    it('limits failed passkey sign-ins per passkey, across addresses', async () => {
        const user = await createUser();
        const { authenticator } = await addPasskey(user);
        const statuses = [];
        for (let i = 0; i < 11; i++) {
            ip = `10.9.0.${i + 1}`;
            statuses.push((await signIn(authenticator, { overrides: { uv: false } })).status);
        }
        expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
        expect(statuses[10]).toBe(429);
        ip = '10.9.1.1';
        const blocked = await signIn(authenticator);
        expect(blocked.status).toBe(429);
        expect(blocked.body.message).toMatch(/Too many attempts/);
        expect(JSON.stringify(blocked.body)).not.toMatch(/passkey|account|email/i);
    });

    it('limits sign-in attempts per address', async () => {
        let status;
        for (let i = 0; i < 61; i++) status = (await api().post(`${BASE}/login/options`).send({})).status;
        expect(status).toBe(429);
    });

    it('limits passkey changes per account', async () => {
        const user = await createUser();
        let status;
        for (let i = 0; i < 31; i++) {
            ip = `10.8.0.${i + 1}`;
            status = (await api().post(`${BASE}/register/options`).set(auth(user)).send({})).status;
        }
        expect(status).toBe(429);
    });
});
