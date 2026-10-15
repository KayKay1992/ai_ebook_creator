const mongoose = require('mongoose');
const Book = require('../models/Book');
const ReaderAnnotation = require('../models/ReaderAnnotation');
const { NOTE_MAX_LENGTH, LABEL_MAX_LENGTH, QUOTE_MAX_LENGTH, CONTEXT_MAX_LENGTH, HIGHLIGHT_COLORS } = ReaderAnnotation;
const { getLanguage } = require('../config/translationLanguages');
const { hasBookAccess } = require('./kenlibsController');

// Readers' private highlights, notes and bookmarks, under
// /api/kenlibs/annotations/:bookId (kenlibsRoute.js applies `protect`).
// Every request:
//   - checks hasBookAccess for the book (no access → 403, like readBook),
//   - filters every query on reader = the logged-in user, so one reader can
//     never read, change or delete another's annotations (someone else's
//     annotation id simply isn't found: 404).
// Annotations never appear on any public or admin endpoint.

const DEFAULT_MAX_PER_BOOK = 2000;
const getMaxPerBook = () => {
    const n = parseInt(process.env.READER_ANNOTATIONS_MAX_PER_BOOK, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 10000) : DEFAULT_MAX_PER_BOOK;
};

// Plain text only: notes and labels are always rendered as text (React
// escapes them), and control characters other than newlines/tabs are
// removed here so nothing odd is stored.
const cleanText = (value) =>
    String(value)
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim();

const isOffset = (n) => Number.isInteger(n) && n >= 0 && n <= 1000000;

// Shape returned to the reader (never `reader` or `book`).
const toClient = (doc) => ({
    _id: String(doc._id),
    chapterId: String(doc.chapterId),
    language: doc.language,
    type: doc.type,
    color: doc.color,
    note: doc.note || '',
    label: doc.label || '',
    anchor: {
        paragraphIndex: doc.anchor?.paragraphIndex ?? null,
        startOffset: doc.anchor?.startOffset ?? null,
        endOffset: doc.anchor?.endOffset ?? null,
        quote: doc.anchor?.quote || '',
        prefix: doc.anchor?.prefix || '',
        suffix: doc.anchor?.suffix || '',
    },
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
});

// Access check shared by every handler. Returns the book (chapter ids only)
// or null after responding.
const loadAccessibleBook = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.bookId)) {
        res.status(404).json({ message: 'Book not found' });
        return null;
    }
    const book = await Book.findById(req.params.bookId).select('chapters._id');
    if (!book) {
        res.status(404).json({ message: 'Book not found' });
        return null;
    }
    if (!(await hasBookAccess(req.user, book._id))) {
        res.status(403).json({ message: "You don't have access to this book" });
        return null;
    }
    return book;
};

// Validates note/label/color fields present in `body`. Returns
// { fields } or { error }.
const editableFields = (body, type) => {
    const fields = {};
    if (body.note !== undefined) {
        if (typeof body.note !== 'string') return { error: 'note must be text.' };
        const note = cleanText(body.note);
        if (note.length > NOTE_MAX_LENGTH) return { error: `Notes can be at most ${NOTE_MAX_LENGTH} characters.` };
        fields.note = note;
    }
    if (body.label !== undefined) {
        if (typeof body.label !== 'string') return { error: 'label must be text.' };
        const label = cleanText(body.label).replace(/\s+/g, ' ');
        if (label.length > LABEL_MAX_LENGTH) return { error: `Bookmark labels can be at most ${LABEL_MAX_LENGTH} characters.` };
        fields.label = label;
    }
    if (body.color !== undefined) {
        if (type !== 'highlight') return { error: 'Only highlights have a color.' };
        if (!HIGHLIGHT_COLORS.includes(body.color)) return { error: `color must be one of ${HIGHLIGHT_COLORS.join(', ')}.` };
        fields.color = body.color;
    }
    return { fields };
};

const validateAnchor = (anchor, type) => {
    if (type === 'bookmark') {
        const paragraphIndex = anchor?.paragraphIndex;
        if (paragraphIndex !== undefined && paragraphIndex !== null && !isOffset(paragraphIndex)) {
            return { error: 'Invalid bookmark position.' };
        }
        return {
            anchor: {
                paragraphIndex: paragraphIndex ?? null,
                quote: typeof anchor?.quote === 'string' ? anchor.quote.slice(0, 200) : '',
            },
        };
    }
    if (!anchor || typeof anchor !== 'object') return { error: 'A highlight needs an anchor.' };
    const { paragraphIndex, startOffset, endOffset, quote, prefix = '', suffix = '' } = anchor;
    if (![paragraphIndex, startOffset, endOffset].every(isOffset) || endOffset <= startOffset) {
        return { error: 'Invalid highlight position.' };
    }
    if (typeof quote !== 'string' || !quote.trim()) return { error: 'A highlight needs its quoted text.' };
    if (quote.length > QUOTE_MAX_LENGTH) return { error: `Highlights can be at most ${QUOTE_MAX_LENGTH} characters.` };
    if (typeof prefix !== 'string' || typeof suffix !== 'string') return { error: 'Invalid highlight context.' };
    return {
        anchor: {
            paragraphIndex,
            startOffset,
            endOffset,
            quote,
            prefix: prefix.slice(-CONTEXT_MAX_LENGTH),
            suffix: suffix.slice(0, CONTEXT_MAX_LENGTH),
        },
    };
};

//@desc    The logged-in reader's highlights and bookmarks for a book (all
//         languages; the reader shows the ones for the language on screen).
//@route   GET /api/kenlibs/annotations/:bookId
//@access  Private — hasBookAccess, own annotations only.
const getAnnotations = async (req, res) => {
    try {
        const book = await loadAccessibleBook(req, res);
        if (!book) return;
        const docs = await ReaderAnnotation.find({ reader: req.user._id, book: book._id }).sort({ createdAt: 1 }).lean();
        res.set('Cache-Control', 'no-store');
        res.status(200).json({ annotations: docs.map(toClient), maxPerBook: getMaxPerBook() });
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Create a highlight or bookmark.
//         Body: { type, chapterId, language?, color?, note?, label?, anchor }
//@route   POST /api/kenlibs/annotations/:bookId
//@access  Private — hasBookAccess.
const createAnnotation = async (req, res) => {
    try {
        const book = await loadAccessibleBook(req, res);
        if (!book) return;
        const body = req.body || {};
        const type = body.type;
        if (!['highlight', 'bookmark'].includes(type)) return res.status(400).json({ message: 'type must be highlight or bookmark.' });

        const chapterId = String(body.chapterId || '');
        if (!mongoose.isValidObjectId(chapterId) || !book.chapters.some((c) => String(c._id) === chapterId)) {
            return res.status(400).json({ message: 'That chapter is not in this book.' });
        }
        const language = body.language === undefined ? 'original' : body.language;
        if (language !== 'original' && !getLanguage(language)) return res.status(400).json({ message: 'Unknown language.' });

        const { fields, error } = editableFields(body, type);
        if (error) return res.status(400).json({ message: error });
        const anchored = validateAnchor(body.anchor, type);
        if (anchored.error) return res.status(400).json({ message: anchored.error });

        const max = getMaxPerBook();
        if ((await ReaderAnnotation.countDocuments({ reader: req.user._id, book: book._id })) >= max) {
            return res.status(409).json({ code: 'limit', message: `You can keep up to ${max.toLocaleString('en-US')} highlights and bookmarks per book. Delete some to add more.` });
        }

        const doc = await ReaderAnnotation.create({
            reader: req.user._id,
            book: book._id,
            chapterId,
            language,
            type,
            ...fields,
            anchor: anchored.anchor,
        });
        res.status(201).json(toClient(doc));
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Change a highlight's color or note, or a bookmark's label.
//@route   PUT /api/kenlibs/annotations/:bookId/:annotationId
//@access  Private — hasBookAccess, own annotation only (else 404).
const updateAnnotation = async (req, res) => {
    try {
        const book = await loadAccessibleBook(req, res);
        if (!book) return;
        if (!mongoose.isValidObjectId(req.params.annotationId)) return res.status(404).json({ message: 'Not found' });
        const filter = { _id: req.params.annotationId, reader: req.user._id, book: book._id };
        const existing = await ReaderAnnotation.findOne(filter).select('type').lean();
        if (!existing) return res.status(404).json({ message: 'Not found' });

        const { fields, error } = editableFields(req.body || {}, existing.type);
        if (error) return res.status(400).json({ message: error });
        if (!Object.keys(fields).length) return res.status(400).json({ message: 'Nothing to update.' });

        const doc = await ReaderAnnotation.findOneAndUpdate(filter, { $set: fields }, { returnDocument: 'after' }).lean();
        if (!doc) return res.status(404).json({ message: 'Not found' });
        res.status(200).json(toClient(doc));
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Delete one highlight or bookmark.
//@route   DELETE /api/kenlibs/annotations/:bookId/:annotationId
//@access  Private — hasBookAccess, own annotation only (else 404).
const deleteAnnotation = async (req, res) => {
    try {
        const book = await loadAccessibleBook(req, res);
        if (!book) return;
        if (!mongoose.isValidObjectId(req.params.annotationId)) return res.status(404).json({ message: 'Not found' });
        const result = await ReaderAnnotation.deleteOne({ _id: req.params.annotationId, reader: req.user._id, book: book._id });
        if (!result.deletedCount) return res.status(404).json({ message: 'Not found' });
        res.status(200).json({ deleted: true });
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = { getAnnotations, createAnnotation, updateAnnotation, deleteAnnotation, getMaxPerBook };
