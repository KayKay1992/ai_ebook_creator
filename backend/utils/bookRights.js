// Rights, attribution and royalties for books by other authors (Book.rights).
// Shared by PUT /api/books/:id/rights, the publish guard
// (bookController.togglePublishStatus), "Import a book" and the
// "needs attention" row (licence expiry).

const RIGHTS_TYPES = ['own', 'licensed', 'public_domain'];
const LICENCE_EXPIRY_WARNING_DAYS = 30;

const text = (value, max) => (typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max) : '');

// Validates admin input. Returns { rights } (only the editable fields) or
// { error }. Confirmation/takedown fields are never taken from input.
const parseRightsInput = (input = {}) => {
    const rights = {};
    if (input.type !== undefined) {
        if (!RIGHTS_TYPES.includes(input.type)) return { error: 'Rights type must be own work, licensed or public domain.' };
        rights.type = input.type;
    }
    for (const [key, max] of [['holderName', 200], ['holderContact', 300], ['licenceNotes', 4000], ['licenceReference', 200], ['territory', 500]]) {
        if (input[key] !== undefined) {
            if (input[key] !== null && typeof input[key] !== 'string') return { error: `${key} must be text.` };
            rights[key] = text(input[key] || '', max);
        }
    }
    if (input.licenceExpiresAt !== undefined) {
        if (input.licenceExpiresAt === null || input.licenceExpiresAt === '') rights.licenceExpiresAt = null;
        else {
            const date = new Date(input.licenceExpiresAt);
            if (Number.isNaN(date.getTime())) return { error: 'The licence expiry must be a date.' };
            rights.licenceExpiresAt = date;
        }
    }
    if (input.royaltyPercent !== undefined) {
        const pct = Number(input.royaltyPercent);
        if (input.royaltyPercent === null || input.royaltyPercent === '' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
            return { error: 'Royalty must be a percentage from 0 to 100.' };
        }
        rights.royaltyPercent = Math.round(pct * 100) / 100;
    }
    return { rights };
};

// Can this book be published with these rights? `confirmed` is the admin's
// explicit tick on the publish dialog. → { ok, missing: [messages] }
const publishGuard = (rights = {}, { confirmed = false } = {}) => {
    const type = rights.type || 'own';
    if (type === 'own') return { ok: true, missing: [] };
    const missing = [];
    if (type === 'licensed') {
        if (!text(rights.holderName, 200)) missing.push('Rights holder name');
        if (!text(rights.licenceNotes, 4000)) missing.push('Licence notes');
    } else if (type === 'public_domain') {
        if (!text(rights.licenceNotes, 4000)) missing.push('A note on why the book is public domain');
    }
    if (!confirmed) missing.push('Confirmation that you have the rights or written permission to sell this book');
    return { ok: missing.length === 0, missing };
};

// 'expired' | 'expiring' | null
const licenceStatus = (rights = {}, now = new Date()) => {
    if (!rights.licenceExpiresAt || (rights.type || 'own') === 'own') return null;
    const expires = new Date(rights.licenceExpiresAt).getTime();
    if (expires <= now.getTime()) return 'expired';
    if (expires - now.getTime() <= LICENCE_EXPIRY_WARNING_DAYS * 86400000) return 'expiring';
    return null;
};

module.exports = { RIGHTS_TYPES, parseRightsInput, publishGuard, licenceStatus, LICENCE_EXPIRY_WARNING_DAYS };
