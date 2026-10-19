// "Import a book", rights and royalties:
//   parsing each format, sanitising, rejecting malicious/oversized files,
//   the import API (admin only, draft only, images), the publish guard,
//   takedown, royalty calculation, admin-only endpoints, and a no-leak test
//   proving rights/royalty data never reaches a public or reader response.
jest.mock('../utils/cloudinaryUpload', () => {
    let n = 0;
    return {
        uploadBufferToCloudinary: jest.fn().mockImplementation(async (buffer, folder) => ({
            secure_url: `https://res.cloudinary.com/fake/image/upload/${folder}/upload-${++n}.png`,
        })),
    };
});
jest.mock('../utils/sendEmail', () => ({
    sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
    sendPurchaseRequestAdminEmail: jest.fn().mockResolvedValue(undefined),
    sendPurchaseDecisionEmail: jest.fn().mockResolvedValue(undefined),
    sendEmail: jest.fn().mockResolvedValue(undefined),
}));

const request = require('supertest');
const app = require('../app');
const db = require('./dbHandler');
const Book = require('../models/Book');
const PurchaseRequest = require('../models/PurchaseRequest');
const RoyaltyPayment = require('../models/RoyaltyPayment');
const { createUser, tokenFor, createBook, createBundle, createPurchaseRequest } = require('./helpers');
const { parseUpload } = require('../utils/import/parseBook');
const { importLimits } = require('../utils/import/limits');
const { publishGuard, parseRightsInput, licenceStatus } = require('../utils/bookRights');
const fixtures = require('./importFixtures');

const auth = (user) => ({ Authorization: `Bearer ${tokenFor(user)}` });

beforeAll(db.connect);
afterEach(db.clearDatabase);
afterAll(db.closeDatabase);

describe('parsing each format', () => {
    it('.docx: title/author from properties, chapters at headings, bold/italic, lists, images; scripts escaped', async () => {
        const draft = await parseUpload(await fixtures.makeDocx(), 'rivers.docx');
        expect(draft).toMatchObject({ format: 'docx', title: 'Rivers of Lagos', author: 'Chinwe Okafor' });
        expect(draft.chapters.map((c) => c.title)).toEqual(['Chapter One: The Market', 'Chapter Two: The River']);
        const [one, two] = draft.chapters;
        expect(one.content).toContain('**bold voices**');
        expect(one.content).toContain('*quiet deals*');
        expect(one.content).toContain('- Fish sellers\n- Cloth traders');
        expect(one.content).toMatch(/!\[\]\(kenlibs-import:img1\)/);
        expect(draft.images.img1.dataUri).toMatch(/^data:image\/png;base64,/);
        expect(two.content).toContain('> A quiet aside');
        // Text that looks like HTML stays text.
        expect(two.content).toContain('\\<script\\>alert(1)\\</script\\>');
        expect(one.wordCount).toBeGreaterThan(5);
    });

    it('.epub: metadata, table-of-contents titles, cover, images, quotes and lists; unsafe markup dropped', async () => {
        const draft = await parseUpload(await fixtures.makeEpub(), 'letters.epub');
        expect(draft).toMatchObject({ format: 'epub', title: 'The Harmattan Letters', author: 'Ade Bello', description: 'Letters from the dry season.' });
        expect(draft.chapters.map((c) => c.title)).toEqual(['First Letter', 'Second Letter']);
        expect(draft.coverKey).toBeTruthy();
        const [one, two] = draft.chapters;
        expect(one.content).toContain('Dear Amaka, the *dust* came early this year.');
        expect(one.content).toMatch(/!\[Dust\]\(kenlibs-import:img\d\)/);
        expect(one.content).toContain('[a real link](https://example.com)');
        expect(one.content).not.toMatch(/javascript|steal|alert/);
        expect(two.content).toContain('> Patience is a long road.');
        expect(two.content).toContain('1. Water\n2. Shade');
        expect(two.content).not.toMatch(/iframe|evil/);
    });

    it('.pdf: text extraction, metadata and "Chapter N" headings', async () => {
        const draft = await parseUpload(await fixtures.makePdf({ pages: 2 }), 'kano.pdf');
        expect(draft).toMatchObject({ format: 'pdf', title: 'Notes from Kano', author: 'Musa Ibrahim' });
        expect(draft.chapters.map((c) => c.title)).toEqual(['Chapter 1', 'Chapter 2']);
        expect(draft.chapters[0].content).toContain('The caravan moved slowly');
        expect(draft.warnings.join(' ')).toMatch(/text only/);
    });

    it('.pdf that looks scanned is rejected with a clear message', async () => {
        await expect(parseUpload(await fixtures.makePdf({ pages: 2, text: false }), 'scan.pdf')).rejects.toThrow(/scanned/);
    });

    it('.md and .txt', async () => {
        const md = await parseUpload(Buffer.from('# Book Title\n\n## Start\n\nHello *you* <b onclick="x()">raw</b>\n\n![remote](https://tracker.example/p.png)\n\n## End\n\nBye.'), 'notes.md');
        expect(md.title).toBe('Book Title');
        expect(md.chapters.map((c) => c.title)).toEqual(['Start', 'End']);
        expect(md.chapters[0].content).toContain('Hello *you* \\<b onclick="x()"\\>raw\\</b\\>');
        expect(md.chapters[0].content).not.toContain('tracker.example');
        expect(md.warnings.join(' ')).toMatch(/image link was left out/);
        const txt = await parseUpload(Buffer.from('Chapter 1\n\nIt was a long day.\n\nChapter 2\n\nNight fell.'), 'story.txt');
        expect(txt.chapters.map((c) => [c.title, c.content])).toEqual([['Chapter 1', 'It was a long day.'], ['Chapter 2', 'Night fell.']]);
        const plain = await parseUpload(Buffer.from('Just one paragraph of text.'), 'one.txt');
        expect(plain.chapters).toHaveLength(1);
    });
});

describe('malicious or oversized files are rejected', () => {
    const small = { ...importLimits(), maxZipEntries: 20, maxZipTotalBytes: 1024 * 1024, maxZipEntryBytes: 512 * 1024 };

    it('checks the real file type, not the name', async () => {
        await expect(parseUpload(Buffer.from('MZ\x90\x00 fake exe'), 'book.docx')).rejects.toThrow(/not supported|isn't supported/);
        await expect(parseUpload(Buffer.from('MZ\x90\x00 fake exe'), 'book.txt')).rejects.toThrow(/supported/);
        await expect(parseUpload(await fixtures.makePdf(), 'book.docx')).rejects.toThrow(/PDF/);
        await expect(parseUpload(Buffer.from([0x00, 0x01, 0x02, 0x03]), 'book.txt')).rejects.toThrow(/plain text/);
        await expect(parseUpload(Buffer.from('<html>hi</html>'), 'book.html')).rejects.toThrow(/Unsupported/);
        // A .docx that's really an .epub (or any other zip) is refused.
        await expect(parseUpload(await fixtures.makeEpub(), 'book.docx')).rejects.toThrow(/valid \.docx/);
        await expect(parseUpload(await fixtures.zipOf({ 'a.txt': 'hello' }), 'book.epub')).rejects.toThrow(/valid \.epub/);
    });

    it('zip bombs: too large once unpacked (even when the archive lies about sizes)', async () => {
        const bomb = await fixtures.zipOf({ mimetype: 'application/epub+zip', 'big.xhtml': Buffer.alloc(5 * 1024 * 1024, 0x41) });
        expect(bomb.length).toBeLessThan(100 * 1024); // tiny on disk
        await expect(parseUpload(bomb, 'bomb.epub', small)).rejects.toThrow(/too large/);
        // Tamper with the declared size in both headers: inflation is still counted.
        const lying = Buffer.from(bomb);
        for (let i = 0; i < lying.length - 4; i++) {
            if (lying.readUInt32LE(i) === 0x04034b50 || lying.readUInt32LE(i) === 0x02014b50) {
                const sizeOffset = lying.readUInt32LE(i) === 0x04034b50 ? i + 22 : i + 24;
                if (lying.readUInt32LE(sizeOffset) === 5 * 1024 * 1024) lying.writeUInt32LE(100, sizeOffset);
            }
        }
        await expect(parseUpload(lying, 'bomb.epub', small)).rejects.toThrow(/too large|damaged/);
    });

    it('too many entries, unsafe paths', async () => {
        const many = {};
        for (let i = 0; i < 30; i++) many[`f${i}.txt`] = 'x';
        await expect(parseUpload(await fixtures.makeEpub(many), 'many.epub', small)).rejects.toThrow(/too many parts/);
        await expect(parseUpload(await fixtures.makeEpub({ '../escape.xhtml': '<p>x</p>' }), 'evil.epub')).rejects.toThrow(/unsafe path|damaged/);
        const deep = {};
        deep[`${'d/'.repeat(20)}x.xhtml`] = '<p>x</p>';
        await expect(parseUpload(await fixtures.makeEpub(deep), 'deep.epub')).rejects.toThrow(/nested too deeply/);
    });

    it('size limit', async () => {
        await expect(parseUpload(Buffer.alloc(2048, 0x41), 'a.txt', { ...importLimits(), maxFileBytes: 1024, maxFileMb: 0.001 })).rejects.toThrow(/larger than/);
    });
});

describe('import API', () => {
    it('is admin-only', async () => {
        const reader = await createUser({ role: 'reader' });
        expect((await request(app).post('/api/admin/import/parse')).status).toBe(401);
        expect((await request(app).post('/api/admin/import/parse').set(auth(reader)).attach('file', Buffer.from('hi'), 'a.txt')).status).toBe(403);
        expect((await request(app).post('/api/admin/import/commit').set(auth(reader)).send({})).status).toBe(403);
    });

    it('parse → review → commit creates a DRAFT with images on Cloudinary; the file is not stored', async () => {
        const admin = await createUser({ role: 'admin' });
        const parsed = await request(app).post('/api/admin/import/parse').set(auth(admin)).attach('file', await fixtures.makeEpub(), 'letters.epub');
        expect(parsed.status).toBe(200);
        expect(parsed.body.chapters).toHaveLength(2);

        const commit = await request(app)
            .post('/api/admin/import/commit')
            .set(auth(admin))
            .send({
                ...parsed.body,
                status: 'published', // ignored: imports are always drafts
                chapters: [{ title: 'Letters', content: parsed.body.chapters.map((c) => c.content).join('\n\n') }],
                rights: { type: 'licensed', holderName: 'Ade Bello', licenceNotes: 'Email of 3 Oct 2026', royaltyPercent: 15, confirmedAt: '2020-01-01' },
            });
        expect(commit.body).toEqual(expect.objectContaining({ _id: expect.any(String) }));
        expect(commit.status).toBe(201);
        const book = await Book.findById(commit.body._id).lean();
        expect(book.status).toBe('draft');
        expect(book.author).toBe('Ade Bello');
        expect(book.chapters).toHaveLength(1);
        expect(book.chapters[0].content).toMatch(/!\[Dust\]\(https:\/\/res\.cloudinary\.com\/fake\/image\/upload\/ebook-creator\/chapters\/upload-\d+\.png\)/);
        expect(book.chapters[0].content).not.toContain('kenlibs-import:');
        expect(book.coverImage).toMatch(/ebook-creator\/covers\//);
        expect(book.rights).toMatchObject({ type: 'licensed', holderName: 'Ade Bello', royaltyPercent: 15, confirmedAt: null });
        expect(book.importedFrom).toMatchObject({ format: 'epub', fileName: 'letters.epub' });
        expect(JSON.stringify(book)).not.toMatch(/data:image/); // only the uploaded URLs are kept
    });

    it('rejects oversized uploads with 413', async () => {
        const admin = await createUser({ role: 'admin' });
        const before = process.env.IMPORT_MAX_FILE_MB;
        process.env.IMPORT_MAX_FILE_MB = '0.001';
        try {
            const res = await request(app).post('/api/admin/import/parse').set(auth(admin)).attach('file', Buffer.alloc(4096, 0x41), 'big.txt');
            expect(res.status).toBe(413);
        } finally {
            if (before === undefined) delete process.env.IMPORT_MAX_FILE_MB;
            else process.env.IMPORT_MAX_FILE_MB = before;
        }
    });

    it('commit validates its input and refuses forged images', async () => {
        const admin = await createUser({ role: 'admin' });
        const post = (body) => request(app).post('/api/admin/import/commit').set(auth(admin)).send(body);
        expect((await post({ author: 'A', chapters: [{ title: 'x', content: 'y' }] })).status).toBe(400);
        expect((await post({ title: 'T', chapters: [{ title: 'x', content: 'y' }] })).status).toBe(400);
        expect((await post({ title: 'T', author: 'A', chapters: [] })).status).toBe(400);
        expect((await post({ title: 'T', author: 'A', chapters: [{ title: 'x', content: 'y' }], rights: { royaltyPercent: 150 } })).status).toBe(400);
        const forged = await post({
            title: 'T',
            author: 'A',
            chapters: [{ title: 'x', content: '![a](kenlibs-import:img1)' }],
            images: { img1: `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}` },
        });
        expect(forged.status).toBe(400);
    });

    it('parse is rate-limited per admin', async () => {
        const admin = await createUser({ role: 'admin' });
        let status;
        for (let i = 0; i < 31; i++) status = (await request(app).post('/api/admin/import/parse').set(auth(admin)).attach('file', Buffer.from(`Line ${i}`), 'a.txt')).status;
        expect(status).toBe(429);
    });
});

describe('rights and the publish guard', () => {
    it('rules', () => {
        expect(publishGuard({}).ok).toBe(true);
        expect(publishGuard({ type: 'own' }).ok).toBe(true);
        expect(publishGuard({ type: 'licensed' }, { confirmed: true }).missing).toEqual(['Rights holder name', 'Licence notes']);
        expect(publishGuard({ type: 'licensed', holderName: 'X', licenceNotes: 'Y' }).missing).toHaveLength(1);
        expect(publishGuard({ type: 'licensed', holderName: 'X', licenceNotes: 'Y' }, { confirmed: true }).ok).toBe(true);
        expect(publishGuard({ type: 'public_domain' }, { confirmed: true }).missing).toEqual(['A note on why the book is public domain']);
        expect(parseRightsInput({ type: 'stolen' }).error).toBeTruthy();
        expect(parseRightsInput({ royaltyPercent: -1 }).error).toBeTruthy();
        expect(parseRightsInput({ royaltyPercent: '12.5', holderName: '  Ada  ' }).rights).toEqual({ royaltyPercent: 12.5, holderName: 'Ada' });
        expect(licenceStatus({ type: 'licensed', licenceExpiresAt: new Date(Date.now() - 1000) })).toBe('expired');
        expect(licenceStatus({ type: 'licensed', licenceExpiresAt: new Date(Date.now() + 5 * 86400000) })).toBe('expiring');
        expect(licenceStatus({ type: 'own', licenceExpiresAt: new Date(0) })).toBe(null);
    });

    it('a licensed book needs the details and an explicit confirmation; who/when is recorded', async () => {
        const admin = await createUser({ role: 'admin' });
        const book = await createBook({ userId: admin._id, status: 'draft' });
        const publish = (body = {}) => request(app).put(`/api/books/${book._id}/publish`).set(auth(admin)).send(body);
        await request(app).put(`/api/books/${book._id}/rights`).set(auth(admin)).send({ type: 'licensed' });
        const blocked = await publish({ confirmRights: true });
        expect(blocked.status).toBe(400);
        expect(blocked.body.code).toBe('rights_required');
        expect(blocked.body.missing).toEqual(['Rights holder name', 'Licence notes']);
        await request(app).put(`/api/books/${book._id}/rights`).set(auth(admin)).send({ holderName: 'Ade Bello', licenceNotes: 'Signed agreement, 3 Oct 2026', royaltyPercent: 20 });
        expect((await publish({})).body.missing).toEqual(['Confirmation that you have the rights or written permission to sell this book']);
        expect((await publish({ confirmRights: 'yes' })).status).toBe(400); // must be literally true
        const ok = await publish({ confirmRights: true });
        expect(ok.status).toBe(200);
        expect(ok.body.status).toBe('published');
        const saved = await Book.findById(book._id).lean();
        expect(String(saved.rights.confirmedBy)).toBe(String(admin._id));
        expect(saved.rights.confirmedAt).toBeInstanceOf(Date);
    });

    it('own work publishes as before; the general update cannot publish or change rights', async () => {
        const admin = await createUser({ role: 'admin' });
        const own = await createBook({ userId: admin._id, status: 'draft' });
        expect((await request(app).put(`/api/books/${own._id}/publish`).set(auth(admin)).send({})).body.status).toBe('published');
        const licensed = await createBook({ userId: admin._id, status: 'draft' });
        await request(app).put(`/api/books/${licensed._id}/rights`).set(auth(admin)).send({ type: 'licensed' });
        const sneaky = await request(app)
            .put(`/api/books/${licensed._id}`)
            .set(auth(admin))
            .send({ title: 'New title', status: 'published', rights: { type: 'own' }, userId: admin._id });
        expect(sneaky.status).toBe(200);
        const saved = await Book.findById(licensed._id).lean();
        expect(saved).toMatchObject({ title: 'New title', status: 'draft' });
        expect(saved.rights.type).toBe('licensed');
    });

    it('existing books without rights default to own work', async () => {
        const admin = await createUser({ role: 'admin' });
        const old = await createBook({ userId: admin._id });
        await Book.collection.updateOne({ _id: old._id }, { $unset: { rights: '' } });
        const loaded = await Book.findById(old._id);
        expect(loaded.rights.type).toBe('own');
        expect(loaded.rights.royaltyPercent).toBe(0);
    });

    it('rights endpoints are admin-only and validate', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ userId: admin._id });
        expect((await request(app).put(`/api/books/${book._id}/rights`).set(auth(reader)).send({ type: 'licensed' })).status).toBe(403);
        expect((await request(app).post(`/api/books/${book._id}/unpublish`).set(auth(reader))).status).toBe(403);
        expect((await request(app).put(`/api/books/${book._id}/rights`).set(auth(admin)).send({ royaltyPercent: 101 })).status).toBe(400);
        expect((await request(app).put(`/api/books/${book._id}/rights`).set(auth(admin)).send({ licenceExpiresAt: 'soon' })).status).toBe(400);
    });

    it('takedown: unpublish immediately stops the store page and share link; buyers keep reading', async () => {
        const admin = await createUser({ role: 'admin' });
        const buyer = await createUser({ role: 'reader' });
        const book = await createBook({ userId: admin._id, status: 'published', chapters: [{ title: 'One', content: 'Text' }] });
        await Book.updateOne({ _id: book._id }, { $set: { shareId: 'share-abc-123' } });
        await createPurchaseRequest({ reader: buyer, itemType: 'book', item: book._id, status: 'approved' });
        expect((await request(app).get(`/api/public/books/share-abc-123`)).status).toBe(200);

        const res = await request(app).post(`/api/books/${book._id}/unpublish`).set(auth(admin)).send({ takedownNote: 'Licence withdrawn by the author' });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('draft');
        const again = await request(app).post(`/api/books/${book._id}/unpublish`).set(auth(admin)).send({});
        expect(again.body.status).toBe('draft'); // idempotent, never toggles back
        const saved = await Book.findById(book._id).lean();
        expect(saved.rights.takedownNote).toBe('Licence withdrawn by the author');
        expect(String(saved.rights.unpublishedBy)).toBe(String(admin._id));

        expect((await request(app).get(`/api/public/books/share-abc-123`)).status).toBe(404);
        expect((await request(app).get(`/api/public/kenlibs/books/${book._id}`)).status).toBe(404);
        expect((await request(app).get('/api/public/kenlibs')).body.books).toHaveLength(0);
        expect((await request(app).get(`/api/kenlibs/read/${book._id}`).set(auth(buyer))).status).toBe(200);
    });

    it('licence expiry is listed under needs attention; nothing is unpublished', async () => {
        const admin = await createUser({ role: 'admin' });
        const book = await createBook({ userId: admin._id, status: 'published' });
        await Book.updateOne({ _id: book._id }, { $set: { rights: { type: 'licensed', holderName: 'A', licenceNotes: 'B', licenceExpiresAt: new Date(Date.now() - 86400000) } } });
        const res = await request(app).get('/api/admin/attention').set(auth(admin));
        expect(res.body.licences).toMatchObject({ count: 1, expired: 1 });
        expect(res.body.licences.books[0]).toMatchObject({ title: book.title, status: 'expired', published: true });
        expect((await Book.findById(book._id)).status).toBe('published');
    });
});

describe('royalties', () => {
    const setup = async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const tester = await createUser({ role: 'reader' });
        await require('../models/User').updateOne({ _id: tester._id }, { $set: { isTestAccount: true } });
        const licensed = await createBook({ userId: admin._id, title: 'Licensed One', author: 'Ade Bello', price: 3000 });
        const second = await createBook({ userId: admin._id, title: 'Licensed Two', author: 'Ade Bello', price: 1000 });
        const own = await createBook({ userId: admin._id, title: 'My Own', author: 'Me', price: 1000 });
        await Book.updateOne({ _id: licensed._id }, { $set: { rights: { type: 'licensed', royaltyPercent: 10 } } });
        await Book.updateOne({ _id: second._id }, { $set: { rights: { type: 'licensed', royaltyPercent: 20 } } });
        const bundle = await createBundle({ title: 'Pair', books: [licensed._id, own._id], price: 3200 });
        const approve = async (user, itemType, item, amount, creditApplied = 0) => {
            const pr = await createPurchaseRequest({ reader: user, itemType, item, amount, status: 'approved' });
            await PurchaseRequest.updateOne({ _id: pr._id }, { $set: { creditApplied, reviewHistory: [{ status: 'approved', reviewedAt: new Date() }] } });
        };
        await approve(reader, 'book', licensed._id, 3000, 500); // cash 2500
        await approve(reader, 'book', second._id, 1000); // cash 1000
        await approve(reader, 'bundle', bundle._id, 3200); // licensed gets 3/4 = 2400
        await approve(tester, 'book', licensed._id, 3000); // test account
        await createPurchaseRequest({ reader, itemType: 'book', item: licensed._id, amount: 3000, status: 'pending' });
        await createPurchaseRequest({ reader, itemType: 'book', item: own._id, amount: 1000, status: 'approved' });
        return { admin, reader, licensed, second, own };
    };

    it('units, cash (amount − credit), bundle share, royalty owed; test data filter; payments and balance', async () => {
        const { admin, reader } = await setup();
        const get = (q = '') => request(app).get(`/api/admin/royalties?range=all${q}`).set(auth(admin));
        const all = (await get()).body;
        const one = all.books.find((b) => b.title === 'Licensed One');
        expect(one).toMatchObject({ units: 3, directUnits: 2, bundleUnits: 1, cash: 2500 + 2400 + 3000, royaltyPercent: 10, royaltyOwed: 790 });
        expect(all.books.find((b) => b.title === 'Licensed Two')).toMatchObject({ units: 1, cash: 1000, royaltyOwed: 200 });
        expect(all.books.find((b) => b.title === 'My Own')).toBeUndefined();

        const hidden = (await get('&hideTest=1')).body;
        expect(hidden.books.find((b) => b.title === 'Licensed One')).toMatchObject({ units: 2, cash: 4900, royaltyOwed: 490 });
        expect(hidden.authors).toEqual([expect.objectContaining({ author: 'Ade Bello', books: 2, units: 3, cash: 5900, royaltyOwed: 690, paidAllTime: 0, balance: 690 })]);

        // Mark as paid.
        const paid = await request(app).post('/api/admin/royalties/payments').set(auth(admin)).send({ authorName: 'Ade Bello', amount: 400, paidAt: new Date().toISOString(), note: 'Bank transfer' });
        expect(paid.status).toBe(201);
        expect((await request(app).post('/api/admin/royalties/payments').set(auth(admin)).send({ authorName: 'Ade Bello', amount: -5 })).status).toBe(400);
        const after = (await get('&hideTest=1')).body.authors[0];
        expect(after).toMatchObject({ paidAllTime: 400, paidInRange: 400, balance: 290 });
        expect((await get()).body.payments).toEqual([expect.objectContaining({ authorName: 'Ade Bello', amount: 400, note: 'Bank transfer' })]);
        const removed = await request(app).delete(`/api/admin/royalties/payments/${paid.body.id}`).set(auth(admin));
        expect(removed.status).toBe(200);
        expect(await RoyaltyPayment.countDocuments()).toBe(0);

        // Admin only.
        expect((await request(app).get('/api/admin/royalties').set(auth(reader))).status).toBe(403);
        expect((await request(app).post('/api/admin/royalties/payments').set(auth(reader)).send({ authorName: 'x', amount: 1 })).status).toBe(403);
    });
});

describe('no leaks: rights and royalty data never reach public or reader responses', () => {
    it('storefront, book page, share link, bundle, reader, library, purchases and access map', async () => {
        const admin = await createUser({ role: 'admin' });
        const reader = await createUser({ role: 'reader' });
        const book = await createBook({ userId: admin._id, status: 'published', title: 'Licensed Work', author: 'Ade Bello', chapters: [{ title: 'One', content: 'Body' }] });
        await Book.updateOne(
            { _id: book._id },
            {
                $set: {
                    shareId: 'leak-check-1',
                    rights: {
                        type: 'licensed',
                        holderName: 'SECRET-HOLDER',
                        holderContact: 'secret-contact@example.com',
                        licenceNotes: 'SECRET-LICENCE-NOTES',
                        licenceReference: 'SECRET-REF',
                        territory: 'SECRET-TERRITORY',
                        royaltyPercent: 37,
                        takedownNote: 'SECRET-TAKEDOWN',
                    },
                    importedFrom: { format: 'epub', fileName: 'SECRET-FILE.epub' },
                },
            }
        );
        const bundle = await createBundle({ title: 'Leak bundle', books: [book._id] });
        await createPurchaseRequest({ reader, itemType: 'book', item: book._id, status: 'approved' });
        const responses = [
            await request(app).get('/api/public/kenlibs'),
            await request(app).get(`/api/public/kenlibs/books/${book._id}`),
            await request(app).get('/api/public/books/leak-check-1'),
            await request(app).get(`/api/public/kenlibs/bundles/${bundle._id}`),
            await request(app).get(`/kenlibs/book/${book._id}`).set('User-Agent', 'WhatsApp/2.0'),
            await request(app).get(`/api/kenlibs/read/${book._id}`).set(auth(reader)),
            await request(app).get('/api/kenlibs/library').set(auth(reader)),
            await request(app).get('/api/purchases/mine').set(auth(reader)),
            await request(app).get(`/api/kenlibs/access/${book._id}`).set(auth(reader)),
            await request(app).get('/api/bundles').set(auth(reader)),
        ];
        for (const res of responses) {
            expect(res.status).toBeLessThan(500);
            const body = typeof res.text === 'string' ? res.text : JSON.stringify(res.body);
            expect(body).not.toMatch(/SECRET-|secret-contact|royaltyPercent|holderName|licenceNotes|takedownNote|importedFrom|"rights"/);
        }
        // The attribution itself is public.
        expect(responses[1].body.author).toBe('Ade Bello');
    });
});
