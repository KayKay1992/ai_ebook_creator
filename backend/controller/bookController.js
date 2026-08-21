const Book = require('../models/Book');
const { uploadBufferToCloudinary } = require('../utils/cloudinaryUpload');
const generateShareId = require('../utils/shareId');
const { buildVoiceProfileInstruction } = require('../utils/voiceProfile');

//@desc    Create a new book
//@route   POST /api/books
//@access  Private
const createBook = async (req, res) => {
    try {
          const { title, author, subtitle, chapters, tones } = req.body;

          if (!title || !author) {
            return res.status(400).json({ message: 'Title and author are required' });
        }

        const voiceTones = Array.isArray(tones) ? tones.slice(0, 3) : [];

        // Create a new book
        const book = await Book.create({
            userId: req.user._id,
            title,
            author,
            subtitle,
            chapters,
            voiceProfile: {
                tones: voiceTones,
                instruction: buildVoiceProfileInstruction(voiceTones),
            },
        });

        res.status(201).json(book);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Get all books for the logged-in user
//@route   GET /api/books
//@access  Private
const getBooks = async (req, res) => {
    try {
        const books = await Book.find({ userId: req.user._id }).sort({ createdAt: -1 });
        res.status(200).json(books);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

//@desc    Get a book by ID
//@route   GET /api/books/:id
//@access  Private
const getBookById = async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        if (!book) {
            return res.status(404).json({ message: 'Book not found' });
        }
        if (book.userId.toString() !== req.user._id.toString()) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        res.status(200).json(book);
    } catch (error) {
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
        // instruction is always server-derived from tones — never trust a
        // client-supplied instruction string, so it can't drift from what
        // buildVoiceProfileInstruction would actually produce.
        if (updates.voiceProfile && Array.isArray(updates.voiceProfile.tones)) {
            const voiceTones = updates.voiceProfile.tones.slice(0, 3);
            updates.voiceProfile = {
                tones: voiceTones,
                instruction: buildVoiceProfileInstruction(voiceTones),
            };
        }

        const updatedBook = await Book.findByIdAndUpdate(req.params.id, updates, { returnDocument: "after" });
        res.status(200).json(updatedBook);
    } catch (error) {
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
        await book.deleteOne();
        res.status(200).json({ message: 'Book removed' });
    } catch (error) {
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
    } else {
      book.status = "published";
      if (!book.shareId) {
        book.shareId = generateShareId();
      }
    }

    const updatedBook = await book.save();
    res.status(200).json(updatedBook);
  } catch (error) {
    console.error("Publish toggle error:", error);
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
    updateCoverDesignFrontImage,
    updateCoverDesignAuthorPhoto,
    updateRender3DFrontImage,
    updateRender3DBackImage,
};