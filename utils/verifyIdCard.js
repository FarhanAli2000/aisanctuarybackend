const { createWorker } = require('tesseract.js');

const CNIC_NUMBER = /\b\d{5}[-\s]?\d{7}[-\s]?\d\b/;

const STRONG_ID_MARKERS = [
  'pakistan',
  'nadra',
  'identity',
  'cnic',
  'islamic',
  'republic',
  'national identity',
];

const FRONT_MARKERS = [
  ...STRONG_ID_MARKERS,
  'citizen',
  'gender',
  'father',
  'date of birth',
];

const BACK_MARKERS = [
  ...STRONG_ID_MARKERS,
  'address',
  'family',
  'holder',
  'permanent',
  'present',
  'country of stay',
];

const BFORM_STRONG = [
  'b-form',
  'b form',
  'bform',
  'child registration',
  'registration certificate',
  'form s-1',
  'form s1',
  'form s 1',
  'crc',
];

const CNIC_CARD_MARKERS = [
  'national identity card',
  'identity card',
  'smart card',
  'smart national',
];

const normalize = (raw) =>
  String(raw || '')
    .toLowerCase()
    .replace(/\s+/g, ' ');

const scoreText = (raw, markers) => {
  const text = normalize(raw);
  let score = 0;
  const hasNumber = CNIC_NUMBER.test(text);
  if (hasNumber) score += 3;
  markers.forEach((word) => {
    if (text.includes(word)) score += 1;
  });
  const hasStrong = STRONG_ID_MARKERS.some((word) => text.includes(word));
  return { score, text, hasNumber, hasStrong };
};

const looksLikeCnicCard = (text) =>
  CNIC_CARD_MARKERS.some((word) => text.includes(word)) &&
  !BFORM_STRONG.some((word) => text.includes(word)) &&
  !text.includes('child');

const looksLikeBForm = (text) => {
  if (looksLikeCnicCard(text)) return false;
  if (BFORM_STRONG.some((word) => text.includes(word))) return true;

  const hasOrg = text.includes('pakistan') || text.includes('nadra');
  const hasChild = text.includes('child');
  const hasCert = text.includes('certificate') || text.includes('registration');
  return hasOrg && hasChild && hasCert;
};

const looksLikeIdCard = (result) =>
  result.text.replace(/\s/g, '').length >= 12 &&
  result.score >= 2 &&
  (result.hasNumber || result.hasStrong);

let workerPromise;
let ocrQueue = Promise.resolve();

const getWorker = () => {
  if (!workerPromise) {
    workerPromise = createWorker('eng');
  }
  return workerPromise;
};

const withWorker = (fn) => {
  const run = ocrQueue.then(async () => {
    const worker = await getWorker();
    return fn(worker);
  });
  ocrQueue = run.then(
    () => {},
    () => {}
  );
  return run;
};

const verifyIdCardImages = async (frontPath, backPath, docType) => {
  try {
    return await withWorker(async (worker) => {
      const frontRaw = (await worker.recognize(frontPath))?.data?.text || '';
      const frontText = normalize(frontRaw);

      if (docType === 'B-Form') {
        if (frontText.replace(/\s/g, '').length < 12) {
          return {
            ok: false,
            message: 'This is not a B-Form. Please upload a clear photo of the B-Form.',
          };
        }
        if (looksLikeCnicCard(frontText) || !looksLikeBForm(frontText)) {
          return {
            ok: false,
            message: 'This is not a B-Form. Please upload a photo of the B-Form only.',
          };
        }
        return { ok: true };
      }

      const front = scoreText(frontRaw, FRONT_MARKERS);
      if (!looksLikeIdCard(front) || looksLikeBForm(front.text)) {
        return {
          ok: false,
          message:
            'Front photo is not a valid CNIC. Please upload a clear picture of the FRONT of your CNIC.',
        };
      }

      const backRaw = (await worker.recognize(backPath))?.data?.text || '';
      const back = scoreText(backRaw, BACK_MARKERS);
      if (!looksLikeIdCard(back)) {
        return {
          ok: false,
          message:
            'Back photo is not a valid CNIC. Please upload a clear picture of the BACK of your CNIC.',
        };
      }

      return { ok: true };
    });
  } catch (err) {
    return {
      ok: false,
      message: 'Could not read the document photo. Please upload a clearer JPG or PNG picture.',
    };
  }
};

module.exports = { verifyIdCardImages };
