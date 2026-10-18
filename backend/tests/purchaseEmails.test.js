// Purchase notification emails (purchaseController.js → utils/sendEmail.js).
//
// Same mocking pattern as passwordReset.test.js (jest.mock of
// utils/sendEmail with jest.fn helpers), except the two purchase helpers
// call through to their real implementations by default. That way tests can
// assert who was emailed with what (mock.calls), and also inspect the real
// rendered HTML, captured from a stubbed fetch to Brevo. Nothing ever
// leaves the process. Failure tests override a single call with
// mockRejectedValueOnce / a never-settling promise.
jest.mock('../utils/sendEmail', () => {
    const actual = jest.requireActual('../utils/sendEmail');
    return {
        ...actual,
        sendPurchaseRequestAdminEmail: jest.fn((...args) => actual.sendPurchaseRequestAdminEmail(...args)),
        sendPurchaseDecisionEmail: jest.fn((...args) => actual.sendPurchaseDecisionEmail(...args)),
    };
});

jest.mock('../utils/cloudinaryUpload', () => ({
    uploadBufferToCloudinary: jest.fn().mockResolvedValue({
        secure_url: 'https://res.cloudinary.com/fake/image/upload/secret-evidence.png',
    }),
}));

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const PurchaseRequest = require('../models/PurchaseRequest');
const { sendPurchaseRequestAdminEmail, sendPurchaseDecisionEmail } = require('../utils/sendEmail');
const { createUser, tokenFor, createBook, createBundle, createPurchaseRequest } = require('./helpers');

const EVIDENCE_URL = 'https://res.cloudinary.com/fake/image/upload/secret-evidence.png';
const ENV_KEYS = ['BREVO_API_KEY', 'EMAIL_FROM', 'GMAIL_USER', 'GMAIL_APP_PASSWORD', 'ADMIN_NOTIFY_EMAIL', 'FRONTEND_URL'];
const originalEnv = {};
const originalFetch = global.fetch;

beforeAll(async () => {
    ENV_KEYS.forEach((key) => {
        originalEnv[key] = process.env[key];
        delete process.env[key];
    });
    process.env.BREVO_API_KEY = 'test-brevo-key';
    process.env.EMAIL_FROM = 'kenlibs@example.com';
    process.env.FRONTEND_URL = 'https://kenlibs.test';
    await db.connect();
});

let consoleErrorSpy;
beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
    await db.clearDatabase();
    sendPurchaseRequestAdminEmail.mockClear();
    sendPurchaseDecisionEmail.mockClear();
    consoleErrorSpy.mockRestore();
    delete process.env.ADMIN_NOTIFY_EMAIL;
});

afterAll(async () => {
    await db.closeDatabase();
    global.fetch = originalFetch;
    ENV_KEYS.forEach((key) => {
        if (originalEnv[key] === undefined) delete process.env[key];
        else process.env[key] = originalEnv[key];
    });
});

// Emails are fire-and-forget, so they land just after the response does.
const waitFor = async (assertion, timeoutMs = 3000) => {
    const started = Date.now();
    for (;;) {
        try {
            return assertion();
        } catch (error) {
            if (Date.now() - started > timeoutMs) throw error;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }
};

// Long enough for any fire-and-forget send to have started if it was going to.
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

// Every Brevo payload sent so far, parsed.
const sentEmails = () => global.fetch.mock.calls.map(([, options]) => JSON.parse(options.body));
const sentTo = (email) => sentEmails().filter((body) => body.to[0].email === email);

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

const submitPurchase = (reader, { itemType = 'book', item, creditApplied } = {}) => {
    const req = request(app)
        .post('/api/purchases')
        .set(auth(reader))
        .field('itemType', itemType)
        .field('item', item.toString());
    if (creditApplied) req.field('creditApplied', String(creditApplied));
    return req.attach('evidenceImage', Buffer.from('fake-image-bytes'), 'evidence.png');
};

describe('admin email: new purchase request', () => {
    it('emails every admin with the reader, item, amount, credit, and a link to /admin/purchases', async () => {
        const admin = await createUser({ role: 'admin', email: 'boss@example.com' });
        const reader = await createUser({ name: 'Ada Reader', email: 'ada@example.com', creditBalance: 300 });
        const book = await createBook({ userId: admin._id, title: 'Deep Work', price: 1500 });

        const res = await submitPurchase(reader, { item: book._id, creditApplied: 300 });
        expect(res.status).toBe(201);

        await waitFor(() => expect(sentTo('boss@example.com')).toHaveLength(1));
        expect(sendPurchaseRequestAdminEmail).toHaveBeenCalledTimes(1);
        expect(sendPurchaseRequestAdminEmail.mock.calls[0][0]).toMatchObject({
            to: 'boss@example.com',
            readerName: 'Ada Reader',
            readerEmail: 'ada@example.com',
            itemType: 'book',
            itemTitle: 'Deep Work',
            amount: 1500,
            creditApplied: 300,
            isResubmission: false,
        });

        const [email] = sentTo('boss@example.com');
        expect(email.subject).toBe('New purchase request: Deep Work');
        expect(email.htmlContent).toContain('https://kenlibs.test/admin/purchases');
        expect(email.htmlContent).toContain('Ada Reader');
        expect(email.htmlContent).toContain('₦1,500');
        expect(email.htmlContent).toContain('₦300');
        expect(email.textContent).toContain('Amount to verify: ₦1,200');
        expect(email.textContent).toContain('https://kenlibs.test/admin/purchases');
        // The evidence image is never put in an email.
        expect(JSON.stringify(email)).not.toContain(EVIDENCE_URL);
    });

    it('sends to ADMIN_NOTIFY_EMAIL instead of admin accounts when it is set', async () => {
        process.env.ADMIN_NOTIFY_EMAIL = 'orders@example.com';
        await createUser({ role: 'admin', email: 'boss@example.com' });
        const reader = await createUser();
        const bundle = await createBundle({ title: 'Starter Pack' });

        const res = await submitPurchase(reader, { itemType: 'bundle', item: bundle._id });
        expect(res.status).toBe(201);

        await waitFor(() => expect(sentTo('orders@example.com')).toHaveLength(1));
        expect(sentTo('boss@example.com')).toHaveLength(0);
        expect(sendPurchaseRequestAdminEmail.mock.calls[0][0]).toMatchObject({
            itemType: 'bundle',
            itemTitle: 'Starter Pack',
        });
    });

    it('escapes HTML in the reader name and item title', async () => {
        const admin = await createUser({ role: 'admin', email: 'boss@example.com' });
        const reader = await createUser({ name: '<img src=x onerror=alert(1)>' });
        const book = await createBook({ userId: admin._id, title: '<b>Bold</b> & "Co"' });

        await submitPurchase(reader, { item: book._id });
        await waitFor(() => expect(sentTo('boss@example.com')).toHaveLength(1));

        const { htmlContent } = sentTo('boss@example.com')[0];
        expect(htmlContent).toContain('&lt;img src=x onerror=alert(1)&gt;');
        expect(htmlContent).not.toContain('<img src=x');
        expect(htmlContent).toContain('&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;Co&quot;');
        expect(htmlContent).not.toContain('<b>Bold</b>');
    });

    it('still returns 201 and saves the request when the email fails', async () => {
        sendPurchaseRequestAdminEmail.mockRejectedValueOnce(new Error('Brevo is down'));
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser();
        const book = await createBook({ userId: admin._id });

        const res = await submitPurchase(reader, { item: book._id });

        expect(res.status).toBe(201);
        expect(await PurchaseRequest.countDocuments({})).toBe(1);
        await waitFor(() =>
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining(`purchase request ${res.body._id}`),
                'Brevo is down'
            )
        );
    });

    it('responds without waiting when the email provider never answers', async () => {
        sendPurchaseRequestAdminEmail.mockReturnValueOnce(new Promise(() => {}));
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser();
        const book = await createBook({ userId: admin._id });

        const started = Date.now();
        const res = await submitPurchase(reader, { item: book._id });

        expect(res.status).toBe(201);
        expect(Date.now() - started).toBeLessThan(5000);
        await waitFor(() => expect(sendPurchaseRequestAdminEmail).toHaveBeenCalledTimes(1));
    });

    it('sends nothing when validation fails', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser();
        const book = await createBook({ userId: admin._id });
        const draft = await createBook({ userId: admin._id, status: 'draft' });

        const noEvidence = await request(app)
            .post('/api/purchases')
            .set(auth(reader))
            .field('itemType', 'book')
            .field('item', book._id.toString());
        expect(noEvidence.status).toBe(400);

        const notForSale = await submitPurchase(reader, { item: draft._id });
        expect(notForSale.status).toBe(400);

        await settle();
        expect(sendPurchaseRequestAdminEmail).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('rejects a duplicate while a request for the same item is pending, without emailing', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ creditBalance: 500 });
        const book = await createBook({ userId: admin._id });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'pending' });

        const res = await submitPurchase(reader, { item: book._id, creditApplied: 500 });

        expect(res.status).toBe(409);
        expect(res.body.status).toBe('pending');
        expect(await PurchaseRequest.countDocuments({})).toBe(1);
        // Rejected before any store credit was spent.
        const User = require('../models/User');
        expect((await User.findById(reader._id)).creditBalance).toBe(500);
        await settle();
        expect(sendPurchaseRequestAdminEmail).not.toHaveBeenCalled();
    });
});

describe('admin email: resubmitted request', () => {
    it('emails the admin again, marked as a resubmission', async () => {
        const admin = await createUser({ role: 'admin', email: 'boss@example.com' });
        const reader = await createUser({ name: 'Ada Reader' });
        const book = await createBook({ userId: admin._id, title: 'Deep Work' });
        const rejected = await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'rejected' });

        const res = await request(app)
            .put(`/api/purchases/${rejected._id}/resubmit`)
            .set(auth(reader))
            .attach('evidenceImage', Buffer.from('new-evidence'), 'evidence.png');
        expect(res.status).toBe(200);

        await waitFor(() => expect(sentTo('boss@example.com')).toHaveLength(1));
        expect(sendPurchaseRequestAdminEmail.mock.calls[0][0]).toMatchObject({
            itemTitle: 'Deep Work',
            readerName: 'Ada Reader',
            isResubmission: true,
        });
        const [email] = sentTo('boss@example.com');
        expect(email.subject).toBe('Resubmitted purchase request: Deep Work');
        expect(email.htmlContent).toMatch(/resubmitted a purchase request you previously rejected/);
        expect(JSON.stringify(email)).not.toContain(EVIDENCE_URL);
    });

    it('sends nothing when the request does not exist', async () => {
        const reader = await createUser();
        const missingId = new (require('mongoose').Types.ObjectId)();

        const res = await request(app)
            .put(`/api/purchases/${missingId}/resubmit`)
            .set(auth(reader))
            .attach('evidenceImage', Buffer.from('new-evidence'), 'evidence.png');

        expect(res.status).toBe(404);
        await settle();
        expect(sendPurchaseRequestAdminEmail).not.toHaveBeenCalled();
    });
});

describe('reader email: admin decisions', () => {
    const setup = async ({ status = 'pending', itemType = 'book', readerName = 'Ada Reader' } = {}) => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ name: readerName, email: 'ada@example.com' });
        const item =
            itemType === 'book'
                ? await createBook({ userId: admin._id, title: 'Deep Work' })
                : await createBundle({ title: 'Starter Pack' });
        const purchase = await createPurchaseRequest({ reader, itemType, item: item._id, status });
        return { admin, reader, item, purchase };
    };

    it('emails the reader on approve, linking straight to the book', async () => {
        const { admin, item, purchase } = await setup();

        const res = await request(app).put(`/api/purchases/${purchase._id}/approve`).set(auth(admin));
        expect(res.status).toBe(200);

        await waitFor(() => expect(sentTo('ada@example.com')).toHaveLength(1));
        expect(sendPurchaseDecisionEmail.mock.calls[0][0]).toMatchObject({
            to: 'ada@example.com',
            readerName: 'Ada Reader',
            decision: 'approved',
            itemType: 'book',
            itemId: item._id.toString(),
            itemTitle: 'Deep Work',
        });
        const [email] = sentTo('ada@example.com');
        expect(email.subject).toBe('Your purchase is approved: Deep Work');
        expect(email.htmlContent).toContain(`https://kenlibs.test/kenlibs/read/${item._id}`);
    });

    it('links an approved bundle to the Library', async () => {
        const { admin, purchase } = await setup({ itemType: 'bundle' });

        await request(app).put(`/api/purchases/${purchase._id}/approve`).set(auth(admin));

        await waitFor(() => expect(sentTo('ada@example.com')).toHaveLength(1));
        expect(sentTo('ada@example.com')[0].htmlContent).toContain('https://kenlibs.test/kenlibs/my-books');
        expect(sentTo('ada@example.com')[0].htmlContent).toContain('Go to your Library');
        expect(sentTo('ada@example.com')[0].htmlContent).not.toContain('My Books');
    });

    it('emails the reader on reject, with the admin note shown and escaped', async () => {
        const { admin, purchase } = await setup({ readerName: '<script>alert(1)</script>' });
        const note = 'Amount was wrong. <a href="https://evil.example">click</a>\nPlease resend.';

        const res = await request(app)
            .put(`/api/purchases/${purchase._id}/reject`)
            .set(auth(admin))
            .send({ adminNote: note });
        expect(res.status).toBe(200);

        await waitFor(() => expect(sentTo('ada@example.com')).toHaveLength(1));
        expect(sendPurchaseDecisionEmail.mock.calls[0][0]).toMatchObject({
            decision: 'rejected',
            adminNote: note,
        });

        const [email] = sentTo('ada@example.com');
        expect(email.subject).toBe('Your purchase request was not approved: Deep Work');
        expect(email.htmlContent).toContain('Reason');
        expect(email.htmlContent).toContain(
            'Amount was wrong. &lt;a href=&quot;https://evil.example&quot;&gt;click&lt;/a&gt;<br />Please resend.'
        );
        expect(email.htmlContent).not.toContain('<a href="https://evil.example">');
        expect(email.htmlContent).toContain('Hi &lt;script&gt;alert(1)&lt;/script&gt;,');
        expect(email.htmlContent).not.toContain('<script>');
        expect(email.htmlContent).toContain('https://kenlibs.test/kenlibs/my-books');
        expect(email.textContent).toContain('from your Library and resubmit it');
        expect(email.htmlContent + email.textContent).not.toContain('My Books');
        // Plain-text version carries the note as-is.
        expect(email.textContent).toContain('Please resend.');
    });

    it('emails the reader on revoke, with the note', async () => {
        const { admin, purchase } = await setup({ status: 'approved' });

        const res = await request(app)
            .put(`/api/purchases/${purchase._id}/revoke`)
            .set(auth(admin))
            .send({ adminNote: 'Payment was reversed by the bank.' });
        expect(res.status).toBe(200);

        await waitFor(() => expect(sentTo('ada@example.com')).toHaveLength(1));
        expect(sendPurchaseDecisionEmail.mock.calls[0][0]).toMatchObject({ decision: 'revoked' });
        const [email] = sentTo('ada@example.com');
        expect(email.subject).toBe('Your access has changed: Deep Work');
        expect(email.htmlContent).toContain('Payment was reversed by the bank.');
        expect(email.htmlContent).toContain('https://kenlibs.test/kenlibs/my-books');
        expect(email.htmlContent).toContain('Go to your Library');
    });

    it('still returns 200 and keeps the new status when the email fails', async () => {
        sendPurchaseDecisionEmail.mockRejectedValueOnce(new Error('Brevo is down'));
        const { admin, purchase } = await setup();

        const res = await request(app).put(`/api/purchases/${purchase._id}/approve`).set(auth(admin));

        expect(res.status).toBe(200);
        expect(res.body.status).toBe('approved');
        expect((await PurchaseRequest.findById(purchase._id)).status).toBe('approved');
        await waitFor(() =>
            expect(consoleErrorSpy).toHaveBeenCalledWith(
                expect.stringContaining(`purchase request ${purchase._id}`),
                'Brevo is down'
            )
        );
    });

    it('responds without waiting when the email provider never answers', async () => {
        sendPurchaseDecisionEmail.mockReturnValueOnce(new Promise(() => {}));
        const { admin, purchase } = await setup();

        const started = Date.now();
        const res = await request(app)
            .put(`/api/purchases/${purchase._id}/reject`)
            .set(auth(admin))
            .send({ adminNote: 'Blurry screenshot' });

        expect(res.status).toBe(200);
        expect(Date.now() - started).toBeLessThan(5000);
    });

    it('sends nothing when the transition is not allowed', async () => {
        const { admin, purchase } = await setup({ status: 'approved' });

        const res = await request(app)
            .put(`/api/purchases/${purchase._id}/reject`)
            .set(auth(admin))
            .send({ adminNote: 'Too late' });

        expect(res.status).toBe(400);
        await settle();
        expect(sendPurchaseDecisionEmail).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('sends nothing when the request does not exist', async () => {
        const admin = await createUser({ role: 'admin' });
        const missingId = new (require('mongoose').Types.ObjectId)();

        const res = await request(app).put(`/api/purchases/${missingId}/approve`).set(auth(admin));

        expect(res.status).toBe(404);
        await settle();
        expect(sendPurchaseDecisionEmail).not.toHaveBeenCalled();
    });

    it('does not let a reader trigger a decision email', async () => {
        const { reader, purchase } = await setup();

        const res = await request(app).put(`/api/purchases/${purchase._id}/approve`).set(auth(reader));

        expect(res.status).toBe(403);
        await settle();
        expect(sendPurchaseDecisionEmail).not.toHaveBeenCalled();
    });
});
