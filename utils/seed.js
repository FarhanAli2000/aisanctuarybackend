/**
 * Run once to create the initial Founder and Admin accounts.
 * Usage: npm run seed
 * Edit the values below before running, then consider deleting/rotating
 * the password afterward for security.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const { ensureAttendanceStatuses } = require('./attendanceStats');

const seedUsers = [
  {
    role: 'founder',
    name: 'AI Sanctuary Founder',
    email: 'founder@aisanctuary.org',
    phone: '0300-0000000',
    password: 'ChangeMe123!', // change immediately after first login
  },
  {
    role: 'admin',
    name: 'AI Sanctuary Admin',
    email: 'admin@aisanctuary.org',
    phone: '0300-0000001',
    password: 'ChangeMe123!', // change immediately after first login
  },
];

const run = async () => {
  await connectDB();

  for (const u of seedUsers) {
    const exists = await User.findOne({ email: u.email });
    if (exists) {
      console.log(`Skipped (already exists): ${u.email}`);
      continue;
    }
    await User.create(u);
    console.log(`Created ${u.role}: ${u.email} / ${u.password}`);
  }

  await ensureAttendanceStatuses();
  console.log('Attendance statuses ready: Present, Absent, Leave');

  console.log('\nSeeding complete. Please log in and change these passwords immediately.');
  await mongoose.connection.close();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
