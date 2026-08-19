const express = require("express");
const router = express.Router();
const {
  getPublicBookByShareId,
  getKenlibsStorefront,
  getKenlibsBookById,
  getKenlibsBundleById,
} = require("../controller/publicBookController");

// Deliberately no `protect` middleware anywhere in this router — every
// route here must be reachable by a logged-out visitor.
router.get("/kenlibs", getKenlibsStorefront);
router.get("/kenlibs/books/:id", getKenlibsBookById);
router.get("/kenlibs/bundles/:id", getKenlibsBundleById);
router.get("/books/:shareId", getPublicBookByShareId);

module.exports = router;
