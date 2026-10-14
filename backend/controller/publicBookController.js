const Book = require("../models/Book");
const Bundle = require("../models/Bundle");
const { AUDIO_SUMMARY_FIELDS, withAudioSummary } = require("../utils/audioSummary");

//@desc    Get a published book's read-only content by its public shareId
//@route   GET /api/public/books/:shareId
//@access  Public — no auth. Returns 404 for any book that isn't currently
//         published, even if the shareId itself is valid/guessed, so
//         unpublishing immediately invalidates the link.
const getPublicBookByShareId = async (req, res) => {
  try {
    const book = await Book.findOne({
      shareId: req.params.shareId,
      status: "published",
    }).select("title subtitle author coverImage chapters coverDesign");

    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    res.status(200).json(book);
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

// Fields for a storefront listing/preview — never chapter content. Kept in
// one place so the listing and detail endpoints can't drift from each other.
const KENLIBS_BOOK_FIELDS =
  "title subtitle author coverImage coverDesign price isForSale createdAt";
const KENLIBS_BOOK_PREVIEW_FIELDS = "title coverImage coverDesign";
// The single-book detail page additionally gets the admin-written teaser
// (previewContent). Kept off the listing on purpose: up to 2,000 chars per
// book would bloat the storefront payload for text no grid card shows.
const KENLIBS_BOOK_DETAIL_FIELDS = `${KENLIBS_BOOK_FIELDS} previewContent`;

//@desc    Browse the Kenlibs storefront — every published book (regardless
//         of price/isForSale, see KENLIBS-ARCHITECTURE.md's visibility rule)
//         plus every for-sale bundle.
//@route   GET /api/public/kenlibs
//@access  Public — no auth.
// Both queries are .lean(): this is a read-only JSON response, so there's
// no need to hydrate every book/bundle into a full Mongoose document first.
const getKenlibsStorefront = async (req, res) => {
  try {
    const [books, bundles] = await Promise.all([
      // Plus just enough to compute hasAudio/audioChapterCount, stripped
      // again below: never a publicId or URL in a public response.
      Book.find({ status: "published" })
        .select(`${KENLIBS_BOOK_FIELDS} ${AUDIO_SUMMARY_FIELDS}`)
        .sort({ createdAt: -1 })
        .lean(),
      Bundle.find({ isForSale: true })
        .select("title description coverImage price books")
        .populate({
          path: "books",
          select: KENLIBS_BOOK_PREVIEW_FIELDS,
          // A bundle can reference a book that's since gone back to draft —
          // don't surface it in the storefront preview, since there's
          // nowhere for a shopper to click through to it.
          match: { status: "published" },
        })
        .lean(),
    ]);

    res.status(200).json({ books: books.map((book) => withAudioSummary(book)), bundles });
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

//@desc    Get a single published book for its Kenlibs detail page.
//@route   GET /api/public/kenlibs/books/:id
//@access  Public — no auth. A draft book (even if priced) 404s here, same
//         visibility rule as the storefront listing.
const getKenlibsBookById = async (req, res) => {
  try {
    const book = await Book.findOne({
      _id: req.params.id,
      status: "published",
    })
      .select(`${KENLIBS_BOOK_DETAIL_FIELDS} ${AUDIO_SUMMARY_FIELDS}`)
      .lean();

    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    // hasAudio + audioChapterCount only — the raw audio entries (and the
    // chapter ids used to count them) are stripped.
    res.status(200).json(withAudioSummary(book));
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

//@desc    Get a single for-sale bundle for its Kenlibs detail page.
//@route   GET /api/public/kenlibs/bundles/:id
//@access  Public — no auth. A bundle with isForSale: false 404s here, same
//         visibility rule as the storefront listing.
const getKenlibsBundleById = async (req, res) => {
  try {
    const bundle = await Bundle.findOne({
      _id: req.params.id,
      isForSale: true,
    }).populate({
      path: "books",
      select: KENLIBS_BOOK_FIELDS,
      match: { status: "published" },
    });

    if (!bundle) {
      return res.status(404).json({ message: "Bundle not found" });
    }

    res.status(200).json(bundle);
  } catch (error) {
    res.status(500).json({ message: "Server Error" });
  }
};

module.exports = {
  getPublicBookByShareId,
  getKenlibsStorefront,
  getKenlibsBookById,
  getKenlibsBundleById,
};
