// Anonymous book-page view counting (BookViewDaily): published books only,
// one number per book per Lagos day and nothing about the visitor, bots and
// prefetches skipped, rate-limited per IP, switchable off.
const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const BookViewDaily = require('../models/BookViewDaily');
const { lagosDay } = require('../utils/lagosTime');
const { createBook } = require('./helpers');

const BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36';
const view = (bookId, userAgent = BROWSER, headers = {}) =>
    request(app).post(`/api/public/kenlibs/books/${bookId}/view`).set('User-Agent', userAgent).set(headers);

beforeAll(async () => db.connect());
afterEach(async () => {
    delete process.env.BOOK_VIEW_TRACKING_ENABLED;
    await db.clearDatabase();
});
afterAll(async () => db.closeDatabase());

describe('POST /api/public/kenlibs/books/:id/view', () => {
    it("counts views of a published book per Lagos day, storing nothing about the visitor", async () => {
        const book = await createBook({ status: 'published' });
        expect((await view(book._id)).status).toBe(204);
        expect((await view(book._id)).status).toBe(204);
        const docs = await BookViewDaily.find().lean();
        expect(docs).toHaveLength(1);
        expect(docs[0]).toMatchObject({ day: lagosDay(), views: 2 });
        expect(Object.keys(docs[0]).sort()).toEqual(['__v', '_id', 'book', 'day', 'views']);
    });

    it('ignores drafts, unknown ids, bots, link previewers and prefetches', async () => {
        const draft = await createBook({ status: 'draft' });
        const book = await createBook({ status: 'published' });
        expect((await view(draft._id)).status).toBe(204);
        expect((await view('64b000000000000000000000')).status).toBe(204);
        expect((await view('not-an-id')).status).toBe(204);
        for (const ua of ['Googlebot/2.1 (+http://www.google.com/bot.html)', 'facebookexternalhit/1.1', 'WhatsApp/2.23', 'curl/8.4.0', 'HeadlessChrome/120', '']) {
            expect((await view(book._id, ua)).status).toBe(204);
        }
        expect((await view(book._id, BROWSER, { Purpose: 'prefetch' })).status).toBe(204);
        expect(await BookViewDaily.countDocuments()).toBe(0);
    });

    it('can be switched off with BOOK_VIEW_TRACKING_ENABLED=false', async () => {
        process.env.BOOK_VIEW_TRACKING_ENABLED = 'false';
        const book = await createBook({ status: 'published' });
        expect((await view(book._id)).status).toBe(204);
        expect(await BookViewDaily.countDocuments()).toBe(0);
    });

    it('is rate-limited per IP', async () => {
        const book = await createBook({ status: 'published' });
        let limitedAt = -1;
        for (let i = 0; i < 70 && limitedAt < 0; i++) {
            if ((await view(book._id)).status === 429) limitedAt = i;
        }
        // 60 per 10 minutes; earlier tests in this file used some.
        expect(limitedAt).toBeGreaterThan(-1);
        expect(limitedAt).toBeLessThanOrEqual(60);
    });
});
