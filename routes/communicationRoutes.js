const express = require('express');
const router = express.Router();
const {
  createCommunicationLog,
  getCommunicationLogs,
} = require('../controllers/communicationController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');
const { protectN8n } = require('../middleware/n8nMiddleware');

router.post('/', protectN8n, createCommunicationLog);
router.get('/', protect, allowRoles('admin', 'founder'), getCommunicationLogs);

module.exports = router;
