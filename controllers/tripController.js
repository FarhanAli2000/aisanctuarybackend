const asyncHandler = require('express-async-handler');
const mongoose = require('mongoose');
const Trip = require('../models/Trip');
const TripApplication = require('../models/TripApplication');
const StudentProfile = require('../models/StudentProfile');
const Enrollment = require('../models/Enrollment');

const RELATIONS = ['father', 'mother', 'guardian'];

const fail = (res, code, message) => {
  res.status(code);
  throw new Error(message);
};

const validId = (id) => mongoose.isValidObjectId(id);

const endOfDay = (d) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const parseOptionalDate = (res, value, label) => {
  if (value === undefined || value === null || value === '') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) fail(res, 400, `${label} is not a valid date`);
  return d;
};

const tripFields = (res, body, { partial = false } = {}) => {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name || '').trim();
    if (!name) fail(res, 400, 'Trip name is required');
    out.name = name.slice(0, 120);
  }
  if (!partial || body.destination !== undefined) {
    const destination = String(body.destination || '').trim();
    if (!destination) fail(res, 400, 'Destination is required');
    out.destination = destination.slice(0, 120);
  }
  if (!partial || body.tripDate !== undefined) out.tripDate = parseOptionalDate(res, body.tripDate, 'Trip date');
  if (!partial || body.deadline !== undefined) out.deadline = parseOptionalDate(res, body.deadline, 'Deadline');
  if (body.notes !== undefined) out.notes = String(body.notes || '').trim().slice(0, 500);
  if (body.status !== undefined) {
    if (!['open', 'closed'].includes(body.status)) fail(res, 400, 'Status must be open or closed');
    out.status = body.status;
  }
  return out;
};

// Can the student still fill or change the form?
const isEditable = (trip, application) => {
  if (!trip || trip.status !== 'open') return false;
  if (application.status === 'approved') return false;
  if (trip.deadline && Date.now() > endOfDay(trip.deadline).getTime()) return false;
  return true;
};

const applicationView = (a, { forStudent = false } = {}) => ({
  id: a._id,
  tripId: a.trip?._id || a.trip,
  studentId: a.student?._id || a.student,
  ...(forStudent
    ? {}
    : { studentName: a.student?.user?.name || 'Unknown', studentPhone: a.student?.user?.phone || '' }),
  status: a.status,
  parents: (a.parents || []).map((p) => ({
    fullName: p.fullName,
    relation: p.relation,
    cnic: p.cnic,
    dateOfBirth: p.dateOfBirth,
    phone: p.phone,
    passportNumber: p.passportNumber,
    passportExpiry: p.passportExpiry,
  })),
  emergencyName: a.emergencyName || '',
  emergencyPhone: a.emergencyPhone || '',
  medicalNotes: a.medicalNotes || '',
  adminNote: a.adminNote || '',
  submittedAt: a.submittedAt || null,
  updatedAt: a.updatedAt,
});

const tripView = (t, counts) => ({
  id: t._id,
  name: t.name,
  destination: t.destination,
  tripDate: t.tripDate || null,
  deadline: t.deadline || null,
  notes: t.notes || '',
  status: t.status,
  createdAt: t.createdAt,
  ...(counts ? { counts } : {}),
});

// ---------- Admin / founder ----------

// @route GET /api/trips
const listTrips = asyncHandler(async (req, res) => {
  const trips = await Trip.find().sort({ createdAt: -1 }).lean();
  const apps = await TripApplication.find({ trip: { $in: trips.map((t) => t._id) } }, 'trip status').lean();
  const blank = () => ({ total: 0, pending: 0, submitted: 0, changes_requested: 0, approved: 0 });
  const byTrip = new Map();
  apps.forEach((a) => {
    const key = String(a.trip);
    if (!byTrip.has(key)) byTrip.set(key, blank());
    const c = byTrip.get(key);
    c.total += 1;
    c[a.status] += 1;
  });
  res.json({
    success: true,
    count: trips.length,
    data: trips.map((t) => tripView(t, byTrip.get(String(t._id)) || blank())),
  });
});

// @route POST /api/trips
const createTrip = asyncHandler(async (req, res) => {
  const fields = tripFields(res, req.body);
  const trip = await Trip.create({ ...fields, createdBy: req.user._id });
  res.status(201).json({ success: true, data: tripView(trip) });
});

// @route PUT /api/trips/:id
const updateTrip = asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) fail(res, 404, 'Trip not found');
  const fields = tripFields(res, req.body, { partial: true });
  const trip = await Trip.findByIdAndUpdate(req.params.id, fields, { new: true });
  if (!trip) fail(res, 404, 'Trip not found');
  res.json({ success: true, data: tripView(trip) });
});

// @route DELETE /api/trips/:id
const deleteTrip = asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) fail(res, 404, 'Trip not found');
  const trip = await Trip.findById(req.params.id);
  if (!trip) fail(res, 404, 'Trip not found');
  await TripApplication.deleteMany({ trip: trip._id });
  await trip.deleteOne();
  res.json({ success: true, message: 'Trip deleted' });
});

// @route GET /api/trips/:id/applications
const listApplications = asyncHandler(async (req, res) => {
  if (!validId(req.params.id)) fail(res, 404, 'Trip not found');
  const trip = await Trip.findById(req.params.id).lean();
  if (!trip) fail(res, 404, 'Trip not found');
  const apps = await TripApplication.find({ trip: trip._id })
    .populate({ path: 'student', populate: { path: 'user', select: 'name phone' } })
    .sort({ createdAt: 1 })
    .lean();
  res.json({ success: true, trip: tripView(trip), count: apps.length, data: apps.map((a) => applicationView(a)) });
});

// @route POST /api/trips/:id/applications   { studentId }
// The admin opens the trip for a student. Only students who completed at least one class
// (the ones on the Performance tab) can be chosen.
const addWinner = asyncHandler(async (req, res) => {
  const { studentId } = req.body;
  if (!validId(req.params.id)) fail(res, 404, 'Trip not found');
  if (!studentId || !validId(studentId)) fail(res, 400, 'Choose a student');
  const trip = await Trip.findById(req.params.id);
  if (!trip) fail(res, 404, 'Trip not found');
  if (!(await StudentProfile.exists({ _id: studentId }))) fail(res, 404, 'Student not found');
  if (!(await Enrollment.exists({ student: studentId, status: 'completed' }))) {
    fail(res, 400, 'Only students who completed a class can be chosen');
  }
  if (await TripApplication.exists({ trip: trip._id, student: studentId })) {
    fail(res, 400, 'This student is already on the trip');
  }
  const app = await TripApplication.create({ trip: trip._id, student: studentId });
  res.status(201).json({ success: true, data: { id: app._id } });
});

// @route DELETE /api/trips/applications/:appId
const removeApplication = asyncHandler(async (req, res) => {
  if (!validId(req.params.appId)) fail(res, 404, 'Not found');
  const app = await TripApplication.findByIdAndDelete(req.params.appId);
  if (!app) fail(res, 404, 'Not found');
  res.json({ success: true, message: 'Removed' });
});

// @route PUT /api/trips/applications/:appId/review   { status: approved | changes_requested, adminNote }
const reviewApplication = asyncHandler(async (req, res) => {
  const { status, adminNote } = req.body;
  if (!validId(req.params.appId)) fail(res, 404, 'Not found');
  if (!['approved', 'changes_requested'].includes(status)) fail(res, 400, 'Choose approve or ask for changes');
  const app = await TripApplication.findById(req.params.appId);
  if (!app) fail(res, 404, 'Not found');
  if (app.status === 'pending') fail(res, 400, 'The student has not submitted the form yet');
  const note = adminNote ? String(adminNote).trim().slice(0, 300) : '';
  if (status === 'changes_requested' && !note) fail(res, 400, 'Write what the student should correct');
  app.status = status;
  app.adminNote = status === 'approved' ? '' : note;
  app.reviewedBy = req.user._id;
  await app.save();
  res.json({ success: true, data: { id: app._id, status: app.status } });
});

// ---------- Student ----------

const myProfile = async (user) => StudentProfile.findOne({ user: user._id }).lean();

// @route GET /api/trips/mine
const myApplications = asyncHandler(async (req, res) => {
  const profile = await myProfile(req.user);
  if (!profile) return res.json({ success: true, count: 0, data: [] });
  const apps = await TripApplication.find({ student: profile._id }).populate('trip').sort({ createdAt: -1 }).lean();
  const data = apps
    .filter((a) => a.trip)
    .map((a) => ({
      ...applicationView(a, { forStudent: true }),
      editable: isEditable(a.trip, a),
      trip: tripView(a.trip),
    }));
  res.json({ success: true, count: data.length, data });
});

const digits = (v) => String(v || '').replace(/\D/g, '');

const parseParent = (res, p, index) => {
  const label = `Parent ${index + 1}`;
  const fullName = String(p?.fullName || '').trim();
  if (!fullName) fail(res, 400, `${label}: enter the full name`);
  if (!RELATIONS.includes(p?.relation)) fail(res, 400, `${label}: choose the relation`);
  const cnic = digits(p?.cnic);
  if (cnic.length !== 13) fail(res, 400, `${label}: CNIC must have 13 digits`);
  const dob = parseOptionalDate(res, p?.dateOfBirth, `${label} date of birth`);
  if (!dob || dob.getTime() > Date.now()) fail(res, 400, `${label}: enter a valid date of birth`);
  const phone = String(p?.phone || '').trim();
  if (digits(phone).length < 7) fail(res, 400, `${label}: enter a valid mobile number`);
  const passportNumber = String(p?.passportNumber || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5,15}$/.test(passportNumber)) {
    fail(res, 400, `${label}: passport number must be 5 to 15 letters or digits`);
  }
  const expiry = parseOptionalDate(res, p?.passportExpiry, `${label} passport expiry`);
  if (!expiry || expiry.getTime() < Date.now()) fail(res, 400, `${label}: the passport has expired or the date is missing`);
  return {
    fullName: fullName.slice(0, 120),
    relation: p.relation,
    cnic: `${cnic.slice(0, 5)}-${cnic.slice(5, 12)}-${cnic.slice(12)}`,
    dateOfBirth: dob,
    phone: phone.slice(0, 30),
    passportNumber,
    passportExpiry: expiry,
  };
};

// @route PUT /api/trips/mine/:appId  (the student submits or edits their parents' details)
const submitMine = asyncHandler(async (req, res) => {
  if (!validId(req.params.appId)) fail(res, 404, 'Not found');
  const profile = await myProfile(req.user);
  const app = profile ? await TripApplication.findOne({ _id: req.params.appId, student: profile._id }) : null;
  if (!app) fail(res, 404, 'Not found');
  const trip = await Trip.findById(app.trip).lean();
  if (!isEditable(trip, app)) fail(res, 403, 'This form is closed and can no longer be changed');

  const { parents, emergencyName, emergencyPhone, medicalNotes } = req.body;
  if (!Array.isArray(parents) || parents.length < 1 || parents.length > 2) {
    fail(res, 400, 'Add the details of one or two parents');
  }
  const parsed = parents.map((p, i) => parseParent(res, p, i));
  const eName = String(emergencyName || '').trim();
  const ePhone = String(emergencyPhone || '').trim();
  if (!eName) fail(res, 400, 'Enter the emergency contact name');
  if (digits(ePhone).length < 7) fail(res, 400, 'Enter a valid emergency contact number');
  if (medicalNotes && String(medicalNotes).length > 500) fail(res, 400, 'Notes can be at most 500 characters');

  app.parents = parsed;
  app.emergencyName = eName.slice(0, 120);
  app.emergencyPhone = ePhone.slice(0, 30);
  app.medicalNotes = medicalNotes ? String(medicalNotes).trim() : '';
  app.status = 'submitted';
  app.adminNote = '';
  app.submittedAt = new Date();
  await app.save();
  res.json({ success: true, data: { id: app._id, status: app.status } });
});

module.exports = {
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
};
