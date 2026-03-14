const { CLERKSHIPS, ALL_PERIODS, periodToIndex, getOccupiedPeriods, globalIndex } = require('../clerkships');

// Get all global sub-period indices occupied by a schedule entry
function getOccupiedGlobalIndices(clerkship, startPeriod, year) {
  const occupied = getOccupiedPeriods(clerkship, startPeriod);
  return occupied.map(p => globalIndex(p, year));
}

// Check if two schedule entries overlap
function entriesOverlap(entry1, entry2) {
  const indices1 = getOccupiedGlobalIndices(entry1.clerkship, entry1.start_period, entry1.year);
  const indices2 = getOccupiedGlobalIndices(entry2.clerkship, entry2.start_period, entry2.year);
  return indices1.some(i => indices2.includes(i));
}

// Get the last occupied global index for a schedule entry (for prereq checking)
function getEndIndex(clerkship, startPeriod, year) {
  const indices = getOccupiedGlobalIndices(clerkship, startPeriod, year);
  return Math.max(...indices);
}

// Get the first occupied global index
function getStartIndex(clerkship, startPeriod, year) {
  return globalIndex(startPeriod, year);
}

// Validate a complete schedule (array of entries) + blocked periods
// Returns { valid: boolean, errors: string[] }
function validateSchedule(entries, blockedPeriods = []) {
  const errors = [];

  // 1. Check no overlapping periods
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entriesOverlap(entries[i], entries[j])) {
        errors.push(`Overlap: ${entries[i].clerkship} and ${entries[j].clerkship}`);
      }
    }
  }

  // 2. At least 4 clerkships in year 1
  const year1Count = entries.filter(e => e.year === 1).length;
  if (year1Count < 4 && entries.length >= 4) {
    errors.push(`Only ${year1Count} clerkships in Year 1 (minimum 4 required)`);
  }

  // 3. Check prerequisites
  for (const entry of entries) {
    const def = CLERKSHIPS[entry.clerkship];
    if (!def || !def.prerequisites || def.prerequisites.length === 0) continue;

    const entryStart = getStartIndex(entry.clerkship, entry.start_period, entry.year);

    for (const prereq of def.prerequisites) {
      const prereqEntry = entries.find(e => e.clerkship === prereq);
      if (!prereqEntry) {
        // Prereq not in schedule - that's ok, maybe not scheduled yet
        continue;
      }
      const prereqEnd = getEndIndex(prereq, prereqEntry.start_period, prereqEntry.year);
      if (prereqEnd >= entryStart) {
        errors.push(`${entry.clerkship} requires ${prereq} to finish first`);
      }
    }
  }

  // 4. Check valid start dates
  for (const entry of entries) {
    const def = CLERKSHIPS[entry.clerkship];
    if (!def) {
      errors.push(`Unknown clerkship: ${entry.clerkship}`);
      continue;
    }
    const validStarts = def.validStarts[entry.year] || [];
    if (!validStarts.includes(entry.start_period)) {
      errors.push(`${entry.clerkship} cannot start at ${entry.start_period} in Year ${entry.year}`);
    }
  }

  // 5. No clerkship occupies a blocked period
  if (blockedPeriods.length > 0) {
    const blockedSet = new Set(blockedPeriods.map(b => `${b.year}-${b.period}`));
    for (const entry of entries) {
      const occupied = getOccupiedPeriods(entry.clerkship, entry.start_period);
      for (const p of occupied) {
        if (blockedSet.has(`${entry.year}-${p}`)) {
          errors.push(`${entry.clerkship} occupies blocked period ${p} in Year ${entry.year}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// Check if moving a single entry in a schedule is valid
// schedule: full list of entries for the user
// oldEntry: the entry being moved (to remove)
// newClerkship, newPeriod, newYear: the new position
// blockedPeriods: user's blocked periods
// immobileEntries: set of clerkship names that can't move
function validateMove(schedule, oldEntry, newPeriod, newYear, blockedPeriods = [], immobileClerkships = new Set()) {
  // Check immobile
  if (immobileClerkships.has(oldEntry.clerkship)) {
    return { valid: false, errors: [`${oldEntry.clerkship} is marked as immobile`] };
  }

  // Build new schedule
  const newSchedule = schedule
    .filter(e => e.clerkship !== oldEntry.clerkship)
    .concat([{
      clerkship: oldEntry.clerkship,
      start_period: newPeriod,
      year: newYear,
      is_immobile: oldEntry.is_immobile
    }]);

  return validateSchedule(newSchedule, blockedPeriods);
}

module.exports = {
  getOccupiedGlobalIndices,
  entriesOverlap,
  getEndIndex,
  getStartIndex,
  validateSchedule,
  validateMove
};
