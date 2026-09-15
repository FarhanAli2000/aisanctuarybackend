const fs = require('fs');

const getIdCardFiles = (req) => ({
  front: req.files?.identityDocFront?.[0],
  back: req.files?.identityDocBack?.[0],
});

const unlinkQuiet = (file) => {
  if (file?.path) fs.unlink(file.path, () => {});
};

const cleanupIdCardFiles = (req) => {
  const { front, back } = getIdCardFiles(req);
  unlinkQuiet(front);
  unlinkQuiet(back);
};

/** Save uploaded ID photos. No OCR / content validation. */
const requireAndVerifyIdCards = async (req, docType) => {
  const { front, back } = getIdCardFiles(req);
  const isBForm = docType === 'B-Form';

  if (!front) {
    unlinkQuiet(back);
    const err = new Error(
      isBForm
        ? 'Please upload a photo of the B-Form'
        : 'Please upload both the front and back photos of the CNIC'
    );
    err.statusCode = 400;
    throw err;
  }

  if (!isBForm && !back) {
    unlinkQuiet(front);
    const err = new Error('Please upload both the front and back photos of the CNIC');
    err.statusCode = 400;
    throw err;
  }

  if (isBForm && back) {
    unlinkQuiet(back);
  }

  return {
    identityDocFrontUrl: `/uploads/${front.filename}`,
    identityDocBackUrl: isBForm ? undefined : `/uploads/${back.filename}`,
    identityDocImageUrl: `/uploads/${front.filename}`,
  };
};

module.exports = { getIdCardFiles, requireAndVerifyIdCards, cleanupIdCardFiles };
