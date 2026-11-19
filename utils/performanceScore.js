// Student performance score (0-100). Pure functions, no database access, so they are easy to test.
//
//   Attendance   - attendance % over all the student's classes (leave counts as half, as everywhere else)
//   Classes      - (completed + 0.5 x still running) / all classes taken; dropped classes lower it
//   Evaluation   - teachers' ratings (1-5): latest evaluation of each class, averaged, as a % of 5
//   Placement    - placed = 100, interview = 50, otherwise 0
//
// The score is the weighted average of the parts that have data. A part with no data yet (e.g. no
// attendance marked) is left out and the other weights are scaled up, so a new student is not punished.

const DEFAULT_WEIGHTS = { attendance: 30, classes: 20, evaluation: 30, placement: 20 };
const PLACEMENT_POINTS = { placed: 100, interview: 50, looking: 0, not_yet: 0 };
const RATING_KEYS = ['skills', 'participation', 'assignments', 'behaviour'];

const round1 = (n) => Math.round(n * 10) / 10;

const evaluationAverage = (ratings = {}) => {
  const values = RATING_KEYS.map((k) => Number(ratings[k])).filter((n) => Number.isFinite(n));
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
};

const normaliseWeights = (raw = {}) => {
  const out = {};
  Object.keys(DEFAULT_WEIGHTS).forEach((k) => {
    const n = Number(raw[k]);
    out[k] = Number.isFinite(n) && n >= 0 ? n : DEFAULT_WEIGHTS[k];
  });
  return out;
};

const bandOf = (score, hasEvidence) => {
  if (!hasEvidence || score == null) return 'new';
  if (score >= 75) return 'excellent';
  if (score >= 50) return 'good';
  return 'needs_attention';
};

/**
 * @param {object} input
 * @param {{present:number,total:number}|null} input.attendance
 * @param {Array<{status:string}>} input.enrollments
 * @param {number|null} input.evaluationAvg   average rating 1-5, or null when never evaluated
 * @param {string} input.placementStatus
 * @param {object} weights
 */
const computeScore = ({ attendance, enrollments = [], evaluationAvg = null, placementStatus = 'not_yet' }, weights) => {
  const w = normaliseWeights(weights);

  const attendancePercent = attendance && attendance.total > 0 ? (attendance.present / attendance.total) * 100 : null;

  const total = enrollments.length;
  const completed = enrollments.filter((e) => e.status === 'completed').length;
  const active = enrollments.filter((e) => e.status === 'active').length;
  const classesScore = total > 0 ? ((completed + 0.5 * active) / total) * 100 : null;

  const evaluationScore = evaluationAvg == null ? null : (evaluationAvg / 5) * 100;
  const placementScore = PLACEMENT_POINTS[placementStatus] ?? 0;

  const parts = {
    attendance: attendancePercent,
    classes: classesScore,
    evaluation: evaluationScore,
    placement: placementScore,
  };

  let weighted = 0;
  let weightSum = 0;
  Object.keys(parts).forEach((k) => {
    if (parts[k] == null || w[k] <= 0) return;
    weighted += parts[k] * w[k];
    weightSum += w[k];
  });
  const score = weightSum > 0 ? round1(weighted / weightSum) : null;

  const hasEvidence = attendancePercent != null || evaluationScore != null;
  return {
    score,
    band: bandOf(score, hasEvidence),
    components: Object.fromEntries(
      Object.keys(parts).map((k) => [k, { score: parts[k] == null ? null : round1(parts[k]), weight: w[k] }])
    ),
  };
};

module.exports = {
  DEFAULT_WEIGHTS,
  PLACEMENT_POINTS,
  RATING_KEYS,
  evaluationAverage,
  normaliseWeights,
  bandOf,
  computeScore,
};
