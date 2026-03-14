const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildClerkshipDefinitions,
  compareActions,
  findBestBoundedSwaps,
  simulateAction,
  validateSchedule
} = require('./solver');

const clerkshipDefinitions = buildClerkshipDefinitions();

test('findBestBoundedSwaps accepts a free move into open availability', () => {
  const result = findBestBoundedSwaps(
    [{ id: 1, name: 'Alice' }],
    {
      1: [{ clerkship: 'EMED 301A', start_period: '1A', year: 1, is_immobile: false }]
    },
    {},
    [
      {
        id: 101,
        user_id: 1,
        clerkship: 'EMED 301A',
        from_period: '1A',
        from_year: 1,
        to_period: '2A',
        to_year: 1
      }
    ],
    {
      'EMED 301A|2A|1': 1
    }
  );

  assert.equal(result.acceptedActions.length, 1);
  assert.equal(result.acceptedActions[0].type, 'FREE_MOVE');
  assert.equal(result.finalSchedulesByUser['1'][0].startPeriod, '2A');
  assert.equal(result.unmetDesires.length, 0);
});

test('findBestBoundedSwaps accepts a 2-way swap', () => {
  const result = findBestBoundedSwaps(
    [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' }
    ],
    {
      1: [{ clerkship: 'EMED 301A', start_period: '1A', year: 1, is_immobile: false }],
      2: [{ clerkship: 'EMED 301A', start_period: '2A', year: 1, is_immobile: false }]
    },
    {},
    [
      {
        id: 201,
        user_id: 1,
        clerkship: 'EMED 301A',
        from_period: '1A',
        from_year: 1,
        to_period: '2A',
        to_year: 1
      },
      {
        id: 202,
        user_id: 2,
        clerkship: 'EMED 301A',
        from_period: '2A',
        from_year: 1,
        to_period: '1A',
        to_year: 1
      }
    ],
    {}
  );

  assert.equal(result.acceptedActions.length, 1);
  assert.equal(result.acceptedActions[0].type, 'SWAP_2');
  assert.equal(result.finalSchedulesByUser['1'][0].startPeriod, '2A');
  assert.equal(result.finalSchedulesByUser['2'][0].startPeriod, '1A');
  assert.equal(result.satisfiedDesires.length, 2);
});

test('findBestBoundedSwaps accepts a 3-way swap', () => {
  const result = findBestBoundedSwaps(
    [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Cara' }
    ],
    {
      1: [{ clerkship: 'EMED 301A', start_period: '1A', year: 1, is_immobile: false }],
      2: [{ clerkship: 'EMED 301A', start_period: '2A', year: 1, is_immobile: false }],
      3: [{ clerkship: 'EMED 301A', start_period: '3A', year: 1, is_immobile: false }]
    },
    {},
    [
      {
        id: 301,
        user_id: 1,
        clerkship: 'EMED 301A',
        from_period: '1A',
        from_year: 1,
        to_period: '2A',
        to_year: 1
      },
      {
        id: 302,
        user_id: 2,
        clerkship: 'EMED 301A',
        from_period: '2A',
        from_year: 1,
        to_period: '3A',
        to_year: 1
      },
      {
        id: 303,
        user_id: 3,
        clerkship: 'EMED 301A',
        from_period: '3A',
        from_year: 1,
        to_period: '1A',
        to_year: 1
      }
    ],
    {}
  );

  assert.equal(result.acceptedActions.length, 1);
  assert.equal(result.acceptedActions[0].type, 'SWAP_3');
  assert.equal(result.finalSchedulesByUser['1'][0].startPeriod, '2A');
  assert.equal(result.finalSchedulesByUser['2'][0].startPeriod, '3A');
  assert.equal(result.finalSchedulesByUser['3'][0].startPeriod, '1A');
});

test('simulateAction rejects overlap failures after applying the candidate move', () => {
  const state = {
    schedulesByUser: {
      1: [
        { userId: 1, clerkship: 'EMED 301A', startPeriod: '1A', year: 1, isImmobile: false },
        { userId: 1, clerkship: 'FAMMED 301A', startPeriod: '2A', year: 1, isImmobile: false }
      ]
    },
    openAvailabilityBySlot: {
      'EMED 301A|2A|1': 1
    },
    occupancyBySlot: {
      'EMED 301A|1A|1': new Set(['1']),
      'FAMMED 301A|2A|1': new Set(['1'])
    },
    satisfiedDesireIds: new Set()
  };

  const action = {
    type: 'FREE_MOVE',
    participantUserIds: [1],
    desireIdsSatisfied: [401],
    moves: [
      {
        userId: 1,
        clerkship: 'EMED 301A',
        fromPeriod: '1A',
        fromYear: 1,
        toPeriod: '2A',
        toYear: 1
      }
    ]
  };

  const simulation = simulateAction(state, action, {}, { 1: new Set() }, clerkshipDefinitions);

  assert.equal(simulation.valid, false);
  assert.match(simulation.reason, /validation failed/i);
});

test('validateSchedule rejects prerequisite failures', () => {
  const validation = validateSchedule(
    [
      { clerkship: 'SURG 300A', start_period: '5A', year: 1 },
      { clerkship: 'MED 300A', start_period: '1A', year: 1 },
      { clerkship: 'ANES 306A', start_period: '3A', year: 1 }
    ],
    [],
    clerkshipDefinitions
  );

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /must start after SURG 300A ends/i);
});

test('validateSchedule rejects blocked-period failures across occupied half-slots', () => {
  const validation = validateSchedule(
    [{ clerkship: 'OBGYN 300A', start_period: '1A', year: 1 }],
    [{ period: '2A', year: 1 }],
    clerkshipDefinitions
  );

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join(' '), /blocked period 2A/i);
});

test('validateSchedule counts year 0 clerkships toward the year-1 minimum', () => {
  const validation = validateSchedule(
    [
      { clerkship: 'ANES 306A', start_period: '10A', year: 0 },
      { clerkship: 'EMED 301A', start_period: '1A', year: 1 },
      { clerkship: 'FAMMED 301A', start_period: '2A', year: 1 },
      { clerkship: 'PSYC 300A', start_period: '3A', year: 1 }
    ],
    [],
    clerkshipDefinitions
  );

  assert.equal(validation.valid, true);
});

test('findBestBoundedSwaps prefers a higher-priority desire when one user has conflicting requests', () => {
  const result = findBestBoundedSwaps(
    [{ id: 1, name: 'Alice' }],
    {
      1: [{ clerkship: 'EMED 301A', start_period: '1A', year: 1, is_immobile: false }]
    },
    {},
    [
      {
        id: 801,
        user_id: 1,
        clerkship: 'EMED 301A',
        from_period: '1A',
        from_year: 1,
        to_period: '2A',
        to_year: 1,
        created_at: '2026-01-01T00:00:00Z',
        priority_rank: 2
      },
      {
        id: 802,
        user_id: 1,
        clerkship: 'EMED 301A',
        from_period: '1A',
        from_year: 1,
        to_period: '3A',
        to_year: 1,
        created_at: '2026-02-01T00:00:00Z',
        priority_rank: 1
      }
    ],
    {
      'EMED 301A|2A|1': 1,
      'EMED 301A|3A|1': 1
    }
  );

  assert.equal(result.acceptedActions.length, 1);
  assert.equal(result.acceptedActions[0].moves[0].toPeriod, '3A');
  assert.equal(result.satisfiedDesires[0].id, 802);
});

test('compareActions breaks ties deterministically with canonical ordering', () => {
  const desiresById = {
    d1: { id: 'd1', createdAt: null, priorityRank: null },
    d2: { id: 'd2', createdAt: null, priorityRank: null }
  };
  const actionA = {
    type: 'FREE_MOVE',
    participantUserIds: ['1'],
    desireIdsSatisfied: ['d1'],
    moves: [
      {
        userId: '1',
        clerkship: 'EMED 301A',
        fromPeriod: '1A',
        fromYear: 1,
        toPeriod: '2A',
        toYear: 1
      }
    ]
  };
  const actionB = {
    type: 'FREE_MOVE',
    participantUserIds: ['1'],
    desireIdsSatisfied: ['d2'],
    moves: [
      {
        userId: '1',
        clerkship: 'EMED 301A',
        fromPeriod: '1A',
        fromYear: 1,
        toPeriod: '3A',
        toYear: 1
      }
    ]
  };

  assert.equal(compareActions(actionA, actionB, desiresById) < 0, true);
});
