const express = require('express');

const { generateOutline, generateChapterContent } = require('../controller/aiController');
const { protect } = require('../middleware/authMiddleware');


const router = express.Router();

//Apply the protect middleware to all routes in this router
router.use(protect);

router.post('/generate-outline', generateOutline);
router.post('/generate-chapter-content', generateChapterContent);

module.exports = router;