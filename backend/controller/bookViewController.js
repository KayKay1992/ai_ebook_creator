const mongoose = require('mongoose');
const Book = require('../models/Book');
const BookViewDaily = require('../models/BookViewDaily');
const { lagosDay } = require('../utils/lagosTime');

// Anonymous view counting for the public book page (analytics funnel).
// Nothing about the visitor is stored: one number per book per day. The
// frontend sends at most one view per browser per book per day
// (localStorage); this endpoint is rate-limited per IP (routes) without
// storing the IP, skips obvious bots, and only counts published books.

const isEnabled = () => String(process.env.BOOK_VIEW_TRACKING_ENABLED ?? '').toLowerCase() !== 'false';

// Crawlers, link previewers and headless tools, which shouldn't count as
// readers looking at a book.
const BOT_USER_AGENT =
    /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|skype|embedly|quora link|pinterest|vkshare|headless|phantom|puppeteer|playwright|selenium|lighthouse|pagespeed|curl|wget|python-requests|axios\/|node-fetch|go-http-client|java\/|okhttp|libwww|httpclient/i;

const isBot = (req) => {
    const userAgent = String(req.headers['user-agent'] || '');
    if (!userAgent || userAgent.length < 10) return true;
    if (BOT_USER_AGENT.test(userAgent)) return true;
    // Prefetch/prerender requests aren't a person viewing the page.
    const purpose = String(req.headers.purpose || req.headers['sec-purpose'] || '');
    return /prefetch|prerender/i.test(purpose);
};

//@desc    Count one view of a published book's public page (today, Lagos).
//         Always answers 204 (counted, skipped as a bot, tracking off, or
//         not a published book): there's nothing for the page to act on.
//@route   POST /api/public/kenlibs/books/:id/view
//@access  Public, rate-limited per IP.
const recordBookView = async (req, res) => {
    try {
        if (!isEnabled() || isBot(req) || !mongoose.isValidObjectId(req.params.id)) return res.status(204).end();
        const published = await Book.exists({ _id: req.params.id, status: 'published' });
        if (!published) return res.status(204).end();
        await BookViewDaily.updateOne({ book: published._id, day: lagosDay() }, { $inc: { views: 1 } }, { upsert: true });
        res.status(204).end();
    } catch (error) {
        if (error?.code === 11000) return res.status(204).end(); // concurrent first view of the day
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { recordBookView, isBot, isEnabled };
