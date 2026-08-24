// CORS allowlist behavior (Step 54 — deployment prep). app.js reads
// ALLOWED_ORIGINS/ALLOWED_ORIGIN_PATTERN at module-load time, so each test
// here resets the module registry and sets env vars *before* requiring
// '../app' fresh, rather than requiring it once at the top of the file.
//
// Uses GET /api/auth/profile as a cheap probe target — it 401s immediately
// on a missing token, before ever touching the DB, so no mongodb-memory-server
// setup is needed here. Only the CORS response header/status is under test.
describe('CORS allowlist', () => {
    const ORIGINAL_ENV = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...ORIGINAL_ENV };
    });

    afterAll(() => {
        process.env = ORIGINAL_ENV;
    });

    it('allows a configured production origin', async () => {
        process.env.ALLOWED_ORIGINS = 'https://kenlibs.app,https://admin.kenlibs.app';
        delete process.env.ALLOWED_ORIGIN_PATTERN;
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app).get('/api/auth/profile').set('Origin', 'https://kenlibs.app');

        expect(res.headers['access-control-allow-origin']).toBe('https://kenlibs.app');
    });

    it('rejects a random unrelated origin', async () => {
        process.env.ALLOWED_ORIGINS = 'https://kenlibs.app';
        delete process.env.ALLOWED_ORIGIN_PATTERN;
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app)
            .get('/api/auth/profile')
            .set('Origin', 'https://evil-phishing-site.com');

        expect(res.headers['access-control-allow-origin']).toBeUndefined();
        expect(res.status).toBe(500);
    });

    it('rejects a Vercel-style preview origin when ALLOWED_ORIGIN_PATTERN is not set', async () => {
        process.env.ALLOWED_ORIGINS = 'https://kenlibs.app';
        delete process.env.ALLOWED_ORIGIN_PATTERN;
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app)
            .get('/api/auth/profile')
            .set('Origin', 'https://kenlibs-git-feature-me.vercel.app');

        expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('allows a Vercel-style preview origin once ALLOWED_ORIGIN_PATTERN opts in', async () => {
        process.env.ALLOWED_ORIGINS = 'https://kenlibs.app';
        process.env.ALLOWED_ORIGIN_PATTERN = 'https://*.vercel.app';
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app)
            .get('/api/auth/profile')
            .set('Origin', 'https://kenlibs-git-feature-me.vercel.app');

        expect(res.headers['access-control-allow-origin']).toBe('https://kenlibs-git-feature-me.vercel.app');
    });

    it('rejects an origin that merely contains the allowed suffix rather than exactly matching it', async () => {
        process.env.ALLOWED_ORIGINS = 'https://kenlibs.app';
        process.env.ALLOWED_ORIGIN_PATTERN = 'https://*.vercel.app';
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app)
            .get('/api/auth/profile')
            .set('Origin', 'https://vercel.app.evil.com');

        expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('rejects a multi-label subdomain — the pattern wildcard is one DNS label, not `.*`', async () => {
        process.env.ALLOWED_ORIGINS = 'https://kenlibs.app';
        process.env.ALLOWED_ORIGIN_PATTERN = 'https://*.vercel.app';
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app)
            .get('/api/auth/profile')
            .set('Origin', 'https://a.b.vercel.app');

        expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('falls back to FRONTEND_URL when ALLOWED_ORIGINS is unset', async () => {
        delete process.env.ALLOWED_ORIGINS;
        delete process.env.ALLOWED_ORIGIN_PATTERN;
        process.env.FRONTEND_URL = 'https://kenlibs.app';
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app).get('/api/auth/profile').set('Origin', 'https://kenlibs.app');

        expect(res.headers['access-control-allow-origin']).toBe('https://kenlibs.app');
    });

    it('allows requests with no Origin header at all (non-browser / same-origin)', async () => {
        process.env.ALLOWED_ORIGINS = 'https://kenlibs.app';
        delete process.env.ALLOWED_ORIGIN_PATTERN;
        const request = require('supertest');
        const app = require('../app');

        const res = await request(app).get('/api/auth/profile');

        expect(res.status).toBe(401); // reaches the route normally, not blocked by CORS
    });
});
