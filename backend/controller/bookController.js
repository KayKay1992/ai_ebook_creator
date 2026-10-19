const Book = require('../models/Book');
const { PREVIEW_CONTENT_MAX_LENGTH, CHAPTER_SUMMARY_MAX_LENGTH } = Book;
const { uploadBufferToCloudinary } = require('../utils/cloudinaryUpload');
const generateShareId = require('../utils/shareId');
const { publishGuard, parseRightsInput } = require('../utils/bookRights');
const { buildVoiceProfileInstruction } = require('../utils/voiceProfile');
const { deleteAudioAsset } = require('../utils/audioStorage');
const { partPublicIds } = require('../utils/narrationPipeline');
const BookTranslation = require('../models/BookTranslation');
const ReaderAnnotation = require('../models/ReaderAnnotation');

//@desc    Create a new book
//@route   POST /api/books
//@access  Private
const createBook = async (req, res) => {
    try {
          const { title, author, subtitle, description, chapters, tones, useIntroConclusionStructure } = req.body;

          if (!title || !author) {
            return res.status(400).json({ message: 'Title and author are required' });
        }

        const voiceTones = Array.isArray(tones) ? tones.slice(0, 7) : [];

        // Create a new book
        const book = await Book.create({
            userId: req.user._id,
            title,
            author,
            subtitle,
            description,
            // Omitted entirely (rather than passed as undefined) when the
            // client doesn't send it, so the schema's own `default: true`
            // applies instead of Mongoose writing an explicit undefined.
            ...(typeof useIntroConclusionStructure === 'boolean' ? { useIntroConclusionStructure } : {}),
            chapters,
            voiceProfile: {
                tones: voiceTones,
                instruction: buildVoiceProfileInstruction(voiceTones),
            },
        });

        res.status(201).json(book);
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Get all books for the logged-in user
//@route   GET /api/books
//@access  Private
const getBooks = async (req, res) => {
    try {
        // `audio` has its own endpoints (audioController.js) and isn't needed here.
        const books = await Book.find({ userId: req.user._id }).select('-audio').sort({ createdAt: -1 });
        res.status(200).json(books);
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Get a book by ID
//@route   GET /api/books/:id
//@access  Private
const getBookById = async (req, res) => {
    try {
        // Without `audio`: the editor loads it from GET /api/books/:id/audio,
        // and leaving it out keeps it from being sent back on every save.
        const book = await Book.findById(req.params.id).select('-audio');
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }
        if (book.userId.toString() !== req.user._id.toString()) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        res.status(200).json(book);
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Update a book by ID
//@route   PUT /api/books/:id
//@access  Private
const updateBook = async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }
        if (book.userId.toString() !== req.user._id.toString()) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const updates = { ...req.body };
        // Narration state belongs to the audio endpoints and the background
        // job; a whole-book PUT from the editor must never overwrite it.
        delete updates.audio;
        // Publishing goes through PUT /:id/publish (with the rights guard),
        // rights through PUT /:id/rights; ownership and import history
        // never change here. The editor sends the whole book back on every
        // save, so these are dropped rather than rejected.
        delete updates.status;
        delete updates.shareId;
        delete updates.rights;
        delete updates.importedFrom;
        delete updates.userId;

        if (updates.previewContent !== undefined) {
            if (typeof updates.previewContent !== 'string') {
                return res.status(400).json({ message: 'Storefront teaser must be text.' });
            }
            if (updates.previewContent.length > PREVIEW_CONTENT_MAX_LENGTH) {
                return res.status(400).json({
                    message: `Storefront teaser must be ${PREVIEW_CONTENT_MAX_LENGTH} characters or fewer (currently ${updates.previewContent.length}).`,
                });
            }
        }
        // Chapter summaries: same explicit length check as the teaser (the
        // update below skips schema validators).
        if (Array.isArray(updates.chapters)) {
            for (const [index, chapter] of updates.chapters.entries()) {
                if (!chapter || chapter.summary === undefined || chapter.summary === null) continue;
                if (typeof chapter.summary !== 'string') {
                    return res.status(400).json({ message: `Chapter ${index + 1}'s summary must be text.` });
                }
                if (chapter.summary.length > CHAPTER_SUMMARY_MAX_LENGTH) {
                    return res.status(400).json({
                        message: `Chapter ${index + 1}'s summary must be ${CHAPTER_SUMMARY_MAX_LENGTH} characters or fewer (currently ${chapter.summary.length}).`,
                    });
                }
            }
        }
        // instruction is always server-derived from tones — never trust a
        // client-supplied instruction string, so it can't drift from what
        // buildVoiceProfileInstruction would actually produce.
        if (updates.voiceProfile && Array.isArray(updates.voiceProfile.tones)) {
            const voiceTones = updates.voiceProfile.tones.slice(0, 7);
            updates.voiceProfile = {
                tones: voiceTones,
                instruction: buildVoiceProfileInstruction(voiceTones),
            };
        }

        const updatedBook = await Book.findByIdAndUpdate(req.params.id, updates, { returnDocument: "after" });
        res.status(200).json(updatedBook);
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Delete a book by ID
//@route   DELETE /api/books/:id
//@access  Private
const deleteBook = async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }
        if (book.userId.toString() !== req.user._id.toString()) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const audioEntries = book.audio?.chapters || [];
        // Chapter files plus saved parts of unfinished narration runs.
        const audioPublicIds = [...audioEntries.map((entry) => entry.publicId), ...partPublicIds(audioEntries)].filter(Boolean);
        await book.deleteOne();
        // Its translations go with it (they're nothing without the book).
        await BookTranslation.deleteMany({ bookId: book._id });
        // ...and every reader's highlights and bookmarks in it.
        await ReaderAnnotation.deleteMany({ book: book._id });
        res.status(200).json({ message: 'Book removed' });

        // Remove its narration files too. After responding, and each failure
        // only logged: the book is already gone either way.
        audioPublicIds.forEach((publicId) =>
            deleteAudioAsset(publicId).catch((error) =>
                console.error(`[deleteBook] Couldn't delete audio ${publicId} of book ${book._id}:`, error.message)
            )
        );
    } catch (error) {
        res.locals.error = error;
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc update a book's cover image 
//@route PUT /api/books/cover/:id
//@access Private
const updateBookCover = async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    
    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    if (book.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const result = await uploadBufferToCloudinary(req.file.buffer, "ebook-creator/covers");
    book.coverImage = result.secure_url;

    const updatedBook = await book.save();
    res.status(200).json(updatedBook);
  } catch (error) {
    res.locals.error = error;
    console.error("Cover upload error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

//@desc    Upload an inline image for a chapter's markdown content
//@route   POST /api/books/chapter-image/:id
//@access  Private
const uploadChapterImage = async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);

    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    if (book.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const result = await uploadBufferToCloudinary(req.file.buffer, "ebook-creator/chapters");
    res.status(200).json({ path: result.secure_url });
  } catch (error) {
    res.locals.error = error;
    console.error("Chapter image upload error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

// Shared upload handler for the two Cover Designer image slots (front
// background, author photo) — same ownership check + Cloudinary upload,
// differing only in which coverDesign field the resulting URL is written to.
const uploadCoverDesignImageHandler = (applyToBook) => async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);

    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    if (book.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    const result = await uploadBufferToCloudinary(req.file.buffer, "ebook-creator/cover-design");
    applyToBook(book, result.secure_url);

    const updatedBook = await book.save();
    res.status(200).json(updatedBook);
  } catch (error) {
    res.locals.error = error;
    console.error("Cover design image upload error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

//@desc    Upload the Cover Designer's front-cover background image
//@route   PUT /api/books/cover-design/front-image/:id
//@access  Private
const updateCoverDesignFrontImage = uploadCoverDesignImageHandler((book, url) => {
  book.coverDesign.front.backgroundImage = url;
});

//@desc    Upload the Cover Designer's back-cover author photo
//@route   PUT /api/books/cover-design/author-photo/:id
//@access  Private
const updateCoverDesignAuthorPhoto = uploadCoverDesignImageHandler((book, url) => {
  book.coverDesign.back.authorPhoto = url;
});

//@desc    Upload the 3D cover mockup's front-angle image (Step 40)
//@route   PUT /api/books/cover-design/render3d-front/:id
//@access  Private
const updateRender3DFrontImage = uploadCoverDesignImageHandler((book, url) => {
  book.coverDesign.render3D.frontImage = url;
});

//@desc    Upload the 3D cover mockup's back-angle image (Step 40)
//@route   PUT /api/books/cover-design/render3d-back/:id
//@access  Private
const updateRender3DBackImage = uploadCoverDesignImageHandler((book, url) => {
  book.coverDesign.render3D.backImage = url;
});

//@desc    Toggle a book's status between draft and published. Generates a
//         shareId the first time it's published; a book that's published
//         again after being unpublished keeps its original shareId (same
//         link stays valid rather than rotating on every toggle).
//@route   PUT /api/books/:id/publish
//@access  Private
const togglePublishStatus = async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);

    if (!book) {
      return res.status(404).json({ message: "Book not found" });
    }

    if (book.userId.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (book.status === "published") {
      book.status = "draft";
      book.set("rights.unpublishedAt", new Date());
      book.set("rights.unpublishedBy", req.user._id);
      if (typeof req.body?.takedownNote === "string") book.set("rights.takedownNote", req.body.takedownNote.trim().slice(0, 2000));
    } else {
      // Books by other authors need the rights fields and an explicit
      // confirmation ("I have the rights or written permission to sell
      // this book") every time they're published.
      const guard = publishGuard(book.rights || {}, { confirmed: req.body?.confirmRights === true });
      if (!guard.ok) {
        return res.status(400).json({ code: "rights_required", message: "Before publishing, complete the rights details.", missing: guard.missing });
      }
      if ((book.rights?.type || "own") !== "own") {
        book.set("rights.confirmedAt", new Date());
        book.set("rights.confirmedBy", req.user._id);
      }
      book.status = "published";
      if (!book.shareId) {
        book.shareId = generateShareId();
      }
    }

    const updatedBook = await book.save();
    res.status(200).json(updatedBook);
  } catch (error) {
    res.locals.error = error;
    console.error("Publish toggle error:", error);
    res.status(500).json({ message: "Server Error" });
  }
};

//@desc    Unpublish immediately (takedown). Always ends unpublished, so
//         a double click can't republish. Stops the storefront page, the
//         public preview and the share link at once; readers who already
//         bought the book keep reading it (access is by purchase).
//@route   POST /api/books/:id/unpublish  { takedownNote? }
//@access  Private/Admin
const unpublishBook = async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ message: "Book not found" });
    if (book.userId.toString() !== req.user._id.toString()) return res.status(401).json({ message: "Unauthorized" });
    book.status = "draft";
    book.set("rights.unpublishedAt", new Date());
    book.set("rights.unpublishedBy", req.user._id);
    if (typeof req.body?.takedownNote === "string") book.set("rights.takedownNote", req.body.takedownNote.trim().slice(0, 2000));
    const updatedBook = await book.save();
    res.status(200).json(updatedBook);
  } catch (error) {
    res.locals.error = error;
    res.status(500).json({ message: "Server Error" });
  }
};

//@desc    Rights, attribution and royalty details (admin-only fields).
//@route   PUT /api/books/:id/rights  { type, holderName, holderContact,
//         licenceNotes, licenceReference, licenceExpiresAt, territory,
//         royaltyPercent }
//@access  Private/Admin
const updateBookRights = async (req, res) => {
  try {
    const book = await Book.findById(req.params.id);
    if (!book) return res.status(404).json({ message: "Book not found" });
    if (book.userId.toString() !== req.user._id.toString()) return res.status(401).json({ message: "Unauthorized" });
    const parsed = parseRightsInput(req.body || {});
    if (parsed.error) return res.status(400).json({ message: parsed.error });
    for (const [key, value] of Object.entries(parsed.rights)) book.set(`rights.${key}`, value);
    // Changing to "own work" while published is fine; changing away from it
    // doesn't unpublish, but the next publish needs the confirmation.
    const updated = await book.save();
    res.status(200).json({ rights: updated.rights, status: updated.status });
  } catch (error) {
    res.locals.error = error;
    res.status(500).json({ message: "Server Error" });
  }
};

module.exports = {
    createBook,
    getBooks,
    getBookById,
    updateBook,
    deleteBook,
    updateBookCover,
    uploadChapterImage,
    togglePublishStatus,
    unpublishBook,
    updateBookRights,
    updateCoverDesignFrontImage,
    updateCoverDesignAuthorPhoto,
    updateRender3DFrontImage,
    updateRender3DBackImage,
};