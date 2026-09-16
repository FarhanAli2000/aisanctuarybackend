const startOfDay = (date) => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
};

const endOfDay = (date) => {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
};

const cycleEndOn = (date) => {
  const d = startOfDay(date);
  if (d.getDate() === 25) return d;
  if (d.getDate() < 25) {
    return new Date(d.getFullYear(), d.getMonth(), 25);
  }
  return new Date(d.getFullYear(), d.getMonth() + 1, 25);
};

const previousCycleEnd = (cycleEnd) => {
  const d = startOfDay(cycleEnd);
  return new Date(d.getFullYear(), d.getMonth() - 1, 25);
};

/**
 * 25-to-25 cycle: payments after the previous 25th through the current 25th inclusive.
 * Example: cycle ending 25 Apr = 26 Mar 00:00 through 25 Apr 23:59:59.
 */
const getCycleRange = (periodEnd) => {
  const end = cycleEndOn(periodEnd || new Date());
  const prev25 = previousCycleEnd(end);
  const start = new Date(prev25);
  start.setDate(start.getDate() + 1);
  start.setHours(0, 0, 0, 0);
  return { start, end: endOfDay(end), cycleEnd: startOfDay(end), previous25: prev25 };
};

const paidDateFilter = (periodEnd) => {
  const { start, end } = getCycleRange(periodEnd);
  return { $gte: start, $lte: end };
};

/** Whole rupees from user input — no float / comma surprises */
const parseRupees = (value) => {
  if (value === '' || value == null) return NaN;
  const cleaned = String(value).replace(/,/g, '').trim();
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n);
};

const splitAmount = (amount) => {
  const total = parseRupees(amount) || 0;
  // Exact % when amount is whole rupees: 50 / 10 / 40 (remainder stays with institute)
  const teacherShare = Math.floor((total * 50) / 100);
  const managerShare = Math.floor((total * 10) / 100);
  const instituteShare = total - teacherShare - managerShare;
  return { teacherShare, managerShare, instituteShare };
};

module.exports = {
  getCycleRange,
  paidDateFilter,
  splitAmount,
  cycleEndOn,
  parseRupees,
};
