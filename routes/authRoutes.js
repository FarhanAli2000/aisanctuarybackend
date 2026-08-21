const express = require('express');
const router = express.Router();
const { login, signup, getMe } = require('../controllers/authController');
const { protect } = require('../middleware/authMiddleware');

router.post('/login', login);
router.post('/signup', signup);
router.get('/me', protect, getMe);

module.exports = router;
