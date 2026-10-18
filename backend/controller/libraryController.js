const mongoose = require('mongoose');
const PurchaseRequest = require('../models/PurchaseRequest');
const Book = require('../models/Book');
const Bundle = require('../models/Bundle');
const ReaderProgress = require('../models/ReaderProgress');
const ReaderAnnotation = require('../models/ReaderAnnotation');
const User = require('../models/User');
const { audioSummary, AUDIO_SUMMARY_FIELDS } = require('../utils/audioSummary');
const { publishedLanguages } = require('../utils/translationAccess');
const { unknownItemTitle } = require('./purchaseController');

// The reader's Library (/kenlibs/my-books) in one request: every purchase
// request (with its status), the books those cover, and for each book the
// reader owns: reading progress, audiobook availability, published
// translation languages and highlight/note/bookmark counts.
//
// Metadata only: never chapter text, never audio or evidence URLs. Books
// in pending/rejected/revoked requests come back with title/author/cover
// only (owned: false, no progress or extras), so the page can show what was
// requested without granting anything. Ownership is exactly hasBookAccess's
// rule for readers: an approved book request, or a book in an approved
// bundle request.

const BOOK_FIELDS = `title subtitle author coverImage coverDesign status ${AUDIO_SUMMARY_FIELDS}`;

const percentOf = (progress, chapterCount) => {
    if (!progress || chapterCount <= 0) return 0;
    if (progress.completedAt) return 100;
    const index = Math.min(Math.max(progress.lastChapterIndex || 0, 0), chapterCount - 1);
    const within = Math.min(Math.max(progress.chapterProgress || 0, 0), 1);
    // The small epsilon keeps float noise (1.4 / 5 * 100 = 27.999…) from
    // rounding a whole percentage down.
    return Math.min(99, Math.floor(((index + within) / chapterCount) * 100 + 1e-9));
};

//@desc    The signed-in reader's library
//@route   GET /api/kenlibs/library
//@access  Private (own data only)
const getLibrary = async (req, res) => {
    try {
        const readerId = req.user._id;
        const requests = await PurchaseRequest.find({ reader: readerId })
            .select('itemType item itemTitle status amount creditApplied adminNote createdAt reviewedAt reviewHistory.status reviewHistory.reviewedAt')
            .sort({ createdAt: -1 })
            .lean();

        const bundleIds = requests.filter((r) => r.itemType === 'bundle').map((r) => r.item);
        const bundles = bundleIds.length
            ? await Bundle.find({ _id: { $in: bundleIds } }).select('title coverImage books').lean()
            : [];
        const bundleById = new Map(bundles.map((b) => [String(b._id), b]));

        const allBookIds = new Set();
        const ownedBookIds = new Set();
        for (const r of requests) {
            const ids = r.itemType === 'book' ? [String(r.item)] : (bundleById.get(String(r.item))?.books || []).map(String);
            for (const id of ids) {
                allBookIds.add(id);
                if (r.status === 'approved') ownedBookIds.add(id);
            }
        }

        const owned = [...ownedBookIds];
        const [books, progresses, annotationCounts, user] = await Promise.all([
            allBookIds.size ? Book.find({ _id: { $in: [...allBookIds] } }).select(BOOK_FIELDS).lean() : [],
            owned.length
                ? ReaderProgress.find({ reader: readerId, book: { $in: owned } })
                      .select('book lastChapterIndex lastChapterId chapterProgress positionUpdatedAt completedAt updatedAt createdAt')
                      .lean()
                : [],
            owned.length
                ? ReaderAnnotation.aggregate([
                      { $match: { reader: readerId, book: { $in: owned.map((id) => new mongoose.Types.ObjectId(id)) } } },
                      {
                          $group: {
                              _id: '$book',
                              highlights: { $sum: { $cond: [{ $eq: ['$type', 'highlight'] }, 1, 0] } },
                              notes: {
                                  $sum: {
                                      $cond: [{ $and: [{ $eq: ['$type', 'highlight'] }, { $gt: [{ $strLenCP: { $ifNull: ['$note', ''] } }, 0] }] }, 1, 0],
                                  },
                              },
                              bookmarks: { $sum: { $cond: [{ $eq: ['$type', 'bookmark'] }, 1, 0] } },
                          },
                      },
                  ])
                : [],
            User.findById(readerId).select('creditBalance').lean(),
        ]);

        const progressByBook = new Map(progresses.map((p) => [String(p.book), p]));
        const annotationsByBook = new Map(annotationCounts.map((a) => [String(a._id), a]));
        const translationsByBook = new Map(
            await Promise.all(
                books
                    .filter((b) => ownedBookIds.has(String(b._id)))
                    .map(async (b) => [
                        String(b._id),
                        (await publishedLanguages(b._id, new Set((b.chapters || []).map((c) => String(c._id))))).map(
                            ({ code, name, nativeName }) => ({ code, name, nativeName })
                        ),
                    ])
            )
        );

        const bookMap = {};
        for (const b of books) {
            const id = String(b._id);
            const isOwned = ownedBookIds.has(id);
            const chapterCount = (b.chapters || []).length;
            const base = {
                _id: id,
                title: b.title || 'Untitled Book',
                subtitle: b.subtitle || '',
                author: b.author || '',
                coverImage: b.coverImage || '',
                coverDesign: b.coverDesign || null,
                chapterCount,
                owned: isOwned,
            };
            if (!isOwned) {
                bookMap[id] = base;
                continue;
            }
            const p = progressByBook.get(id);
            const a = annotationsByBook.get(id);
            bookMap[id] = {
                ...base,
                hasAudio: audioSummary(b).hasAudio,
                translations: translationsByBook.get(id) || [],
                annotations: { highlights: a?.highlights || 0, notes: a?.notes || 0, bookmarks: a?.bookmarks || 0 },
                progress: p
                    ? {
                          chapterIndex: Math.min(Math.max(p.lastChapterIndex || 0, 0), Math.max(chapterCount - 1, 0)),
                          chapterProgress: p.chapterProgress || 0,
                          percent: percentOf(p, chapterCount),
                          completedAt: p.completedAt || null,
                          lastReadAt: p.positionUpdatedAt || p.updatedAt || p.createdAt || null,
                      }
                    : null,
            };
        }

        const items = requests.map((r) => {
            const bundle = r.itemType === 'bundle' ? bundleById.get(String(r.item)) : null;
            const book = r.itemType === 'book' ? bookMap[String(r.item)] : null;
            const approvals = (r.reviewHistory || []).filter((h) => h.status === 'approved');
            return {
                requestId: String(r._id),
                itemType: r.itemType,
                itemId: String(r.item),
                status: r.status,
                title: book?.title || bundle?.title || r.itemTitle || unknownItemTitle(r.itemType),
                deleted: r.itemType === 'book' ? !book : !bundle,
                bundleCoverImage: bundle?.coverImage || '',
                bookIds: r.itemType === 'book' ? (book ? [book._id] : []) : (bundle?.books || []).map(String).filter((id) => bookMap[id]),
                requestedAt: r.createdAt,
                decidedAt: r.status === 'pending' ? null : r.reviewedAt || null,
                approvedAt: r.status === 'approved' ? approvals[approvals.length - 1]?.reviewedAt || r.reviewedAt || null : null,
                // A reason is only meaningful once something went wrong.
                adminNote: r.status === 'rejected' || r.status === 'revoked' ? r.adminNote || '' : '',
            };
        });

        const ownedBooks = owned.map((id) => bookMap[id]).filter(Boolean);
        res.set('Cache-Control', 'no-store');
        res.status(200).json({
            summary: {
                owned: ownedBooks.length,
                finished: ownedBooks.filter((b) => b.progress?.completedAt).length,
                reading: ownedBooks.filter((b) => b.progress && !b.progress.completedAt).length,
                pending: items.filter((i) => i.status === 'pending').length,
                creditBalance: user?.creditBalance || 0,
            },
            items,
            books: bookMap,
        });
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { getLibrary };
