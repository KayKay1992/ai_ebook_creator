const PurchaseRequest = require('../models/PurchaseRequest');
const Book = require('../models/Book');
const Bundle = require('../models/Bundle');
const User = require('../models/User');
const ReferralReward = require('../models/ReferralReward');

// Deliberate choice (confirmed with the admin): revenue, the revenue trend,
// and top-books/top-bundles all count `status: 'approved'` ONLY — a revoked
// purchase does not count as revenue for any of these, even though it was
// once genuinely paid for. This is narrower than "was ever approved".
const REVENUE_STATUS = 'approved';

// Reader conversion ("did this person ever buy something", as opposed to
// revenue accounting) deliberately keeps the broader ever-approved
// definition — confirmed intentional asymmetry with REVENUE_STATUS above:
// revenue reflects current earned money (revoke excluded), while
// conversion reflects whether a reader ever became a genuine buyer, a
// historical fact that revoking their access later doesn't undo.
const EVER_APPROVED_STATUSES = ['approved', 'revoked'];

const DAYS_OF_REVENUE_HISTORY = 30;

//@desc    Business metrics for the admin analytics dashboard — revenue
//         (total + a daily trend), top books, top bundles, the request
//         funnel, reader conversion, and referral program stats. Every
//         number here comes from a MongoDB aggregation pipeline, not from
//         pulling raw documents into Node and reducing them in JS.
//@route   GET /api/admin/analytics
//@access  Private/Admin
const getAnalytics = async (req, res) => {
    try {
        const since = new Date(Date.now() - DAYS_OF_REVENUE_HISTORY * 24 * 60 * 60 * 1000);

        const [
            revenueTotalResult,
            revenueOverTime,
            topBooksResult,
            topBundles,
            statusCounts,
            totalPublishedBooks,
            totalReaders,
            convertedReaderIds,
            creditGrantedResult,
            creditOutstandingResult,
            totalReferralConversions,
        ] = await Promise.all([
            // Total revenue — approved only, see REVENUE_STATUS above.
            PurchaseRequest.aggregate([
                { $match: { status: REVENUE_STATUS } },
                { $group: { _id: null, total: { $sum: '$amount' } } },
            ]),

            // Revenue over time, bucketed by the day the request was
            // actually approved — not `createdAt` (when requested). Real
            // production data surfaced a case this must handle: a few older
            // records have no 'approved' reviewHistory entry at all
            // (predating that tracking), so this falls back to the
            // top-level `reviewedAt` when history is missing. That fallback
            // is safe here specifically because the $match above already
            // restricts this pipeline to status: 'approved' — unlike a
            // revoked request, an approved one's top-level `reviewedAt` is
            // never overwritten by a later event, so it always reflects the
            // true approval time.
            PurchaseRequest.aggregate([
                { $match: { status: REVENUE_STATUS } },
                {
                    $addFields: {
                        historyApprovedAt: {
                            $first: {
                                $filter: {
                                    input: '$reviewHistory',
                                    as: 'h',
                                    cond: { $eq: ['$$h.status', 'approved'] },
                                },
                            },
                        },
                    },
                },
                {
                    $addFields: {
                        approvedAt: { $ifNull: ['$historyApprovedAt.reviewedAt', '$reviewedAt'] },
                    },
                },
                { $match: { approvedAt: { $gte: since } } },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$approvedAt' } },
                        revenue: { $sum: '$amount' },
                        count: { $sum: 1 },
                    },
                },
                { $sort: { _id: 1 } },
            ]),

            // Top books by purchase count and by revenue, in one pass via
            // $facet — direct book purchases only. Bundle purchases are
            // deliberately excluded here (not split across constituent
            // books) — see the separate topBundles query below, which
            // reports bundle revenue as its own line instead.
            PurchaseRequest.aggregate([
                { $match: { itemType: 'book', status: REVENUE_STATUS } },
                { $group: { _id: '$item', purchaseCount: { $sum: 1 }, revenue: { $sum: '$amount' } } },
                {
                    $lookup: {
                        from: Book.collection.name,
                        localField: '_id',
                        foreignField: '_id',
                        as: 'book',
                    },
                },
                // preserveNullAndEmptyArrays: a purchased book can later be
                // deleted (see bookController.js's deleteBook) — its
                // revenue should still show up in the ranking rather than
                // silently vanishing.
                { $unwind: { path: '$book', preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        _id: 0,
                        bookId: '$_id',
                        title: { $ifNull: ['$book.title', 'Deleted book'] },
                        purchaseCount: 1,
                        revenue: 1,
                    },
                },
                {
                    $facet: {
                        byPurchaseCount: [{ $sort: { purchaseCount: -1 } }, { $limit: 10 }],
                        byRevenue: [{ $sort: { revenue: -1 } }, { $limit: 10 }],
                    },
                },
            ]),

            // Bundle purchases, reported as their own entries rather than
            // attributed down to individual books.
            PurchaseRequest.aggregate([
                { $match: { itemType: 'bundle', status: REVENUE_STATUS } },
                { $group: { _id: '$item', purchaseCount: { $sum: 1 }, revenue: { $sum: '$amount' } } },
                {
                    $lookup: {
                        from: Bundle.collection.name,
                        localField: '_id',
                        foreignField: '_id',
                        as: 'bundle',
                    },
                },
                { $unwind: { path: '$bundle', preserveNullAndEmptyArrays: true } },
                {
                    $project: {
                        _id: 0,
                        bundleId: '$_id',
                        title: { $ifNull: ['$bundle.title', 'Deleted bundle'] },
                        purchaseCount: 1,
                        revenue: 1,
                    },
                },
                { $sort: { revenue: -1 } },
                { $limit: 10 },
            ]),

            // Funnel — every status bucket in one query.
            PurchaseRequest.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
            Book.countDocuments({ status: 'published' }),
            User.countDocuments({ role: 'reader' }),
            // Readers with at least one ever-approved purchase — see
            // EVER_APPROVED_STATUSES above for why this one stays broader.
            PurchaseRequest.distinct('reader', { status: { $in: EVER_APPROVED_STATUSES } }),
            ReferralReward.aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]),
            User.aggregate([{ $group: { _id: null, total: { $sum: '$creditBalance' } } }]),
            ReferralReward.countDocuments({}),
        ]);

        const statusMap = { pending: 0, approved: 0, rejected: 0, revoked: 0 };
        statusCounts.forEach((s) => {
            if (s._id in statusMap) {
                statusMap[s._id] = s.count;
            }
        });
        const totalPurchaseRequests = Object.values(statusMap).reduce((a, b) => a + b, 0);
        const convertedReaders = convertedReaderIds.length;

        res.status(200).json({
            revenue: {
                total: revenueTotalResult[0]?.total || 0,
                overTime: revenueOverTime.map((d) => ({ date: d._id, revenue: d.revenue, count: d.count })),
            },
            topBooks: {
                byPurchaseCount: topBooksResult[0]?.byPurchaseCount || [],
                byRevenue: topBooksResult[0]?.byRevenue || [],
            },
            topBundles,
            funnel: {
                totalPublishedBooks,
                totalPurchaseRequests,
                pending: statusMap.pending,
                approved: statusMap.approved,
                rejected: statusMap.rejected,
                revoked: statusMap.revoked,
            },
            readers: {
                total: totalReaders,
                converted: convertedReaders,
                conversionRatePercent:
                    totalReaders > 0 ? Math.round((convertedReaders / totalReaders) * 1000) / 10 : 0,
            },
            referrals: {
                totalCreditGranted: creditGrantedResult[0]?.total || 0,
                totalCreditOutstanding: creditOutstandingResult[0]?.total || 0,
                totalConversions: totalReferralConversions,
            },
        });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { getAnalytics };
