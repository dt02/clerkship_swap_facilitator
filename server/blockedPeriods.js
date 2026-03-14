const { YEAR_PERIODS, getOccupiedPeriods } = require('./clerkships');

function normalizeScheduleEntry(entry) {
  return {
    clerkship: entry.clerkship,
    startPeriod: entry.startPeriod ?? entry.start_period,
    year: Number(entry.year)
  };
}

function normalizeBlockedPeriod(blockedPeriod) {
  return {
    period: blockedPeriod.period,
    year: Number(blockedPeriod.year)
  };
}

function sanitizeBlockedPeriods(blockedPeriods, scheduleEntries) {
  const occupiedKeys = new Set();
  const seenBlockedKeys = new Set();

  for (const entry of (scheduleEntries || []).map(normalizeScheduleEntry)) {
    for (const period of getOccupiedPeriods(entry.clerkship, entry.startPeriod)) {
      occupiedKeys.add(`${entry.year}-${period}`);
    }
  }

  const sanitized = [];
  for (const blockedPeriod of (blockedPeriods || []).map(normalizeBlockedPeriod)) {
    const validPeriods = YEAR_PERIODS[blockedPeriod.year] || [];
    if (!validPeriods.includes(blockedPeriod.period)) {
      continue;
    }

    const blockedKey = `${blockedPeriod.year}-${blockedPeriod.period}`;
    if (occupiedKeys.has(blockedKey) || seenBlockedKeys.has(blockedKey)) {
      continue;
    }

    seenBlockedKeys.add(blockedKey);
    sanitized.push(blockedPeriod);
  }

  return sanitized;
}

module.exports = {
  sanitizeBlockedPeriods
};
