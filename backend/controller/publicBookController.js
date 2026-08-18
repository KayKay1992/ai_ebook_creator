const Book = require("../models/Book");

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

module.exports = { getPublicBookByShareId };
