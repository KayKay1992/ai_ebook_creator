const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();
const {
  getPublicBookByShareId,
  getKenlibsStorefront,
  getKenlibsBookById,
  getKenlibsBundleById,
} = require("../controller/publicBookController");
const { recordBookView } = require("../controller/bookViewController");

// Anonymous book-page views (analytics funnel). Per IP (app.js trusts the
// proxy on Render) without storing it; a reader browsing many books stays
// well under this.
const bookViewLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({ message: "Too many requests." }),
});

// Deliberately no `protect` middleware anywhere in this router — every
// route here must be reachable by a logged-out visitor.
router.get("/kenlibs", getKenlibsStorefront);
router.get("/kenlibs/books/:id", getKenlibsBookById);
router.post("/kenlibs/books/:id/view", bookViewLimiter, recordBookView);
router.get("/kenlibs/bundles/:id", getKenlibsBundleById);
router.get("/books/:shareId", getPublicBookByShareId);

module.exports = router;
