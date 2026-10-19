const PurchaseRequest = require('../models/PurchaseRequest');
const Book = require('../models/Book');
const Bundle = require('../models/Bundle');
const User = require('../models/User');
const ReferralReward = require('../models/ReferralReward');
const BookViewDaily = require('../models/BookViewDaily');
const BookTranslation = require('../models/BookTranslation');
const ErrorLog = require('../models/ErrorLog');
const { TIMEZONE, DAY_PATTERN, lagosDay, startOfLagosDay, addDays, daysBetween } = require('../utils/lagosTime');
const { unknownItemTitle } = require('./purchaseController');
const { isEnabled: isViewTrackingEnabled } = require('./bookViewController');

// Admin analytics (GET /api/admin/analytics). Definitions, all deliberate:
//   - Revenue counts `status: 'approved'` only (a revoked purchase isn't
//     earned money), dated by when it was APPROVED (Lagos calendar days).
//     The headline is CASH RECEIVED: amount − creditApplied (store credit
//     isn't cash). Gross sales (the full price) and credit applied are
//     reported alongside.
//   - Reader conversion keeps the broader "ever approved" definition
//     (approved or later revoked): it measures whether someone ever became
//     a buyer, which a later revoke doesn't undo.
//   - Readers are every account that isn't an admin, INCLUDING older
//     accounts with no `role` field at all (they predate the field and are
//     readers in practice).
//   - "Hide test data" (hideTest=1) leaves out purchases by admin accounts
//     and accounts flagged isTestAccount, purchases cheaper than minPrice,
//     and test accounts themselves from reader counts.
//   - Every metric is for the chosen range [from, to] (Lagos days) and the
//     previous range of the same length, for trend chips.

const REVENUE_STATUS = 'approved';
const EVER_APPROVED_STATUSES = ['approved', 'revoked'];
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 3660;
const DEFAULT_TEST_MIN_PRICE = 100;
const RECENT_SALES = 8;

const { licenceStatus, LICENCE_EXPIRY_WARNING_DAYS } = require('../utils/bookRights');

const NOT_ADMIN = { role: { $ne: 'admin' } }; // matches a missing role too

// Real approval time: the first "approved" event in reviewHistory, else the
// top-level reviewedAt (legacy records without history). Safe for
// approved/revoked records only (a revoke rewrites reviewedAt, but never
// the history's approval entry).
const WITH_APPROVED_AT = [
    {
        $addFields: {
            historyApprovedAt: {
                $first: {
                    $filter: { input: { $ifNull: ['$reviewHistory', []] }, as: 'h', cond: { $eq: ['$$h.status', 'approved'] } },
                },
            },
        },
    },
    { $addFields: { approvedAt: { $ifNull: ['$historyApprovedAt.reviewedAt', '$reviewedAt'] } } },
];
const CASH = { $max: [0, { $subtract: ['$amount', { $ifNull: ['$creditApplied', 0] }] }] };

const badRequest = (res, message) => res.status(400).json({ message });

// Range from the query: ?from=YYYY-MM-DD&to=YYYY-MM-DD, or ?range=all, else
// the last 30 days. Returns null after responding 400 if invalid.
const parseRange = async (query, res) => {
    const today = lagosDay();
    let { from, to } = query;
    if (query.range === 'all') {
        const [firstPurchase, firstUser] = await Promise.all([
            PurchaseRequest.findOne().sort({ createdAt: 1 }).select('createdAt').lean(),
            User.findOne({ createdAt: { $exists: true } }).sort({ createdAt: 1 }).select('createdAt').lean(),
        ]);
        const dates = [firstPurchase?.createdAt, firstUser?.createdAt].filter(Boolean);
        from = dates.length ? lagosDay(new Date(Math.min(...dates.map((d) => d.getTime())))) : today;
        to = today;
    }
    to = to || today;
    from = from || addDays(to, -(DEFAULT_RANGE_DAYS - 1));
    if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to)) {
        badRequest(res, 'from and to must be dates (YYYY-MM-DD).');
        return null;
    }
    try {
        startOfLagosDay(from);
        startOfLagosDay(to);
    } catch {
        badRequest(res, 'from and to must be real dates.');
        return null;
    }
    if (from > to) {
        badRequest(res, '"from" must not be after "to".');
        return null;
    }
    const days = daysBetween(from, to).length;
    if (days > MAX_RANGE_DAYS) {
        badRequest(res, 'That range is too long (10 years at most).');
        return null;
    }
    const previousTo = addDays(from, -1);
    const previousFrom = addDays(previousTo, -(days - 1));
    return {
        from,
        to,
        days,
        previousFrom,
        previousTo,
        start: startOfLagosDay(from),
        end: startOfLagosDay(addDays(to, 1)),
        previousStart: startOfLagosDay(previousFrom),
    };
};

const parseTestFilter = (query) => {
    const hidden = query.hideTest === '1' || query.hideTest === 'true';
    const parsed = Number(query.minPrice);
    const minPrice = Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 1e9) : DEFAULT_TEST_MIN_PRICE;
    return { hidden, minPrice };
};

const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

// The best name for a purchased item: live title, the snapshot taken at
// request time, or an honest "unknown".
const titleFor = (itemType, liveTitle, snapshot) => liveTitle || snapshot || unknownItemTitle(itemType);

//@desc    Analytics dashboard data for a date range (see definitions above).
//         Query: from, to (YYYY-MM-DD, Lagos) or range=all; hideTest=1;
//         minPrice (with hideTest, default 100).
//@route   GET /api/admin/analytics
//@access  Private/Admin
const getAnalytics = async (req, res) => {
    try {
        const range = await parseRange(req.query, res);
        if (!range) return;
        const testFilter = parseTestFilter(req.query);
        const { start, end, previousStart } = range;

        // Accounts whose purchases/presence the test filter removes.
        const excludedAccounts = testFilter.hidden
            ? (await User.find({ $or: [{ role: 'admin' }, { isTestAccount: true }] }).select('_id').lean()).map((u) => u._id)
            : [];
        const purchaseFilter = testFilter.hidden ? { reader: { $nin: excludedAccounts }, amount: { $gte: testFilter.minPrice } } : {};
        const readerFilter = testFilter.hidden ? { ...NOT_ADMIN, isTestAccount: { $ne: true } } : NOT_ADMIN;
        const admins = (await User.find({ role: 'admin' }).select('_id').lean()).map((u) => String(u._id));

        const [
            revenueByDay,
            recentSalesRaw,
            itemTotals,
            statusCounts,
            requestsCreated,
            approvedOfCreated,
            totalReadersNow,
            totalReadersBefore,
            newReaders,
            newReadersPrevious,
            convertedNow,
            convertedBefore,
            creditGranted,
            creditOutstanding,
            referralConversions,
            views,
            firstView,
        ] = await Promise.all([
            // Revenue per Lagos day across the previous + current range.
            PurchaseRequest.aggregate([
                { $match: { status: REVENUE_STATUS, ...purchaseFilter } },
                ...WITH_APPROVED_AT,
                { $match: { approvedAt: { $gte: previousStart, $lt: end } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$approvedAt', timezone: TIMEZONE } },
                        cash: { $sum: CASH },
                        gross: { $sum: '$amount' },
                        credit: { $sum: { $ifNull: ['$creditApplied', 0] } },
                        orders: { $sum: 1 },
                    },
                },
            ]),
            // Latest sales in the range (so the revenue card is never empty).
            PurchaseRequest.aggregate([
                { $match: { status: REVENUE_STATUS, ...purchaseFilter } },
                ...WITH_APPROVED_AT,
                { $match: { approvedAt: { $gte: start, $lt: end } } },
                { $sort: { approvedAt: -1 } },
                { $limit: RECENT_SALES },
                { $project: { itemType: 1, item: 1, itemTitle: 1, amount: 1, creditApplied: 1, approvedAt: 1 } },
            ]),
            // Totals per book and per bundle in the range.
            PurchaseRequest.aggregate([
                { $match: { status: REVENUE_STATUS, ...purchaseFilter } },
                ...WITH_APPROVED_AT,
                { $match: { approvedAt: { $gte: start, $lt: end } } },
                {
                    $group: {
                        _id: { itemType: '$itemType', item: '$item' },
                        orders: { $sum: 1 },
                        cash: { $sum: CASH },
                        gross: { $sum: '$amount' },
                        // Any non-empty snapshot ('' sorts first).
                        snapshot: { $max: { $ifNull: ['$itemTitle', ''] } },
                    },
                },
            ]),
            // Purchase requests made in the range, by current status.
            PurchaseRequest.aggregate([
                { $match: { createdAt: { $gte: start, $lt: end }, ...purchaseFilter } },
                { $group: { _id: '$status', count: { $sum: 1 } } },
            ]),
            PurchaseRequest.countDocuments({ createdAt: { $gte: start, $lt: end }, ...purchaseFilter }),
            PurchaseRequest.countDocuments({ createdAt: { $gte: start, $lt: end }, status: { $in: EVER_APPROVED_STATUSES }, ...purchaseFilter }),
            // Readers (non-admins, incl. accounts with no role) as of the
            // end of each range, and new ones in each range.
            User.countDocuments({ ...readerFilter, $or: [{ createdAt: { $lt: end } }, { createdAt: { $exists: false } }] }),
            User.countDocuments({ ...readerFilter, $or: [{ createdAt: { $lt: start } }, { createdAt: { $exists: false } }] }),
            User.countDocuments({ ...readerFilter, createdAt: { $gte: start, $lt: end } }),
            User.countDocuments({ ...readerFilter, createdAt: { $gte: previousStart, $lt: start } }),
            // Buyers (ever approved) as of the end of each range.
            PurchaseRequest.aggregate([
                { $match: { status: { $in: EVER_APPROVED_STATUSES }, ...purchaseFilter } },
                ...WITH_APPROVED_AT,
                { $match: { approvedAt: { $lt: end } } },
                { $group: { _id: '$reader' } },
            ]),
            PurchaseRequest.aggregate([
                { $match: { status: { $in: EVER_APPROVED_STATUSES }, ...purchaseFilter } },
                ...WITH_APPROVED_AT,
                { $match: { approvedAt: { $lt: start } } },
                { $group: { _id: '$reader' } },
            ]),
            // Referral credit granted per range; outstanding is "now".
            ReferralReward.aggregate([
                { $match: { createdAt: { $gte: previousStart, $lt: end } } },
                { $group: { _id: { $gte: ['$createdAt', start] }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
            ]),
            User.aggregate([{ $match: readerFilter }, { $group: { _id: null, total: { $sum: { $ifNull: ['$creditBalance', 0] } } } }]),
            ReferralReward.countDocuments({ createdAt: { $gte: start, $lt: end } }),
            // Book page views (only since tracking shipped).
            BookViewDaily.aggregate([{ $match: { day: { $gte: range.from, $lte: range.to } } }, { $group: { _id: null, views: { $sum: '$views' } } }]),
            BookViewDaily.findOne().sort({ day: 1 }).select('day').lean(),
        ]);

        // Revenue series, zero-filled for every day in the range, plus
        // current/previous totals.
        const byDay = new Map(revenueByDay.map((d) => [d._id, d]));
        const sumDays = (days) =>
            days.reduce(
                (t, day) => {
                    const d = byDay.get(day);
                    if (d) {
                        t.cash += d.cash;
                        t.gross += d.gross;
                        t.credit += d.credit;
                        t.orders += d.orders;
                    }
                    return t;
                },
                { cash: 0, gross: 0, credit: 0, orders: 0 }
            );
        const currentDays = daysBetween(range.from, range.to);
        const current = sumDays(currentDays);
        const previous = sumDays(daysBetween(range.previousFrom, range.previousTo));
        const revenueSeries = currentDays.map((day) => {
            const d = byDay.get(day);
            return { date: day, cash: d?.cash || 0, gross: d?.gross || 0, orders: d?.orders || 0 };
        });

        // Titles for everything named on the page, in two lookups.
        const idsOf = (type) => [...new Set([...itemTotals.filter((t) => t._id.itemType === type).map((t) => String(t._id.item)), ...recentSalesRaw.filter((s) => s.itemType === type).map((s) => String(s.item))])];
        const [books, bundles] = await Promise.all([
            Book.find({ _id: { $in: idsOf('book') } }).select('title').lean(),
            Bundle.find({ _id: { $in: idsOf('bundle') } }).select('title').lean(),
        ]);
        const liveTitles = new Map([...books, ...bundles].map((doc) => [String(doc._id), doc.title]));

        const ranked = (type) =>
            itemTotals
                .filter((t) => t._id.itemType === type)
                .map((t) => {
                    const live = liveTitles.get(String(t._id.item));
                    return {
                        id: String(t._id.item),
                        title: titleFor(type, live, t.snapshot),
                        deleted: !live,
                        orders: t.orders,
                        cash: t.cash,
                        gross: t.gross,
                        sharePercent: percent(t.cash, current.cash),
                    };
                })
                .sort((a, b) => b.cash - a.cash || b.orders - a.orders)
                .slice(0, 50);

        const recentSales = recentSalesRaw.map((s) => {
            const live = liveTitles.get(String(s.item));
            return {
                id: String(s._id),
                itemType: s.itemType,
                title: titleFor(s.itemType, live, s.itemTitle),
                deleted: !live,
                amount: s.amount,
                cash: Math.max(0, s.amount - (s.creditApplied || 0)),
                approvedAt: s.approvedAt,
            };
        });

        const statusBreakdown = { pending: 0, approved: 0, rejected: 0, revoked: 0 };
        statusCounts.forEach((s) => {
            if (s._id in statusBreakdown) statusBreakdown[s._id] = s.count;
        });
        statusBreakdown.total = Object.values(statusBreakdown).reduce((a, b) => a + b, 0);

        // Conversion: buyers among readers, as of each range's end. Buyers
        // are counted only if they're readers (not admins, not test
        // accounts when hidden).
        const excluded = new Set([...admins, ...excludedAccounts.map(String)]);
        const countBuyers = (rows) => rows.filter((r) => r._id && !excluded.has(String(r._id))).length;
        const converted = countBuyers(convertedNow);
        const convertedPrevious = countBuyers(convertedBefore);

        const granted = { current: { total: 0, count: 0 }, previous: { total: 0, count: 0 } };
        creditGranted.forEach((g) => {
            granted[g._id ? 'current' : 'previous'] = { total: g.total, count: g.count };
        });

        res.set('Cache-Control', 'no-store');
        res.status(200).json({
            range: { from: range.from, to: range.to, days: range.days, previousFrom: range.previousFrom, previousTo: range.previousTo, timezone: TIMEZONE },
            testData: { hidden: testFilter.hidden, minPrice: testFilter.minPrice, excludedAccounts: excludedAccounts.length },
            kpis: {
                cashRevenue: { value: current.cash, previous: previous.cash },
                grossSales: { value: current.gross, previous: previous.gross },
                creditApplied: { value: current.credit, previous: previous.credit },
                orders: { value: current.orders, previous: previous.orders },
                readers: { total: totalReadersNow, previousTotal: totalReadersBefore, newInRange: newReaders, newPrevious: newReadersPrevious },
                conversion: {
                    ratePercent: percent(converted, totalReadersNow),
                    converted,
                    sample: totalReadersNow,
                    previousRatePercent: percent(convertedPrevious, totalReadersBefore),
                    previousSample: totalReadersBefore,
                },
                referralCredit: {
                    grantedInRange: granted.current.total,
                    grantedPrevious: granted.previous.total,
                    outstandingNow: creditOutstanding[0]?.total || 0,
                    conversionsInRange: referralConversions,
                },
            },
            revenueSeries,
            recentSales,
            topBooks: ranked('book'),
            topBundles: ranked('bundle'),
            statusBreakdown,
            funnel: {
                trackingEnabled: isViewTrackingEnabled(),
                trackingStartedOn: firstView?.day || null,
                views: views[0]?.views || 0,
                signups: newReaders,
                requests: requestsCreated,
                approved: approvedOfCreated,
            },
        });
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    The "needs attention" row: work waiting on the admin, not tied to
//         a date range or the test-data filter.
//@route   GET /api/admin/attention
//@access  Private/Admin
// Books by other authors whose licence has expired or expires within
// LICENCE_EXPIRY_WARNING_DAYS. Shown only; nothing is unpublished
// automatically.
const licenceAttention = async () => {
    const soon = new Date(Date.now() + LICENCE_EXPIRY_WARNING_DAYS * 86400000);
    const books = await Book.find({ 'rights.type': { $in: ['licensed', 'public_domain'] }, 'rights.licenceExpiresAt': { $ne: null, $lte: soon } })
        .select('title status rights.licenceExpiresAt rights.type')
        .sort({ 'rights.licenceExpiresAt': 1 })
        .lean();
    const rows = books.map((b) => ({ bookId: String(b._id), title: b.title, published: b.status === 'published', expiresAt: b.rights.licenceExpiresAt, status: licenceStatus(b.rights) }));
    return { count: rows.length, expired: rows.filter((r) => r.status === 'expired').length, books: rows.slice(0, 5) };
};

const getAttention = async (req, res) => {
    try {
        const [pendingCount, oldestPending, unresolvedErrors, audioIssues, translationIssues] = await Promise.all([
            PurchaseRequest.countDocuments({ status: 'pending' }),
            PurchaseRequest.findOne({ status: 'pending' }).sort({ createdAt: 1 }).select('createdAt').lean(),
            ErrorLog.countDocuments({ resolved: false }),
            Book.aggregate([
                { $unwind: '$audio.chapters' },
                { $match: { 'audio.chapters.status': { $in: ['failed', 'waiting'] } } },
                { $group: { _id: '$_id', title: { $first: '$title' }, count: { $sum: 1 } } },
                { $sort: { count: -1 } },
            ]),
            BookTranslation.aggregate([
                { $unwind: '$chapters' },
                { $match: { 'chapters.jobStatus': { $in: ['failed', 'waiting'] } } },
                { $group: { _id: '$bookId', languages: { $addToSet: '$language' }, count: { $sum: 1 } } },
                { $lookup: { from: Book.collection.name, localField: '_id', foreignField: '_id', as: 'book' } },
                { $project: { count: 1, languages: 1, title: { $first: '$book.title' } } },
                { $sort: { count: -1 } },
            ]),
        ]);
        const summarize = (rows) => ({
            count: rows.reduce((sum, r) => sum + r.count, 0),
            books: rows.slice(0, 5).map((r) => ({ bookId: String(r._id), title: r.title || 'Deleted book', count: r.count, languages: r.languages })),
        });
        res.set('Cache-Control', 'no-store');
        res.status(200).json({
            pendingPurchases: { count: pendingCount, oldestCreatedAt: oldestPending?.createdAt || null },
            unresolvedErrors,
            failedAudio: summarize(audioIssues),
            failedTranslations: summarize(translationIssues),
            licences: await licenceAttention(),
        });
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

// Shared with the royalties report (royaltyController.js), so both use the
// same cash-revenue definition, date range and test-data filter.
const excludedTestAccounts = async (testFilter) =>
    testFilter.hidden ? (await User.find({ $or: [{ role: 'admin' }, { isTestAccount: true }] }).select('_id').lean()).map((u) => u._id) : [];

module.exports = { getAnalytics, getAttention, parseRange, parseTestFilter, excludedTestAccounts, WITH_APPROVED_AT, CASH, REVENUE_STATUS };
