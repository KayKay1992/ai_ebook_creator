const PurchaseRequest = require('../models/PurchaseRequest');
const Bundle = require('../models/Bundle');

// Deleting a book (controller/bookController.js deleteBook) is confirmed on
// the server, not only in the admin UI (frontend utils/bookDelete.js +
// components/dashboard/DeleteBookDialog.jsx):
//   - every book: `confirmTitle` must be the book's title (trimmed,
//     case-insensitive);
//   - a published book: also `confirmPublished: true` and
//     `acknowledgeBuyers: true`;
//   - any book readers have bought (directly or in a bundle), even one
//     already unpublished: also `acknowledgeBuyers: true`, because they lose
//     it from their Library.
// Anything missing → 400 with a `code`. There is no flag that skips these.

const normalTitle = (title) => String(title ?? '').trim().toLowerCase();
const titlesMatch = (typed, title) => typeof typed === 'string' && normalTitle(typed) !== '' && normalTitle(typed) === normalTitle(title);

// What deleting this book would affect.
const deletionImpact = async (book) => {
    const bundles = await Bundle.find({ books: book._id }).select('title isForSale').lean();
    const bundleIds = bundles.map((b) => b._id);
    const access = { $or: [{ itemType: 'book', item: book._id }, ...(bundleIds.length ? [{ itemType: 'bundle', item: { $in: bundleIds } }] : [])] };
    const [approvedReaders, directReaders, pendingCount] = await Promise.all([
        PurchaseRequest.distinct('reader', { ...access, status: 'approved' }),
        PurchaseRequest.distinct('reader', { itemType: 'book', item: book._id, status: 'approved' }),
        PurchaseRequest.countDocuments({ ...access, status: 'pending' }),
    ]);
    return {
        bookId: book._id,
        title: book.title || '',
        author: book.author || '',
        status: book.status || 'draft',
        chapterCount: (book.chapters || []).length,
        buyers: { total: approvedReaders.length, direct: directReaders.length, viaBundles: approvedReaders.length - directReaders.length },
        pendingCount,
        bundles: bundles.map((b) => ({ _id: b._id, title: b.title || '', isForSale: Boolean(b.isForSale) })),
    };
};

const needsBuyerAcknowledgement = (impact) => impact.status === 'published' || impact.buyers.total > 0;

// → null when the request may go ahead, else { code, message }.
const confirmationProblem = (impact, body = {}) => {
    if (typeof body.confirmTitle !== 'string' || !body.confirmTitle.trim()) {
        return { code: 'confirm_title_required', message: "Type the book's title to confirm the deletion." };
    }
    if (!titlesMatch(body.confirmTitle, impact.title)) {
        return { code: 'confirm_title_mismatch', message: "The title you typed doesn't match this book's title." };
    }
    if (impact.status === 'published' && body.confirmPublished !== true) {
        return { code: 'confirm_published_required', message: 'This book is published. Confirm that you want to delete a published book (or unpublish it instead).' };
    }
    if (needsBuyerAcknowledgement(impact) && body.acknowledgeBuyers !== true) {
        return {
            code: 'acknowledge_buyers_required',
            message: `${impact.buyers.total} reader${impact.buyers.total === 1 ? ' has' : 's have'} bought this book and will lose it from their Library. Confirm that you understand, or unpublish it instead.`,
        };
    }
    return null;
};

module.exports = { titlesMatch, deletionImpact, confirmationProblem, needsBuyerAcknowledgement };
