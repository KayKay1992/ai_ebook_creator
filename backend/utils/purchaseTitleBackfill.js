const mongoose = require('mongoose');
const PurchaseRequest = require('../models/PurchaseRequest');
const Book = require('../models/Book');
const Bundle = require('../models/Bundle');

// Fills PurchaseRequest.itemTitle for requests made before titles were
// snapshotted (scripts/backfill-purchase-titles.js). Rules:
//   - only requests whose itemTitle is missing or empty are ever touched,
//     and only that one field is set (the update's filter re-checks it is
//     still empty, so nothing already filled can be overwritten);
//   - the title comes from the item if it still exists (its CURRENT title:
//     the best available, since the name at purchase time was never stored);
//   - items that no longer exist stay empty (shown as "Deleted book (title
//     unknown)") unless a title is supplied for that request id by hand.

const isEmptyTitle = { $or: [{ itemTitle: { $exists: false } }, { itemTitle: null }, { itemTitle: '' }] };

// Returns { changes: [{ id, itemType, item, title, source }], unknown: [{ id, itemType, item }], ignored: [string] }
// where source is 'current item' or 'given by hand'.
const planTitleBackfill = async ({ manualTitles = {} } = {}) => {
    const requests = await PurchaseRequest.find(isEmptyTitle).select('itemType item').sort({ createdAt: 1 }).lean();
    const ids = (type) => requests.filter((r) => r.itemType === type).map((r) => r.item);
    const [books, bundles] = await Promise.all([
        Book.find({ _id: { $in: ids('book') } }).select('title').lean(),
        Bundle.find({ _id: { $in: ids('bundle') } }).select('title').lean(),
    ]);
    const titles = new Map([...books, ...bundles].map((doc) => [String(doc._id), doc.title]));

    const changes = [];
    const unknown = [];
    const pendingIds = new Set(requests.map((r) => String(r._id)));
    for (const request of requests) {
        const id = String(request._id);
        const manual = typeof manualTitles[id] === 'string' ? manualTitles[id].trim() : '';
        const current = titles.get(String(request.item));
        if (manual) changes.push({ id, itemType: request.itemType, item: String(request.item), title: manual.slice(0, 300), source: 'given by hand' });
        else if (current) changes.push({ id, itemType: request.itemType, item: String(request.item), title: current, source: 'current item' });
        else unknown.push({ id, itemType: request.itemType, item: String(request.item) });
    }
    // Manual titles for ids that aren't empty-title requests are never used.
    const ignored = Object.keys(manualTitles).filter((id) => !pendingIds.has(id));
    return { changes, unknown, ignored };
};

// Applies planned changes. Each update only matches while the title is
// still empty. Returns the number actually written.
const applyTitleBackfill = async (changes) => {
    let written = 0;
    for (const change of changes) {
        if (!mongoose.isValidObjectId(change.id)) continue;
        const result = await PurchaseRequest.updateOne(
            { _id: change.id, ...isEmptyTitle },
            { $set: { itemTitle: change.title } },
            // Not even updatedAt: this fills a missing snapshot, it isn't an edit.
            { timestamps: false }
        );
        written += result.modifiedCount;
    }
    return written;
};

module.exports = { planTitleBackfill, applyTitleBackfill };
