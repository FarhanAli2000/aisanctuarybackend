const express = require('express');
const router = express.Router();
const {
  listTrips,
  createTrip,
  updateTrip,
  deleteTrip,
  listApplications,
  addWinner,
  removeApplication,
  reviewApplication,
  myApplications,
  submitMine,
} = require('../controllers/tripController');
const { protect } = require('../middleware/authMiddleware');
const { allowRoles } = require('../middleware/roleMiddleware');

router.use(protect);

const viewers = allowRoles('admin', 'founder');
const admin = allowRoles('admin');

// Student: their own trip forms (fixed paths first)
router.get('/mine', allowRoles('student'), myApplications);
router.put('/mine/:appId', allowRoles('student'), submitMine);

// Admin
router.delete('/applications/:appId', admin, removeApplication);
router.put('/applications/:appId/review', admin, reviewApplication);

router.route('/').get(viewers, listTrips).post(admin, createTrip);
router.route('/:id').put(admin, updateTrip).delete(admin, deleteTrip);
router.route('/:id/applications').get(viewers, listApplications).post(admin, addWinner);

module.exports = router;
