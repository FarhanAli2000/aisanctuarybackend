const express = require('express');
const router = express.Router();
const {
  setFeePlan,
  recordPayment,
  getPayments,
  getPendingFees,
  getFeeSummary,
  updatePayment,
  deletePayment,
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

router
  .route('/:id')
  .put(allowRoles('admin'), updatePayment)
  .delete(allowRoles('admin'), deletePayment);

module.exports = router;
