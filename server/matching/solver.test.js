const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildClerkshipDefinitions,
  buildDesireGraph,
  buildLPModel,
  buildOccupancyBySlot,
  compareActions,
  enumerateValidCycles,
  findBestBoundedSwaps,
  selectOptimalCycles,
  simulateAction,
  validateSchedule
} = require('./solver');

const clerkshipDefinitions = buildClerkshipDefinitions();

test('findBestBoundedSwaps accepts a free move into open availability', async () => {
  const result = await findBestBoundedSwaps(
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

test('findBestBoundedSwaps accepts a 2-way swap', async () => {
  const result = await findBestBoundedSwaps(
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

test('findBestBoundedSwaps accepts a 3-way swap', async () => {
  const result = await findBestBoundedSwaps(
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
      { clerkship: 'ANES 306A', start_period: '11A', year: 0 },
      { clerkship: 'EMED 301A', start_period: '1A', year: 1 },
      { clerkship: 'FAMMED 301A', start_period: '2A', year: 1 },
      { clerkship: 'PSYC 300A', start_period: '3A', year: 1 }
    ],
    [],
    clerkshipDefinitions
  );

  assert.equal(validation.valid, true);
});

test('findBestBoundedSwaps prefers a higher-priority desire when one user has conflicting requests', async () => {
  const result = await findBestBoundedSwaps(
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

test('buildDesireGraph produces correct edges for mutual desires', () => {
  const schedulesByUser = {
    '1': [{ userId: '1', clerkship: 'EMED 301A', startPeriod: '1A', year: 1, isImmobile: false }],
    '2': [{ userId: '2', clerkship: 'EMED 301A', startPeriod: '2A', year: 1, isImmobile: false }]
  };
  const state = {
    schedulesByUser,
    occupancyBySlot: buildOccupancyBySlot(schedulesByUser),
    openAvailabilityBySlot: {},
    satisfiedDesireIds: new Set()
  };
  const desires = [
    { id: 'd1', userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '2A', toYear: 1 },
    { id: 'd2', userId: '2', clerkship: 'EMED 301A', fromPeriod: '2A', fromYear: 1, toPeriod: '1A', toYear: 1 }
  ];
  const immobileByUser = { '1': new Set(), '2': new Set() };

  const graph = buildDesireGraph(state, desires, immobileByUser);

  assert.ok(graph.adjacency['1']);
  assert.equal(graph.adjacency['1'].length, 1);
  assert.equal(graph.adjacency['1'][0].to, '2');
  assert.ok(graph.adjacency['2']);
  assert.equal(graph.adjacency['2'].length, 1);
  assert.equal(graph.adjacency['2'][0].to, '1');
  assert.equal(Object.keys(graph.freeEdges).length, 0);
});

test('buildDesireGraph produces freeEdges when open availability exists', () => {
  const schedulesByUser = {
    '1': [{ userId: '1', clerkship: 'EMED 301A', startPeriod: '1A', year: 1, isImmobile: false }]
  };
  const state = {
    schedulesByUser,
    occupancyBySlot: buildOccupancyBySlot(schedulesByUser),
    openAvailabilityBySlot: { 'EMED 301A|2A|1': 1 },
    satisfiedDesireIds: new Set()
  };
  const desires = [
    { id: 'd1', userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '2A', toYear: 1 }
  ];
  const immobileByUser = { '1': new Set() };

  const graph = buildDesireGraph(state, desires, immobileByUser);

  assert.ok(graph.freeEdges['1']);
  assert.equal(graph.freeEdges['1'].length, 1);
  assert.equal(graph.freeEdges['1'][0].id, 'd1');
});

test('buildDesireGraph excludes immobile and satisfied desires', () => {
  const schedulesByUser = {
    '1': [{ userId: '1', clerkship: 'EMED 301A', startPeriod: '1A', year: 1, isImmobile: true }]
  };
  const state = {
    schedulesByUser,
    occupancyBySlot: buildOccupancyBySlot(schedulesByUser),
    openAvailabilityBySlot: { 'EMED 301A|2A|1': 1 },
    satisfiedDesireIds: new Set()
  };
  const desires = [
    { id: 'd1', userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '2A', toYear: 1 }
  ];
  const immobileByUser = { '1': new Set(['EMED 301A']) };

  const graph = buildDesireGraph(state, desires, immobileByUser);

  assert.deepEqual(graph.adjacency, Object.create(null));
  assert.deepEqual(graph.freeEdges, Object.create(null));
});

test('enumerateValidCycles finds 2-way and 3-way cycles', () => {
  const schedulesByUser = {
    '1': [{ userId: '1', clerkship: 'EMED 301A', startPeriod: '1A', year: 1, isImmobile: false }],
    '2': [{ userId: '2', clerkship: 'EMED 301A', startPeriod: '2A', year: 1, isImmobile: false }],
    '3': [{ userId: '3', clerkship: 'EMED 301A', startPeriod: '3A', year: 1, isImmobile: false }]
  };
  const state = {
    schedulesByUser,
    occupancyBySlot: buildOccupancyBySlot(schedulesByUser),
    openAvailabilityBySlot: {},
    satisfiedDesireIds: new Set()
  };
  const desires = [
    { id: 'd1', userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '2A', toYear: 1 },
    { id: 'd2', userId: '2', clerkship: 'EMED 301A', fromPeriod: '2A', fromYear: 1, toPeriod: '3A', toYear: 1 },
    { id: 'd3', userId: '3', clerkship: 'EMED 301A', fromPeriod: '3A', fromYear: 1, toPeriod: '1A', toYear: 1 }
  ];
  const immobileByUser = { '1': new Set(), '2': new Set(), '3': new Set() };
  const blockedByUser = {};

  const graph = buildDesireGraph(state, desires, immobileByUser);
  const cycles = enumerateValidCycles(state, graph, blockedByUser, immobileByUser, clerkshipDefinitions);

  const threeWay = cycles.filter((c) => c.type === 'SWAP_3');
  assert.equal(threeWay.length, 1);
  assert.equal(threeWay[0].participantUserIds.length, 3);
});

test('enumerateValidCycles deduplicates equivalent cycles', () => {
  const schedulesByUser = {
    '1': [{ userId: '1', clerkship: 'EMED 301A', startPeriod: '1A', year: 1, isImmobile: false }],
    '2': [{ userId: '2', clerkship: 'EMED 301A', startPeriod: '2A', year: 1, isImmobile: false }]
  };
  const state = {
    schedulesByUser,
    occupancyBySlot: buildOccupancyBySlot(schedulesByUser),
    openAvailabilityBySlot: {},
    satisfiedDesireIds: new Set()
  };
  const desires = [
    { id: 'd1', userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '2A', toYear: 1 },
    { id: 'd2', userId: '2', clerkship: 'EMED 301A', fromPeriod: '2A', fromYear: 1, toPeriod: '1A', toYear: 1 }
  ];
  const immobileByUser = { '1': new Set(), '2': new Set() };

  const graph = buildDesireGraph(state, desires, immobileByUser);
  const cycles = enumerateValidCycles(state, graph, {}, immobileByUser, clerkshipDefinitions);

  const twoWay = cycles.filter((c) => c.type === 'SWAP_2');
  assert.equal(twoWay.length, 1);
});

test('buildLPModel produces correct LP string with user and slot constraints', () => {
  const schedulesByUser = {
    '1': [{ userId: '1', clerkship: 'EMED 301A', startPeriod: '1A', year: 1, isImmobile: false }]
  };
  const state = {
    schedulesByUser,
    occupancyBySlot: buildOccupancyBySlot(schedulesByUser),
    openAvailabilityBySlot: { 'EMED 301A|2A|1': 1, 'EMED 301A|3A|1': 1 },
    satisfiedDesireIds: new Set()
  };
  const desiresById = {
    'd1': { id: 'd1', createdAt: '2026-01-01T00:00:00Z', priorityRank: 1 },
    'd2': { id: 'd2', createdAt: '2026-02-01T00:00:00Z', priorityRank: 2 }
  };
  const cycles = [
    {
      type: 'FREE_MOVE',
      participantUserIds: ['1'],
      desireIdsSatisfied: ['d1'],
      moves: [{ userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '2A', toYear: 1 }]
    },
    {
      type: 'FREE_MOVE',
      participantUserIds: ['1'],
      desireIdsSatisfied: ['d2'],
      moves: [{ userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '3A', toYear: 1 }]
    }
  ];

  const lp = buildLPModel(cycles, state, desiresById);

  assert.ok(lp.includes('Maximize'));
  assert.ok(lp.includes('Subject To'));
  assert.ok(lp.includes('Binary'));
  assert.ok(lp.includes('x_0'));
  assert.ok(lp.includes('x_1'));
  assert.ok(lp.includes('user_1'));
  assert.ok(lp.includes('<= 1'));
  assert.ok(lp.includes('slot_'));
});

test('selectOptimalCycles prefers 3-way swap over free move for same user', async () => {
  const schedulesByUser = {
    '1': [{ userId: '1', clerkship: 'EMED 301A', startPeriod: '1A', year: 1, isImmobile: false }],
    '2': [{ userId: '2', clerkship: 'EMED 301A', startPeriod: '2A', year: 1, isImmobile: false }],
    '3': [{ userId: '3', clerkship: 'EMED 301A', startPeriod: '3A', year: 1, isImmobile: false }]
  };
  const state = {
    schedulesByUser,
    occupancyBySlot: buildOccupancyBySlot(schedulesByUser),
    openAvailabilityBySlot: { 'EMED 301A|4A|1': 1 },
    satisfiedDesireIds: new Set()
  };
  const desiresById = {
    'd1': { id: 'd1', userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '2A', toYear: 1, createdAt: null, priorityRank: null },
    'd2': { id: 'd2', userId: '2', clerkship: 'EMED 301A', fromPeriod: '2A', fromYear: 1, toPeriod: '3A', toYear: 1, createdAt: null, priorityRank: null },
    'd3': { id: 'd3', userId: '3', clerkship: 'EMED 301A', fromPeriod: '3A', fromYear: 1, toPeriod: '1A', toYear: 1, createdAt: null, priorityRank: null },
    'd_free': { id: 'd_free', userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '4A', toYear: 1, createdAt: null, priorityRank: null }
  };
  const cycles = [
    {
      type: 'FREE_MOVE',
      participantUserIds: ['1'],
      desireIdsSatisfied: ['d_free'],
      moves: [{ userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '4A', toYear: 1 }]
    },
    {
      type: 'SWAP_3',
      participantUserIds: ['1', '2', '3'],
      desireIdsSatisfied: ['d1', 'd2', 'd3'],
      moves: [
        { userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '2A', toYear: 1 },
        { userId: '2', clerkship: 'EMED 301A', fromPeriod: '2A', fromYear: 1, toPeriod: '3A', toYear: 1 },
        { userId: '3', clerkship: 'EMED 301A', fromPeriod: '3A', fromYear: 1, toPeriod: '1A', toYear: 1 }
      ]
    }
  ];

  const selected = await selectOptimalCycles(cycles, state, desiresById);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].type, 'SWAP_3');
});

test('selectOptimalCycles selects independent non-conflicting swaps', async () => {
  const schedulesByUser = {
    '1': [{ userId: '1', clerkship: 'EMED 301A', startPeriod: '1A', year: 1, isImmobile: false }],
    '2': [{ userId: '2', clerkship: 'EMED 301A', startPeriod: '2A', year: 1, isImmobile: false }],
    '3': [{ userId: '3', clerkship: 'FAMMED 301A', startPeriod: '3A', year: 1, isImmobile: false }],
    '4': [{ userId: '4', clerkship: 'FAMMED 301A', startPeriod: '4A', year: 1, isImmobile: false }]
  };
  const state = {
    schedulesByUser,
    occupancyBySlot: buildOccupancyBySlot(schedulesByUser),
    openAvailabilityBySlot: {},
    satisfiedDesireIds: new Set()
  };
  const desiresById = {
    'd1': { id: 'd1', userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '2A', toYear: 1, createdAt: null, priorityRank: null },
    'd2': { id: 'd2', userId: '2', clerkship: 'EMED 301A', fromPeriod: '2A', fromYear: 1, toPeriod: '1A', toYear: 1, createdAt: null, priorityRank: null },
    'd3': { id: 'd3', userId: '3', clerkship: 'FAMMED 301A', fromPeriod: '3A', fromYear: 1, toPeriod: '4A', toYear: 1, createdAt: null, priorityRank: null },
    'd4': { id: 'd4', userId: '4', clerkship: 'FAMMED 301A', fromPeriod: '4A', fromYear: 1, toPeriod: '3A', toYear: 1, createdAt: null, priorityRank: null }
  };
  const cycles = [
    {
      type: 'SWAP_2',
      participantUserIds: ['1', '2'],
      desireIdsSatisfied: ['d1', 'd2'],
      moves: [
        { userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '2A', toYear: 1 },
        { userId: '2', clerkship: 'EMED 301A', fromPeriod: '2A', fromYear: 1, toPeriod: '1A', toYear: 1 }
      ]
    },
    {
      type: 'SWAP_2',
      participantUserIds: ['3', '4'],
      desireIdsSatisfied: ['d3', 'd4'],
      moves: [
        { userId: '3', clerkship: 'FAMMED 301A', fromPeriod: '3A', fromYear: 1, toPeriod: '4A', toYear: 1 },
        { userId: '4', clerkship: 'FAMMED 301A', fromPeriod: '4A', fromYear: 1, toPeriod: '3A', toYear: 1 }
      ]
    }
  ];

  const selected = await selectOptimalCycles(cycles, state, desiresById);

  assert.equal(selected.length, 2);
});

test('end-to-end: ILP picks 3-way swap over greedy free move', async () => {
  const result = await findBestBoundedSwaps(
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
        id: 'free1',
        user_id: 1,
        clerkship: 'EMED 301A',
        from_period: '1A',
        from_year: 1,
        to_period: '4A',
        to_year: 1
      },
      {
        id: 'swap1',
        user_id: 1,
        clerkship: 'EMED 301A',
        from_period: '1A',
        from_year: 1,
        to_period: '2A',
        to_year: 1
      },
      {
        id: 'swap2',
        user_id: 2,
        clerkship: 'EMED 301A',
        from_period: '2A',
        from_year: 1,
        to_period: '3A',
        to_year: 1
      },
      {
        id: 'swap3',
        user_id: 3,
        clerkship: 'EMED 301A',
        from_period: '3A',
        from_year: 1,
        to_period: '1A',
        to_year: 1
      }
    ],
    {
      'EMED 301A|4A|1': 1
    }
  );

  assert.equal(result.satisfiedDesires.length, 3);
  const swapAction = result.acceptedActions.find((a) => a.type === 'SWAP_3');
  assert.ok(swapAction, 'Should have a 3-way swap');
});

test('end-to-end: 4-way swap cycle', async () => {
  const result = await findBestBoundedSwaps(
    [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Cara' },
      { id: 4, name: 'Dan' }
    ],
    {
      1: [{ clerkship: 'EMED 301A', start_period: '1A', year: 1, is_immobile: false }],
      2: [{ clerkship: 'EMED 301A', start_period: '2A', year: 1, is_immobile: false }],
      3: [{ clerkship: 'EMED 301A', start_period: '3A', year: 1, is_immobile: false }],
      4: [{ clerkship: 'EMED 301A', start_period: '4A', year: 1, is_immobile: false }]
    },
    {},
    [
      { id: 'd1', user_id: 1, clerkship: 'EMED 301A', from_period: '1A', from_year: 1, to_period: '2A', to_year: 1 },
      { id: 'd2', user_id: 2, clerkship: 'EMED 301A', from_period: '2A', from_year: 1, to_period: '3A', to_year: 1 },
      { id: 'd3', user_id: 3, clerkship: 'EMED 301A', from_period: '3A', from_year: 1, to_period: '4A', to_year: 1 },
      { id: 'd4', user_id: 4, clerkship: 'EMED 301A', from_period: '4A', from_year: 1, to_period: '1A', to_year: 1 }
    ],
    {}
  );

  assert.equal(result.acceptedActions.length, 1);
  assert.equal(result.acceptedActions[0].type, 'SWAP_4');
  assert.equal(result.satisfiedDesires.length, 4);
  assert.equal(result.finalSchedulesByUser['1'][0].startPeriod, '2A');
  assert.equal(result.finalSchedulesByUser['2'][0].startPeriod, '3A');
  assert.equal(result.finalSchedulesByUser['3'][0].startPeriod, '4A');
  assert.equal(result.finalSchedulesByUser['4'][0].startPeriod, '1A');
});

test('end-to-end: 5-way swap cycle', async () => {
  const result = await findBestBoundedSwaps(
    [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Cara' },
      { id: 4, name: 'Dan' },
      { id: 5, name: 'Eve' }
    ],
    {
      1: [{ clerkship: 'EMED 301A', start_period: '1A', year: 1, is_immobile: false }],
      2: [{ clerkship: 'EMED 301A', start_period: '2A', year: 1, is_immobile: false }],
      3: [{ clerkship: 'EMED 301A', start_period: '3A', year: 1, is_immobile: false }],
      4: [{ clerkship: 'EMED 301A', start_period: '4A', year: 1, is_immobile: false }],
      5: [{ clerkship: 'EMED 301A', start_period: '5A', year: 1, is_immobile: false }]
    },
    {},
    [
      { id: 'd1', user_id: 1, clerkship: 'EMED 301A', from_period: '1A', from_year: 1, to_period: '2A', to_year: 1 },
      { id: 'd2', user_id: 2, clerkship: 'EMED 301A', from_period: '2A', from_year: 1, to_period: '3A', to_year: 1 },
      { id: 'd3', user_id: 3, clerkship: 'EMED 301A', from_period: '3A', from_year: 1, to_period: '4A', to_year: 1 },
      { id: 'd4', user_id: 4, clerkship: 'EMED 301A', from_period: '4A', from_year: 1, to_period: '5A', to_year: 1 },
      { id: 'd5', user_id: 5, clerkship: 'EMED 301A', from_period: '5A', from_year: 1, to_period: '1A', to_year: 1 }
    ],
    {}
  );

  assert.equal(result.acceptedActions.length, 1);
  assert.equal(result.acceptedActions[0].type, 'SWAP_5');
  assert.equal(result.satisfiedDesires.length, 5);
  assert.equal(result.finalSchedulesByUser['1'][0].startPeriod, '2A');
  assert.equal(result.finalSchedulesByUser['5'][0].startPeriod, '1A');
});

test('formatSwap uses correct type label for 4-way and 5-way swaps', async () => {
  const result = await findBestBoundedSwaps(
    [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Cara' },
      { id: 4, name: 'Dan' }
    ],
    {
      1: [{ clerkship: 'EMED 301A', start_period: '1A', year: 1, is_immobile: false }],
      2: [{ clerkship: 'EMED 301A', start_period: '2A', year: 1, is_immobile: false }],
      3: [{ clerkship: 'EMED 301A', start_period: '3A', year: 1, is_immobile: false }],
      4: [{ clerkship: 'EMED 301A', start_period: '4A', year: 1, is_immobile: false }]
    },
    {},
    [
      { id: 'd1', user_id: 1, clerkship: 'EMED 301A', from_period: '1A', from_year: 1, to_period: '2A', to_year: 1 },
      { id: 'd2', user_id: 2, clerkship: 'EMED 301A', from_period: '2A', from_year: 1, to_period: '3A', to_year: 1 },
      { id: 'd3', user_id: 3, clerkship: 'EMED 301A', from_period: '3A', from_year: 1, to_period: '4A', to_year: 1 },
      { id: 'd4', user_id: 4, clerkship: 'EMED 301A', from_period: '4A', from_year: 1, to_period: '1A', to_year: 1 }
    ],
    {}
  );

  assert.equal(result.swaps.length, 1);
  assert.equal(result.swaps[0].type, '4-Way Swap');
});

test('selectOptimalCycles returns single cycle when only one is valid', async () => {
  const state = {
    schedulesByUser: {},
    occupancyBySlot: {},
    openAvailabilityBySlot: {},
    satisfiedDesireIds: new Set()
  };
  const cycle = {
    type: 'FREE_MOVE',
    participantUserIds: ['1'],
    desireIdsSatisfied: ['d1'],
    moves: [{ userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '2A', toYear: 1 }]
  };

  const selected = await selectOptimalCycles([cycle], state, {});

  assert.equal(selected.length, 1);
  assert.equal(selected[0], cycle);
});

test('selectOptimalCycles returns empty array for zero cycles', async () => {
  const state = {
    schedulesByUser: {},
    occupancyBySlot: {},
    openAvailabilityBySlot: {},
    satisfiedDesireIds: new Set()
  };

  const selected = await selectOptimalCycles([], state, {});

  assert.equal(selected.length, 0);
});

test('selectOptimalCycles respects slot capacity limits', async () => {
  const schedulesByUser = {
    '1': [{ userId: '1', clerkship: 'EMED 301A', startPeriod: '1A', year: 1, isImmobile: false }],
    '2': [{ userId: '2', clerkship: 'EMED 301A', startPeriod: '3A', year: 1, isImmobile: false }]
  };
  const state = {
    schedulesByUser,
    occupancyBySlot: buildOccupancyBySlot(schedulesByUser),
    openAvailabilityBySlot: { 'EMED 301A|2A|1': 1 },
    satisfiedDesireIds: new Set()
  };
  const desiresById = {
    'd1': { id: 'd1', userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '2A', toYear: 1, createdAt: null, priorityRank: null },
    'd2': { id: 'd2', userId: '2', clerkship: 'EMED 301A', fromPeriod: '3A', fromYear: 1, toPeriod: '2A', toYear: 1, createdAt: null, priorityRank: null }
  };
  const cycles = [
    {
      type: 'FREE_MOVE',
      participantUserIds: ['1'],
      desireIdsSatisfied: ['d1'],
      moves: [{ userId: '1', clerkship: 'EMED 301A', fromPeriod: '1A', fromYear: 1, toPeriod: '2A', toYear: 1 }]
    },
    {
      type: 'FREE_MOVE',
      participantUserIds: ['2'],
      desireIdsSatisfied: ['d2'],
      moves: [{ userId: '2', clerkship: 'EMED 301A', fromPeriod: '3A', fromYear: 1, toPeriod: '2A', toYear: 1 }]
    }
  ];

  const selected = await selectOptimalCycles(cycles, state, desiresById);

  assert.equal(selected.length, 1);
});
