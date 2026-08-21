require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

const authRoutes = require('./routes/authRoutes');
const studentRoutes = require('./routes/studentRoutes');
const teacherRoutes = require('./routes/teacherRoutes');
const courseRoutes = require('./routes/courseRoutes');
const batchRoutes = require('./routes/batchRoutes');
const enrollmentRoutes = require('./routes/enrollmentRoutes');
const enrollmentRequestRoutes = require('./routes/enrollmentRequestRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const feeRoutes = require('./routes/feeRoutes');
const attendanceRoutes = require('./routes/attendanceRoutes');
const communicationRoutes = require('./routes/communicationRoutes');
const aiNewsRoutes = require('./routes/aiNewsRoutes');
const { startAiNewsScheduler } = require('./utils/aiNewsDigest');

connectDB();

const app = express();

app.use(compression());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded identity documents (access-controlled at the API layer, not here)
app.use(
  '/uploads',
  express.static(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads'), {
    maxAge: '7d',
    etag: true,
  })
);

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'AI Sanctuary API is running' });
});

app.use('/api/auth', authRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/teachers', teacherRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/batches', batchRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/enrollment-requests', enrollmentRequestRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/fees', feeRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/communication-logs', communicationRoutes);
app.use('/api/ai-news', aiNewsRoutes);

app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`AI Sanctuary API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);
  startAiNewsScheduler();
});

module.exports = app;
