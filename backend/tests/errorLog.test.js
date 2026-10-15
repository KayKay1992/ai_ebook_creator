// Self-hosted error monitoring: grouping by fingerprint, 5xx only, the
// scrubber, the browser report endpoint (validation, noise, per-IP limit),
// alert emails (new / reopened / spike, hourly cap), TTL, admin-only routes,
// and that a failing logger never breaks a request.
jest.mock('../utils/sendEmail', () => ({
    ...jest.requireActual('../utils/sendEmail'),
    sendErrorAlertEmail: jest.fn().mockResolvedValue({}),
}));

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const Book = require('../models/Book');
const ErrorLog = require('../models/ErrorLog');
const { sendErrorAlertEmail } = require('../utils/sendEmail');
const { captureError, flushErrorLogs, buildEntry } = require('../utils/errorLogger');
const { resetAlertWindow } = require('../utils/errorAlerts');
const { scrubMessage, scrubStack, scrubPath, fingerprintOf, firstFrame } = require('../utils/errorScrubber');
const { createUser, tokenFor } = require('./helpers');

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });
const settle = async () => {
    // Let the response's 'finish' handler run, then wait for the writes.
    await new Promise((resolve) => setImmediate(resolve));
    await flushErrorLogs();
    await new Promise((resolve) => setImmediate(resolve));
};
const failStorefrontOnce = (message = 'Storefront query exploded') =>
    jest.spyOn(Book, 'find').mockImplementationOnce(() => {
        throw new Error(message);
    });

beforeAll(async () => {
    await db.connect();
    await ErrorLog.init(); // build the unique + TTL indexes
});
beforeEach(() => {
    process.env.ERROR_LOG_ENABLED = 'true';
    process.env.ADMIN_NOTIFY_EMAIL = 'alerts@example.com';
    delete process.env.ERROR_ALERT_MAX_PER_HOUR;
    delete process.env.ERROR_ALERT_SPIKE_PER_HOUR;
    delete process.env.ERROR_LOG_TTL_DAYS;
    sendErrorAlertEmail.mockClear();
    resetAlertWindow();
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(async () => {
    await flushErrorLogs();
    jest.restoreAllMocks();
    await db.clearDatabase();
});
afterAll(async () => {
    delete process.env.ERROR_LOG_ENABLED;
    delete process.env.ADMIN_NOTIFY_EMAIL;
    await db.closeDatabase();
});

describe('capturing backend errors', () => {
    it('records a 5xx once and groups repeats by fingerprint (count, lastSeenAt)', async () => {
        failStorefrontOnce();
        expect((await request(app).get('/api/public/kenlibs')).status).toBe(500);
        await settle();
        failStorefrontOnce();
        expect((await request(app).get('/api/public/kenlibs')).status).toBe(500);
        await settle();

        const logs = await ErrorLog.find().lean();
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
            source: 'backend',
            message: 'Storefront query exploded',
            method: 'GET',
            route: '/api/public/kenlibs',
            statusCode: 500,
            count: 2,
            resolved: false,
            environment: 'test',
        });
        expect(logs[0].stack).toMatch(/Storefront query exploded/);
        expect(logs[0].lastSeenAt.getTime()).toBeGreaterThanOrEqual(logs[0].firstSeenAt.getTime());
        expect(logs[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    it('never records 4xx responses', async () => {
        const reader = await createUser({ role: 'reader' });
        expect((await request(app).get('/api/books')).status).toBe(401);
        expect((await request(app).get('/api/books').set(auth(reader))).status).toBe(403);
        expect((await request(app).get('/api/public/kenlibs/books/64b000000000000000000000')).status).toBe(404);
        expect((await request(app).post('/api/auth/login').send({ email: 'x@example.com', password: 'wrong' })).status).toBeGreaterThanOrEqual(400);
        // Malformed JSON → 400 JSON from the error handler, not a logged 500.
        const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
        expect(bad.status).toBe(400);
        expect(bad.body).toEqual({ message: expect.any(String) });
        await settle();
        expect(await ErrorLog.countDocuments()).toBe(0);
    });

    it('ids in the route become :id and the user id (never email/name) is kept', async () => {
        const admin = await createUser({ role: 'admin', email: 'secret-admin@example.com' });
        jest.spyOn(Book, 'findById').mockImplementationOnce(() => {
            throw new Error('lookup failed for secret-admin@example.com');
        });
        const res = await request(app).get('/api/books/64b000000000000000000001').set(auth(admin));
        expect(res.status).toBe(500);
        await settle();
        const log = await ErrorLog.findOne().lean();
        expect(log.route).toBe('/api/books/:id');
        expect(String(log.userId)).toBe(String(admin._id));
        expect(JSON.stringify(log)).not.toContain('secret-admin@example.com');
        expect(log.message).toBe('lookup failed for [email]');
    });

    it('is off unless enabled (tests default to off) and ERROR_LOG_ENABLED=false turns it off', async () => {
        for (const value of [undefined, 'false']) {
            if (value === undefined) delete process.env.ERROR_LOG_ENABLED;
            else process.env.ERROR_LOG_ENABLED = value;
            failStorefrontOnce();
            expect((await request(app).get('/api/public/kenlibs')).status).toBe(500);
            await settle();
        }
        expect(await ErrorLog.countDocuments()).toBe(0);
    });

    it('a failing logger never breaks or changes the response', async () => {
        jest.spyOn(ErrorLog, 'findOneAndUpdate').mockImplementation(() => {
            throw new Error('database is down');
        });
        failStorefrontOnce();
        const res = await request(app).get('/api/public/kenlibs');
        expect(res.status).toBe(500);
        expect(res.body).toEqual({ message: 'Server Error' });
        await settle();

        // Synchronous failures inside capture are swallowed too.
        jest.spyOn(ErrorLog, 'findOneAndUpdate').mockRestore();
        const circular = {};
        circular.self = circular;
        expect(() => captureError({ source: 'backend', error: circular, route: { toString: () => { throw new Error('boom'); } } })).not.toThrow();
        await settle();
        // Normal requests still work afterwards.
        expect((await request(app).get('/api/public/kenlibs')).status).toBe(200);
    });

    it('records background job failures with job type, book and chapter ids', async () => {
        captureError({ source: 'job', jobType: 'audio-gemini', bookId: '64b000000000000000000002', chapterId: '64b000000000000000000003', error: new Error('TTS exploded') });
        await settle();
        const log = await ErrorLog.findOne().lean();
        expect(log).toMatchObject({ source: 'job', jobType: 'audio-gemini', message: 'TTS exploded' });
        expect(String(log.bookId)).toBe('64b000000000000000000002');
        expect(String(log.chapterId)).toBe('64b000000000000000000003');
    });

    it('expires entries via a TTL index, ERROR_LOG_TTL_DAYS after they were last seen', async () => {
        process.env.ERROR_LOG_TTL_DAYS = '7';
        captureError({ source: 'backend', message: 'ttl check' });
        await settle();
        const log = await ErrorLog.findOne().lean();
        const days = (log.expiresAt - log.lastSeenAt) / (24 * 60 * 60 * 1000);
        expect(days).toBeCloseTo(7, 5);
        const indexes = await ErrorLog.collection.indexes();
        expect(indexes).toEqual(expect.arrayContaining([expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 })]));
    });
});

// Fake secret-shaped values for the scrubber tests, assembled at runtime
// from separate parts so secret scanners don't flag the source. None of
// them is a real credential.
const FAKE = {
    jwt: ['eyJ', 'hbGciOiJub25lIn0', '.', 'eyJ', 'pZCI6ImZha2UifQ', '.', 'ZmFrZS1zaWduYXR1cmU'].join(''),
    shortJwt: ['eyJ', 'abcdefgh', '.', 'eyJ', 'abcdefgh', '.', 'abcdefghij'].join(''),
    googleKey: 'AIza' + 'SyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE00',
    mongoUser: 'test' + 'user',
    mongoPassword: 'notareal' + 'password',
    basicAuth: Buffer.from(['fake', 'user', ':', 'fake', 'pass'].join('')).toString('base64'),
    hexKey: '9f8e7d6c5b4a3928' + '1706f5e4d3c2b1a0' + 'ffeeddcc',
};
FAKE.mongoUri = 'mongodb+srv://' + FAKE.mongoUser + ':' + FAKE.mongoPassword + '@cluster0.example.invalid/db';

describe('scrubber', () => {
    it('removes emails, tokens, keys, passwords, credentials and reset links', () => {
        const jwtToken = FAKE.jwt;
        const text = [
            'user reader@example.com failed',
            `Bearer ${jwtToken}`,
            `token=${jwtToken}`,
            'password: ' + 'hunter2 ' + 'api_key=' + FAKE.googleKey,
            FAKE.mongoUri,
            'https://kenlibs.app/reset-password/abc123def456ghi789?x=1',
            'Authorization: Basic ' + FAKE.basicAuth,
            'cookie=sessionid=abcdef0123',
            'random key ' + FAKE.hexKey,
        ].join('\n');
        const out = scrubStack(text);
        for (const secret of ['reader@example.com', jwtToken, 'hunter2', FAKE.googleKey.slice(0, 6), FAKE.mongoPassword, FAKE.mongoUser, 'abc123def456ghi789', FAKE.basicAuth, 'sessionid=abcdef0123', FAKE.hexKey]) {
            expect(out).not.toContain(secret);
        }
        expect(out).toContain('[email]');
        expect(out).toContain('/reset-password/[token]');
    });

    it('keeps ordinary text, Mongo ids and stack frames readable', () => {
        expect(scrubMessage('Cast to ObjectId failed for value "64b000000000000000000001"')).toContain('64b000000000000000000001');
        expect(scrubMessage('at processJob (/app/backend/utils/audioJobs.js:52:9)')).toBe('at processJob (/app/backend/utils/audioJobs.js:52:9)');
        expect(scrubMessage('x'.repeat(5000)).length).toBeLessThanOrEqual(1001);
    });

    it('paths lose query strings, hashes and tokens', () => {
        expect(scrubPath('/kenlibs/reset-password/abcdef0123456789abcdef?token=1#x')).toBe('/kenlibs/reset-password/[token]');
        expect(scrubPath('/kenlibs/read/64b000000000000000000001?ref=x')).toBe('/kenlibs/read/64b000000000000000000001');
    });

    it('fingerprints group the same bug across ids, numbers, deploys and line numbers', () => {
        const a = fingerprintOf('frontend', 'Book 64b000000000000000000001 has 3 chapters', 'Error\n    at render (https://kenlibs.app/assets/index-AbC123xY.js:10:20)');
        const b = fingerprintOf('frontend', 'Book 64c000000000000000000009 has 7 chapters', 'Error\n    at render (https://kenlibs.app/assets/index-ZzZ999qq.js:11:5)');
        const c = fingerprintOf('frontend', 'Something else entirely', 'Error\n    at render (https://kenlibs.app/assets/index-AbC123xY.js:10:20)');
        const d = fingerprintOf('backend', 'Book 64b000000000000000000001 has 3 chapters', 'Error\n    at render (https://kenlibs.app/assets/index-AbC123xY.js:10:20)');
        expect(a).toBe(b);
        expect(a).not.toBe(c);
        expect(a).not.toBe(d);
        expect(firstFrame('Error: x\n    at foo (/a/b.js:1:2)')).toBe('at foo (/a/b.js');
    });

    it('everything stored goes through the scrubber', () => {
        const entry = buildEntry({ source: 'frontend', message: 'mail me at a@b.co', stack: 'token=' + FAKE.shortJwt, route: '/reset-password/abcdefabcdef1234?x', userId: 'not-an-id' });
        expect(entry).toMatchObject({ message: 'mail me at [email]', route: '/reset-password/[token]', userId: null });
        expect(entry.stack).not.toContain(FAKE.shortJwt.slice(0, 11));
    });
});

describe('POST /api/errors/report', () => {
    const report = (body) => request(app).post('/api/errors/report').send(body);

    it('records a browser error (scrubbed, with the reporter id if logged in) and groups repeats', async () => {
        const reader = await createUser({ role: 'reader' });
        const body = {
            kind: 'error',
            message: 'TypeError: cannot read title of undefined (user reader@example.com)',
            stack: 'TypeError\n    at BookCard (https://kenlibs.app/assets/KenlibsPage-abc123XY.js:1:200)',
            path: '/kenlibs/reset-password/abcdef0123456789abcdef?ref=1',
            release: 'web-1',
        };
        expect((await report(body).set(auth(reader))).status).toBe(204);
        expect((await report(body)).status).toBe(204);
        await settle();
        const logs = await ErrorLog.find().lean();
        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({ source: 'frontend', count: 2, route: '/kenlibs/reset-password/[token]', release: 'web-1' });
        expect(logs[0].message).toContain('[email]');
        expect(JSON.stringify(logs)).not.toContain('reader@example.com');
    });

    it('ignores noise (ResizeObserver, extensions, cancelled requests, network blips)', async () => {
        const noise = [
            { kind: 'error', message: 'ResizeObserver loop completed with undelivered notifications.' },
            { kind: 'error', message: 'Script error.' },
            { kind: 'error', message: 'x is undefined', stack: 'at y (chrome-extension://abcdef/content.js:1:1)' },
            { kind: 'unhandledrejection', message: 'CanceledError: canceled' },
            { kind: 'unhandledrejection', message: 'AxiosError: Network Error' },
            { kind: 'unhandledrejection', message: 'TypeError: Failed to fetch' },
        ];
        for (const body of noise) expect((await report(body)).status).toBe(204);
        await settle();
        expect(await ErrorLog.countDocuments()).toBe(0);
    });

    it('validates and size-limits reports', async () => {
        expect((await report({ kind: 'nope', message: 'x' })).status).toBe(400);
        expect((await report({ kind: 'error' })).status).toBe(400);
        expect((await report({ kind: 'error', message: { $gt: '' } })).status).toBe(400);
        expect((await report({ kind: 'error', message: 'x'.repeat(2001) })).status).toBe(400);
        expect((await report({ kind: 'error', message: 'x', stack: 'y'.repeat(20000) })).status).toBe(413);
        await settle();
        expect(await ErrorLog.countDocuments()).toBe(0);
    });

    it('is rate-limited per IP', async () => {
        let firstLimited = -1;
        for (let i = 0; i < 40 && firstLimited < 0; i++) {
            const res = await report({ kind: 'error', message: `rate test ${i}` });
            if (res.status === 429) firstLimited = i;
        }
        // 30 per 10 minutes per IP; earlier tests in this file used some.
        expect(firstLimited).toBeGreaterThan(-1);
        expect(firstLimited).toBeLessThanOrEqual(30);
    });
});

describe('alert emails', () => {
    const occur = async (message, times = 1) => {
        for (let i = 0; i < times; i++) {
            captureError({ source: 'backend', message, stack: `Error: ${message}\n    at handler (/app/x.js:1:1)` });
            await settle();
        }
    };

    it('alerts on a new fingerprint only, and again when a resolved error comes back', async () => {
        await occur('First failure', 3);
        expect(sendErrorAlertEmail).toHaveBeenCalledTimes(1);
        expect(sendErrorAlertEmail.mock.calls[0][0]).toMatchObject({ to: 'alerts@example.com', kind: 'new', message: 'First failure', count: 1 });

        await ErrorLog.updateOne({}, { $set: { resolved: true, resolvedAt: new Date() } });
        await occur('First failure');
        expect(sendErrorAlertEmail).toHaveBeenCalledTimes(2);
        expect(sendErrorAlertEmail.mock.calls[1][0]).toMatchObject({ kind: 'reopened', count: 4 });
        expect(await ErrorLog.findOne().lean()).toMatchObject({ resolved: false, reopenedAt: expect.any(Date) });
    });

    it('alerts once on a spike (ERROR_ALERT_SPIKE_PER_HOUR)', async () => {
        process.env.ERROR_ALERT_SPIKE_PER_HOUR = '4';
        await occur('Spiky failure', 6);
        const kinds = sendErrorAlertEmail.mock.calls.map(([args]) => args.kind);
        expect(kinds).toEqual(['new', 'spike']);
        expect(sendErrorAlertEmail.mock.calls[1][0].lastHourCount).toBe(4);
    });

    it('caps alert emails per hour (ERROR_ALERT_MAX_PER_HOUR)', async () => {
        process.env.ERROR_ALERT_MAX_PER_HOUR = '2';
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        for (const message of ['Alpha broke', 'Beta broke', 'Gamma broke', 'Delta broke']) await occur(message);
        expect(sendErrorAlertEmail).toHaveBeenCalledTimes(2);
        expect(await ErrorLog.countDocuments()).toBe(4); // still all recorded
        process.env.ERROR_ALERT_MAX_PER_HOUR = '0';
        resetAlertWindow();
        await occur('Epsilon broke');
        expect(sendErrorAlertEmail).toHaveBeenCalledTimes(2); // 0 = alerts off
    });
});

describe('admin routes', () => {
    const seedErrors = async () => {
        captureError({ source: 'backend', message: 'Open problem' });
        captureError({ source: 'job', message: 'Old problem', jobType: 'translation-yo' });
        await settle();
        await ErrorLog.updateOne({ message: 'Old problem' }, { $set: { resolved: true } });
    };

    it('readers get 403 and anonymous callers 401 on list, resolve and delete', async () => {
        await seedErrors();
        const reader = await createUser({ role: 'reader' });
        const id = String((await ErrorLog.findOne().lean())._id);
        expect((await request(app).get('/api/errors').set(auth(reader))).status).toBe(403);
        expect((await request(app).put(`/api/errors/${id}`).set(auth(reader)).send({ resolved: true })).status).toBe(403);
        expect((await request(app).delete(`/api/errors/${id}`).set(auth(reader))).status).toBe(403);
        expect((await request(app).get('/api/errors')).status).toBe(401);
        expect(await ErrorLog.countDocuments()).toBe(2);
    });

    it('admins list (unresolved by default, newest first), resolve, reopen and delete', async () => {
        await seedErrors();
        const admin = await createUser({ role: 'admin' });
        const list = await request(app).get('/api/errors').set(auth(admin));
        expect(list.status).toBe(200);
        expect(list.body.errors.map((e) => e.message)).toEqual(['Open problem']);
        expect(list.body.unresolvedCount).toBe(1);
        expect(list.body.errors[0]).not.toHaveProperty('expiresAt');
        const all = await request(app).get('/api/errors?status=all').set(auth(admin));
        expect(all.body.errors).toHaveLength(2);

        const id = list.body.errors[0]._id;
        const resolved = await request(app).put(`/api/errors/${id}`).set(auth(admin)).send({ resolved: true });
        expect(resolved.body).toMatchObject({ resolved: true, resolvedAt: expect.any(String) });
        expect((await request(app).put(`/api/errors/${id}`).set(auth(admin)).send({ resolved: 'yes' })).status).toBe(400);
        expect((await request(app).delete(`/api/errors/${id}`).set(auth(admin))).status).toBe(200);
        expect((await request(app).delete(`/api/errors/${id}`).set(auth(admin))).status).toBe(404);
        expect((await request(app).put('/api/errors/not-an-id').set(auth(admin)).send({ resolved: true })).status).toBe(404);
    });
});
