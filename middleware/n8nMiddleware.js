const asyncHandler = require('express-async-handler');

const protectN8n = asyncHandler(async (req, res, next) => {
  const provided = req.headers['x-n8n-api-key'];
  const expected = process.env.N8N_API_KEY;
  if (!expected || provided !== expected) {
    res.status(401);
    throw new Error('Invalid n8n API key');
  }
  next();
});

module.exports = { protectN8n };
