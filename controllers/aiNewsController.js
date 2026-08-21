const asyncHandler = require('express-async-handler');
const { dispatchAiNews } = require('../utils/aiNewsDigest');

// @desc    Start weekly AI news approval flow (n8n emails admin first)
// @route   POST /api/ai-news/dispatch
// @access  Private/Admin
const dispatchAiNewsDigest = asyncHandler(async (req, res) => {
  const data = await dispatchAiNews();
  res.json({
    success: true,
    message:
      data.studentCount === 0
        ? 'Digest sent to admin for approval. No students yet, so nothing will go out after approval.'
        : `Digest sent to admin for approval. After approve it will go to ${data.studentCount} student(s).`,
    data,
  });
});

module.exports = { dispatchAiNewsDigest };
