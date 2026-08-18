const express = require("express");
const router = express.Router();
const { getPublicBookByShareId } = require("../controller/publicBookController");

// Deliberately no `protect` middleware anywhere in this router — every
// route here must be reachable by a logged-out visitor.
router.get("/books/:shareId", getPublicBookByShareId);

module.exports = router;
