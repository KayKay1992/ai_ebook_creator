const mongoose = require('mongoose');
const Book = require('../models/Book');
const Bundle = require('../models/Bundle');
const PurchaseRequest = require('../models/PurchaseRequest');
const RoyaltyPayment = require('../models/RoyaltyPayment');
const { parseRange, parseTestFilter, excludedTestAccounts, WITH_APPROVED_AT, CASH, REVENUE_STATUS } = require('./analyticsController');

// Royalties report (admin): per book and per author, units sold, cash
// revenue, royalty percent, royalty owed, and what's been paid.
//   - Same revenue definition as analytics: approved purchases, CASH =
//     amount − creditApplied, counted on the approval date, in Lagos days,
//     with the same hide-test-data filter.
//   - Books included: every book that isn't "own work", plus any book with
//     a royalty percent above 0.
//   - A bundle sale is shared between its books in proportion to their
//     list prices (equally if none has a price); each included book counts
//     one unit.
//   - Royalty owed uses the book's CURRENT royalty percent.
//   - Authors are grouped by the displayed author name (Book.author).
// No payouts: payments are records the admin adds ("mark as paid").

const round2 = (n) => Math.round(n * 100) / 100;
const authorKeyOf = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ') || '(no author)';

//@route   GET /api/admin/royalties?from&to|range=all&hideTest&minPrice
//@access  Private/Admin
const getRoyalties = async (req, res) => {
    try {
        const range = await parseRange(req.query, res);
        if (!range) return;
        const testFilter = parseTestFilter(req.query);
        const { start, end } = range;

        const books = await Book.find({ $or: [{ 'rights.type': { $in: ['licensed', 'public_domain'] } }, { 'rights.royaltyPercent': { $gt: 0 } }] })
            .select('title author status rights.type rights.royaltyPercent rights.holderName')
            .lean();
        const bookById = new Map(books.map((b) => [String(b._id), b]));
        const bookIds = books.map((b) => b._id);

        const bundles = bookIds.length ? await Bundle.find({ books: { $in: bookIds } }).select('title books').lean() : [];
        const allBundleBookIds = [...new Set(bundles.flatMap((b) => b.books.map(String)))];
        const prices = new Map(
            (await Book.find({ _id: { $in: allBundleBookIds } }).select('price').lean()).map((b) => [String(b._id), typeof b.price === 'number' && b.price > 0 ? b.price : 0])
        );
        // Each bundle's share per book (weights sum to 1).
        const bundleShares = new Map(
            bundles.map((bundle) => {
                const ids = bundle.books.map(String);
                const total = ids.reduce((s, id) => s + (prices.get(id) || 0), 0);
                return [String(bundle._id), new Map(ids.map((id) => [id, total > 0 ? (prices.get(id) || 0) / total : 1 / ids.length]))];
            })
        );

        const excluded = await excludedTestAccounts(testFilter);
        const purchaseFilter = testFilter.hidden ? { reader: { $nin: excluded }, amount: { $gte: testFilter.minPrice } } : {};
        const sales = bookIds.length
            ? await PurchaseRequest.aggregate([
                  {
                      $match: {
                          status: REVENUE_STATUS,
                          ...purchaseFilter,
                          $or: [{ itemType: 'book', item: { $in: bookIds } }, { itemType: 'bundle', item: { $in: bundles.map((b) => b._id) } }],
                      },
                  },
                  ...WITH_APPROVED_AT,
                  { $match: { approvedAt: { $lt: end } } },
                  { $project: { itemType: 1, item: 1, approvedAt: 1, cash: CASH } },
              ])
            : [];

        // Per book: in range and all time (all time feeds the balance).
        const rows = new Map(
            books.map((b) => [
                String(b._id),
                { units: 0, directUnits: 0, bundleUnits: 0, cash: 0, allTimeCash: 0 },
            ])
        );
        const credit = (bookId, cash, inRange, viaBundle) => {
            const row = rows.get(bookId);
            if (!row) return;
            row.allTimeCash += cash;
            if (!inRange) return;
            row.units += 1;
            row[viaBundle ? 'bundleUnits' : 'directUnits'] += 1;
            row.cash += cash;
        };
        for (const sale of sales) {
            const inRange = sale.approvedAt >= start && sale.approvedAt < end;
            if (sale.itemType === 'book') credit(String(sale.item), sale.cash, inRange, false);
            else {
                const shares = bundleShares.get(String(sale.item)) || new Map();
                for (const [bookId, share] of shares) credit(bookId, sale.cash * share, inRange, true);
            }
        }

        const bookRows = books
            .map((b) => {
                const row = rows.get(String(b._id));
                const pct = b.rights?.royaltyPercent || 0;
                return {
                    bookId: String(b._id),
                    title: b.title,
                    author: b.author || '',
                    authorKey: authorKeyOf(b.author),
                    status: b.status,
                    rightsType: b.rights?.type || 'own',
                    units: row.units,
                    directUnits: row.directUnits,
                    bundleUnits: row.bundleUnits,
                    cash: round2(row.cash),
                    royaltyPercent: pct,
                    royaltyOwed: round2((row.cash * pct) / 100),
                    allTimeOwed: round2((row.allTimeCash * pct) / 100),
                };
            })
            .sort((a, b) => b.royaltyOwed - a.royaltyOwed || a.title.localeCompare(b.title));

        const payments = await RoyaltyPayment.find({}).sort({ paidAt: -1, createdAt: -1 }).lean();
        const authors = new Map();
        for (const row of bookRows) {
            const a = authors.get(row.authorKey) || { authorKey: row.authorKey, author: row.author || '(no author)', books: 0, units: 0, cash: 0, royaltyOwed: 0, allTimeOwed: 0, paidInRange: 0, paidAllTime: 0 };
            a.books += 1;
            a.units += row.units;
            a.cash += row.cash;
            a.royaltyOwed += row.royaltyOwed;
            a.allTimeOwed += row.allTimeOwed;
            authors.set(row.authorKey, a);
        }
        for (const p of payments) {
            const a = authors.get(p.authorKey);
            if (!a) continue;
            a.paidAllTime += p.amount;
            if (p.paidAt >= start && p.paidAt < end) a.paidInRange += p.amount;
        }
        const authorRows = [...authors.values()]
            .map((a) => ({
                ...a,
                cash: round2(a.cash),
                royaltyOwed: round2(a.royaltyOwed),
                allTimeOwed: round2(a.allTimeOwed),
                paidInRange: round2(a.paidInRange),
                paidAllTime: round2(a.paidAllTime),
                balance: round2(a.allTimeOwed - a.paidAllTime),
            }))
            .sort((x, y) => y.balance - x.balance || x.author.localeCompare(y.author));

        res.set('Cache-Control', 'no-store');
        res.status(200).json({
            range: { from: range.from, to: range.to, days: range.days },
            testData: { hidden: testFilter.hidden, minPrice: testFilter.minPrice },
            books: bookRows,
            authors: authorRows,
            payments: payments.map((p) => ({ id: String(p._id), authorKey: p.authorKey, authorName: p.authorName, amount: p.amount, paidAt: p.paidAt, note: p.note })),
            totals: {
                units: bookRows.reduce((s, r) => s + r.units, 0),
                cash: round2(bookRows.reduce((s, r) => s + r.cash, 0)),
                royaltyOwed: round2(bookRows.reduce((s, r) => s + r.royaltyOwed, 0)),
            },
        });
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

//@route   POST /api/admin/royalties/payments  { authorName, amount, paidAt, note }
//@access  Private/Admin
const createRoyaltyPayment = async (req, res) => {
    try {
        const authorName = typeof req.body?.authorName === 'string' ? req.body.authorName.trim().slice(0, 200) : '';
        const amount = Number(req.body?.amount);
        const paidAt = new Date(req.body?.paidAt || Date.now());
        const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
        if (!authorName) return res.status(400).json({ message: 'Choose the author you paid.' });
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1e9) return res.status(400).json({ message: 'Enter the amount paid.' });
        if (Number.isNaN(paidAt.getTime())) return res.status(400).json({ message: 'The payment date is not valid.' });
        const payment = await RoyaltyPayment.create({ authorKey: authorKeyOf(authorName), authorName, amount: round2(amount), paidAt, note, createdBy: req.user._id });
        res.status(201).json({ id: String(payment._id), authorKey: payment.authorKey, authorName, amount: payment.amount, paidAt: payment.paidAt, note });
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

//@route   DELETE /api/admin/royalties/payments/:id  (a mistaken entry)
//@access  Private/Admin
const deleteRoyaltyPayment = async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ message: 'Payment not found' });
        const removed = await RoyaltyPayment.findByIdAndDelete(req.params.id);
        if (!removed) return res.status(404).json({ message: 'Payment not found' });
        res.status(200).json({ message: 'Payment removed.' });
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { getRoyalties, createRoyaltyPayment, deleteRoyaltyPayment, authorKeyOf };
