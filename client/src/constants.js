// Mirror of server/clerkships.js for frontend use

export const CLERKSHIPS = {
  'ANES 306A': {
    name: 'ANES 306A',
    fullName: 'Critical Care Core Clerkship (A)',
    length: 1,
    subPeriods: 2,
    validStarts: {
      1: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A','11A','12A'],
      2: ['1A','2A','3A','4A','5A','6A','7A','8A','9A','10A']
    },
    prerequisites: ['SURG 300A', 'MED 300A'],
    color: '#e74c3c'
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
    prerequisites: ['SURG 300A', 'PEDS 300A'],
    color: '#c0392b'
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
    prerequisites: [],
    color: '#e67e22'
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
    prerequisites: [],
    color: '#27ae60'
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
    prerequisites: [],
    color: '#2980b9'
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
    prerequisites: [],
    color: '#3498db'
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
    prerequisites: [],
    color: '#9b59b6'
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
    prerequisites: [],
    color: '#e91e63'
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
    prerequisites: [],
    color: '#f39c12'
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
    prerequisites: [],
    color: '#1abc9c'
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
    prerequisites: [],
    color: '#34495e'
  }
};

export const ALL_PERIODS = [
  '1A','1B','2A','2B','3A','3B','4A','4B',
  '5A','5B','6A','6B','7A','7B','8A','8B',
  '9A','9B','10A','10B','11A','11B','12A','12B'
];

export const YEAR_ZERO_PERIODS = ['11A', '11B', '12A', '12B'];
export const YEAR_TWO_PERIODS = ALL_PERIODS.slice(0, periodToIndex('10B') + 1);
export const YEAR_PERIODS = {
  0: YEAR_ZERO_PERIODS,
  1: ALL_PERIODS,
  2: YEAR_TWO_PERIODS
};
export const YEAR_LABELS = {
  0: '2025-26',
  1: '2026-27',
  2: '2027-28'
};
export const SCHEDULE_YEARS = [0, 1, 2];

export const CLERKSHIP_NAMES = Object.keys(CLERKSHIPS);

export function periodToIndex(period) {
  return ALL_PERIODS.indexOf(period);
}

export function getOccupiedPeriods(clerkship, startPeriod) {
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

for (const definition of Object.values(CLERKSHIPS)) {
  definition.validStarts[0] = (definition.validStarts[1] || []).filter((startPeriod) =>
    getOccupiedPeriods(definition.name, startPeriod).every((period) => YEAR_ZERO_PERIODS.includes(period))
  );
}

export function getPeriodsForYear(year) {
  return YEAR_PERIODS[year] || ALL_PERIODS;
}

export function formatAcademicYear(year) {
  return YEAR_LABELS[year] || `Year ${year}`;
}

export function formatPeriodYear(period, year) {
  return `${period} ${formatAcademicYear(year)}`;
}
