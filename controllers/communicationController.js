const asyncHandler = require('express-async-handler');
const CommunicationLog = require('../models/CommunicationLog');

const createCommunicationLog = asyncHandler(async (req, res) => {
  const { recipient, type, status, subject, sentAt } = req.body;
  if (!recipient || !type) {
    res.status(400);
    throw new Error('recipient and type are required');
  }

  const log = await CommunicationLog.create({
    recipient,
    type,
    status: status || 'sent',
    subject: subject || '',
    sentAt: sentAt ? new Date(sentAt) : new Date(),
  });

  res.status(201).json({ success: true, data: log });
});

const getCommunicationLogs = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.type) filter.type = req.query.type;
  const logs = await CommunicationLog.find(filter)
    .populate('recipient', 'name email role')
    .sort({ sentAt: -1 })
    .limit(200);
  res.json({ success: true, count: logs.length, data: logs });
});

module.exports = { createCommunicationLog, getCommunicationLogs };
