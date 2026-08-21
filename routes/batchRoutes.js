const express = require('express');
const router = express.Router();
const {
  createBatch,
  getBatches,
  getBatchById,
  updateBatch,
} = require('../controllers/batchController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.use(protect);

router.route('/').get(getBatches).post(allowRoles('admin'), createBatch);

router
  .route('/:id')
  .get(getBatchById)
  .put(allowRoles('admin'), updateBatch);

module.exports = router;
