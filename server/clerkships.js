// Static clerkship definitions
const CLERKSHIPS = {
  'ANES 306A': {
    name: 'ANES 306A',
    fullName: 'Critical Care Core Clerkship (A)',
    length: 1, // periods
    subPeriods: 2, // 1 period = 2 sub-periods (A+B)
    validStarts: {
      1: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A','11A','12A'],
      2: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A']
    },
    prerequisites: ['SURG 300A', 'MED 300A']
  },
  'ANES 306P': {
    name: 'ANES 306P',
    fullName: 'Critical Care Core Clerkship (P)',
    length: 1,
    subPeriods: 2,
    validStarts: {
      1: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A','11A','12A'],
      2: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A']
    },
    prerequisites: ['SURG 300A', 'PEDS 300A']
  },
  'EMED 301A': {
    name: 'EMED 301A',
    fullName: 'Emergency Medicine Core Clerkship',
    length: 1,
    subPeriods: 2,
    validStarts: {
      1: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A','11A','12A'],
      2: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A']
    },
    prerequisites: []
  },
  'FAMMED 301A': {
    name: 'FAMMED 301A',
    fullName: 'Family Medicine Core Clerkship',
    length: 1,
    subPeriods: 2,
    validStarts: {
      1: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A','11A','12A'],
      2: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A']
    },
    prerequisites: []
  },
  'MED 300A': {
    name: 'MED 300A',
    fullName: 'Internal Medicine Core Clerkship',
    length: 2,
    subPeriods: 4,
    validStarts: {
      1: ['1A','3A','5A','7A','9A','11A'],
      2: []
    },
    prerequisites: []
  },
  'MED 313A': {
    name: 'MED 313A',
    fullName: 'Ambulatory Medicine Core Clerkship',
    length: 1,
    subPeriods: 2,
    validStarts: {
      1: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A','11A','12A'],
      2: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A']
    },
    prerequisites: []
  },
  'NENS 301A': {
    name: 'NENS 301A',
    fullName: 'Neurology Core Clerkship',
    length: 1,
    subPeriods: 2,
    validStarts: {
      1: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A','11A','12A'],
      2: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A']
    },
    prerequisites: []
  },
  'OBGYN 300A': {
    name: 'OBGYN 300A',
    fullName: 'Obstetrics and Gynecology Core Clerkship',
    length: 1.5,
    subPeriods: 3,
    validStarts: {
      1: ['1A','2B','4A','5B','7A','8B','10A','11B'],
      2: ['1A','2B']
    },
    prerequisites: []
  },
  'PEDS 300A': {
    name: 'PEDS 300A',
    fullName: 'Pediatrics Core Clerkship',
    length: 2,
    subPeriods: 4,
    validStarts: {
      1: ['1A','3A','5A','7A','9A','11A'],
      2: ['1A','3A','5A','7A']
    },
    prerequisites: []
  },
  'PSYC 300A': {
    name: 'PSYC 300A',
    fullName: 'Psychiatry Core Clerkship',
    length: 1,
    subPeriods: 2,
    validStarts: {
      1: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A','11A','12A'],
      2: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A']
    },
    prerequisites: []
  },
  'SURG 300A': {
    name: 'SURG 300A',
    fullName: 'Surgery Core Clerkship',
    length: 2,
    subPeriods: 4,
    validStarts: {
      1: ['1A','3A','5A','7A','9A','11A'],
      2: []
    },
    prerequisites: []
  }
};

// All 24 sub-periods in order for one year
const ALL_PERIODS = [
  '1A','1B','2A','2B','3A','3B','4A','4B',
  '5A','5B','6A','6B','7A','7B','8A','8B',
  '9A','9B','10A','10B','11A','11B','12A','12B'
];

// Convert period string to linear index (0-23)
function periodToIndex(period) {
  return ALL_PERIODS.indexOf(period);
}

// Convert linear index back to period string
function indexToPeriod(index) {
  return ALL_PERIODS[index];
}

// Get all sub-periods occupied by a clerkship starting at a given period
function getOccupiedPeriods(clerkship, startPeriod) {
  const def = CLERKSHIPS[clerkship];
  if (!def) return [];
  const startIdx = periodToIndex(startPeriod);
  if (startIdx === -1) return [];
  const periods = [];
  for (let i = 0; i < def.subPeriods; i++) {
    if (startIdx + i < ALL_PERIODS.length) {
      periods.push(ALL_PERIODS[startIdx + i]);
    }
  }
  return periods;
}

// Get the global index (0-47) for a period+year combo
function globalIndex(period, year) {
  return periodToIndex(period) + (year - 1) * 24;
}

module.exports = {
  CLERKSHIPS,
  ALL_PERIODS,
  periodToIndex,
  indexToPeriod,
  getOccupiedPeriods,
  globalIndex
};
