const express = require('express');
const router = express.Router();
const {
  setFeePlan,
  recordPayment,
  getPayments,
  getPendingFees,
  getFeeSummary,
} = require('../controllers/feeController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.use(protect);

router.get('/summary', allowRoles('admin', 'founder'), getFeeSummary);
router.get('/pending', allowRoles('admin', 'founder', 'student'), getPendingFees);
router.put('/plans/:enrollmentId', allowRoles('admin'), setFeePlan);

router
  .route('/')
  .get(allowRoles('admin', 'founder', 'student'), getPayments)
  .post(allowRoles('admin'), recordPayment);

module.exports = router;
