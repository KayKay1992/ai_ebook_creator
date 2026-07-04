const Book = require('../models/Book');

//@desc    Create a new book
//@route   POST /api/books
//@access  Private
const createBook = async (req, res) => {
    try {
          const { title, author, subtitle, chapters } = req.body;

          if (!title || !author) {
            return res.status(400).json({ message: 'Title and author are required' });
        }

        // Create a new book
        const book = await Book.create({
            userId: req.user._id,
            title,
            author,
            subtitle,
            chapters,
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
        const updatedBook = await Book.findByIdAndUpdate(req.params.id, req.body, { new: true });
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
            return res.status(404).json({ message: 'Book not found' });
        }
        if (book.userId.toString() !== req.user._id.toString()) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
       if(req.file) {
            book.coverImage = `/${req.file.path}`;
        }else {
            return res.status(400).json({ message: 'No file uploaded' });
        }
        const updatedBook = await book.save();
        res.status(200).json(updatedBook);
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

module.exports = {
    createBook,
    getBooks,
    getBookById,
    updateBook,
    deleteBook,
    updateBookCover,
};