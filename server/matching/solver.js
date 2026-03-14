const {
  ALL_PERIODS,
  CLERKSHIPS,
  FIRST_YEAR_EQUIVALENT_YEARS,
  YEAR_BASE_OFFSETS,
  YEAR_LABELS
} = require('../clerkships');

const HALF_SLOTS_PER_YEAR = 24;
const MAX_HALF_SLOTS = YEAR_BASE_OFFSETS[2] + HALF_SLOTS_PER_YEAR;
const MAX_SWAP_SIZE = 3;

function buildClerkshipDefinitions() {
  return Object.fromEntries(
    Object.entries(CLERKSHIPS).map(([code, definition]) => [
      code,
      {
        ...definition,
        validStarts: {
          0: [...(definition.validStarts?.[0] || [])],
          1: [...(definition.validStarts?.[1] || [])],
          2: [...(definition.validStarts?.[2] || [])]
        },
        prerequisites: [...(definition.prerequisites || [])]
      }
    ])
  );
}

function periodLabelToHalfSlotIndex(periodLabel) {
  return ALL_PERIODS.indexOf(periodLabel);
}

function globalHalfSlot(periodLabel, year) {
  const periodIndex = periodLabelToHalfSlotIndex(periodLabel);
  const normalizedYear = Number(year);
  const yearOffset = YEAR_BASE_OFFSETS[normalizedYear];

  if (periodIndex === -1 || yearOffset === undefined) {
    return -1;
  }

  return periodIndex + yearOffset;
}

function getOccupiedGlobalHalfSlots(clerkshipCode, startPeriod, year, clerkshipDefinitions) {
  const definition = clerkshipDefinitions[clerkshipCode];
  const start = globalHalfSlot(startPeriod, year);

  if (!definition || start === -1) {
    return [];
  }

  return Array.from({ length: definition.subPeriods }, (_, offset) => start + offset);
}

function makeSlotKey(clerkship, startPeriod, year) {
  return `${clerkship}|${startPeriod}|${year}`;
}

function findEntry(schedule, clerkship) {
  return (schedule || []).find((entry) => entry.clerkship === clerkship) || null;
}

function buildOccupancyBySlot(schedulesByUser) {
  const occupancyBySlot = Object.create(null);

  for (const [userId, schedule] of Object.entries(schedulesByUser || {})) {
    for (const entry of schedule || []) {
      const slotKey = makeSlotKey(entry.clerkship, entry.startPeriod, entry.year);
      if (!occupancyBySlot[slotKey]) {
        occupancyBySlot[slotKey] = new Set();
      }
      occupancyBySlot[slotKey].add(normalizeId(entry.userId != null ? entry.userId : userId));
    }
  }

  return occupancyBySlot;
}

function validateSchedule(scheduleEntries, blockedPeriods, clerkshipDefinitions) {
  const errors = [];
  const normalizedEntries = (scheduleEntries || []).map((entry) => normalizeScheduleEntry(entry, entry.userId));
  const normalizedBlocked = (blockedPeriods || []).map(normalizeBlockedPeriod);
  const occupiedByHalfSlot = new Map();
  const blockedHalfSlots = new Set(
    normalizedBlocked
      .map((blocked) => globalHalfSlot(blocked.period, blocked.year))
      .filter((value) => value >= 0)
  );

  for (const entry of normalizedEntries) {
    const definition = clerkshipDefinitions[entry.clerkship];

    if (!definition) {
      errors.push(`Unknown clerkship ${entry.clerkship}.`);
      continue;
    }

    if (!definition.validStarts?.[entry.year]?.includes(entry.startPeriod)) {
      errors.push(`${entry.clerkship} cannot start at ${entry.startPeriod} in year ${entry.year}.`);
    }

    const occupiedHalfSlots = getOccupiedGlobalHalfSlots(
      entry.clerkship,
      entry.startPeriod,
      entry.year,
      clerkshipDefinitions
    );

    if (occupiedHalfSlots.length !== definition.subPeriods || occupiedHalfSlots.some((slot) => slot < 0 || slot >= MAX_HALF_SLOTS)) {
      errors.push(`${entry.clerkship} has an invalid occupied range starting at ${entry.startPeriod} in year ${entry.year}.`);
      continue;
    }

    for (const halfSlot of occupiedHalfSlots) {
      if (occupiedByHalfSlot.has(halfSlot)) {
        const conflictingClerkship = occupiedByHalfSlot.get(halfSlot);
        errors.push(`${entry.clerkship} overlaps ${conflictingClerkship}.`);
      } else {
        occupiedByHalfSlot.set(halfSlot, entry.clerkship);
      }

      if (blockedHalfSlots.has(halfSlot)) {
        errors.push(`${entry.clerkship} overlaps blocked period ${periodLabelFromGlobalHalfSlot(halfSlot)} in year ${entry.year}.`);
      }
    }
  }

  if (normalizedEntries.length >= 4) {
    const yearOneStarts = normalizedEntries.filter((entry) => FIRST_YEAR_EQUIVALENT_YEARS.has(entry.year)).length;
    if (yearOneStarts < 4) {
      errors.push(`Schedule has ${yearOneStarts} clerkships in the year 0/1 window; at least 4 are required.`);
    }
  }

  for (const entry of normalizedEntries) {
    const definition = clerkshipDefinitions[entry.clerkship];
    if (!definition?.prerequisites?.length) {
      continue;
    }

    const entryStart = globalHalfSlot(entry.startPeriod, entry.year);
    if (entryStart === -1) {
      continue;
    }

    for (const prerequisiteClerkship of definition.prerequisites) {
      const prerequisiteEntry = findEntry(normalizedEntries, prerequisiteClerkship);
      if (!prerequisiteEntry) {
        continue;
      }

      const prerequisiteHalfSlots = getOccupiedGlobalHalfSlots(
        prerequisiteClerkship,
        prerequisiteEntry.startPeriod,
        prerequisiteEntry.year,
        clerkshipDefinitions
      );
      const prerequisiteEnd = Math.max(...prerequisiteHalfSlots);

      if (prerequisiteEnd >= entryStart) {
        errors.push(`${entry.clerkship} must start after ${prerequisiteClerkship} ends.`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

function simulateAction(state, action, blockedByUser, immobileByUser, clerkshipDefinitions) {
  const tempSchedulesByUser = Object.create(null);
  const touchedSlotKeys = new Set();
  const affectedUserIds = uniqueStrings(action.moves.map((move) => normalizeId(move.userId)));

  for (const userId of affectedUserIds) {
    tempSchedulesByUser[userId] = (state.schedulesByUser[userId] || []).map(cloneScheduleEntry);
  }

  for (const move of action.moves) {
    const userId = normalizeId(move.userId);
    const schedule = tempSchedulesByUser[userId];
    const immobileClerkships = immobileByUser[userId] || new Set();

    if (immobileClerkships.has(move.clerkship)) {
      return {
        valid: false,
        reason: `${move.clerkship} is immobile for user ${userId}.`
      };
    }

    if (!schedule) {
      return {
        valid: false,
        reason: `No schedule found for user ${userId}.`
      };
    }

    const entryIndex = schedule.findIndex((entry) => entry.clerkship === move.clerkship);
    if (entryIndex === -1) {
      return {
        valid: false,
        reason: `${move.clerkship} was not found in user ${userId}'s schedule.`
      };
    }

    const currentEntry = schedule[entryIndex];
    if (currentEntry.startPeriod !== move.fromPeriod || currentEntry.year !== move.fromYear) {
      return {
        valid: false,
        reason: `${move.clerkship} is no longer at ${move.fromPeriod} year ${move.fromYear} for user ${userId}.`
      };
    }

    schedule[entryIndex] = {
      ...currentEntry,
      startPeriod: move.toPeriod,
      year: move.toYear
    };

    touchedSlotKeys.add(makeSlotKey(move.clerkship, move.fromPeriod, move.fromYear));
    touchedSlotKeys.add(makeSlotKey(move.clerkship, move.toPeriod, move.toYear));
  }

  for (const userId of affectedUserIds) {
    sortSchedule(tempSchedulesByUser[userId]);

    const validation = validateSchedule(
      tempSchedulesByUser[userId],
      blockedByUser[userId] || [],
      clerkshipDefinitions
    );

    if (!validation.valid) {
      return {
        valid: false,
        reason: `Schedule validation failed for user ${userId}.`,
        errors: validation.errors
      };
    }
  }

  const beforeCounts = Object.create(null);
  const afterCounts = Object.create(null);

  for (const slotKey of touchedSlotKeys) {
    const before = state.occupancyBySlot[slotKey]?.size || 0;
    beforeCounts[slotKey] = before;
    afterCounts[slotKey] = before;
  }

  for (const move of action.moves) {
    const fromKey = makeSlotKey(move.clerkship, move.fromPeriod, move.fromYear);
    const toKey = makeSlotKey(move.clerkship, move.toPeriod, move.toYear);
    afterCounts[fromKey] -= 1;
    afterCounts[toKey] += 1;
  }

  for (const slotKey of touchedSlotKeys) {
    const beforeCount = beforeCounts[slotKey];
    const afterCount = afterCounts[slotKey];
    const openAvailability = Number(state.openAvailabilityBySlot[slotKey] || 0);

    if (afterCount < 0) {
      return {
        valid: false,
        reason: `Negative occupancy detected for ${slotKey}.`
      };
    }

    if (afterCount > beforeCount + openAvailability) {
      return {
        valid: false,
        reason: `Capacity exceeded for ${slotKey}.`
      };
    }
  }

  return {
    valid: true,
    tempSchedulesByUser,
    touchedSlotKeys: Array.from(touchedSlotKeys).sort(),
    beforeCounts,
    afterCounts
  };
}

function commitAction(state, action) {
  for (const move of action.moves) {
    const userId = normalizeId(move.userId);
    const schedule = state.schedulesByUser[userId] || [];
    const entryIndex = schedule.findIndex((entry) => entry.clerkship === move.clerkship);

    if (entryIndex === -1) {
      throw new Error(`Cannot commit move: ${move.clerkship} is missing for user ${userId}.`);
    }

    schedule[entryIndex] = {
      ...schedule[entryIndex],
      startPeriod: move.toPeriod,
      year: move.toYear
    };

    sortSchedule(schedule);

    const fromKey = makeSlotKey(move.clerkship, move.fromPeriod, move.fromYear);
    const toKey = makeSlotKey(move.clerkship, move.toPeriod, move.toYear);
    state.openAvailabilityBySlot[fromKey] = Number(state.openAvailabilityBySlot[fromKey] || 0) + 1;
    state.openAvailabilityBySlot[toKey] = Number(state.openAvailabilityBySlot[toKey] || 0) - 1;
  }

  state.occupancyBySlot = buildOccupancyBySlot(state.schedulesByUser);

  for (const desireId of action.desireIdsSatisfied) {
    state.satisfiedDesireIds.add(normalizeId(desireId));
  }
}

function canonicalActionKey(action) {
  const participantIds = [...(action.participantUserIds || [])]
    .map(normalizeId)
    .sort(compareStrings)
    .join(',');
  const desireIds = [...(action.desireIdsSatisfied || [])]
    .map(normalizeId)
    .sort(compareStrings)
    .join(',');
  const moveDescriptors = [...(action.moves || [])]
    .map((move) => [
      normalizeId(move.userId),
      move.clerkship,
      `${move.fromYear}:${move.fromPeriod}`,
      `${move.toYear}:${move.toPeriod}`
    ].join(':'))
    .sort(compareStrings)
    .join('|');

  return `${action.type}|users=${participantIds}|desires=${desireIds}|moves=${moveDescriptors}`;
}

function scoreAction(action, desiresById) {
  const desireMetadata = (action.desireIdsSatisfied || [])
    .map((desireId) => desiresById[normalizeId(desireId)])
    .filter(Boolean)
    .sort(compareDesiresDeterministically);

  const createdAtValues = desireMetadata.map((desire) => normalizeCreatedAt(desire.createdAt));
  const priorityRanks = desireMetadata.map((desire) => normalizePriorityRank(desire.priorityRank) ?? Number.MAX_SAFE_INTEGER);
  const numericPriorityRanks = priorityRanks.filter((rank) => rank !== Number.MAX_SAFE_INTEGER);

  return {
    satisfiedCount: action.desireIdsSatisfied.length,
    participantCount: action.participantUserIds.length,
    priorityRanks,
    createdAtValues,
    hasPriorityRanks: numericPriorityRanks.length > 0,
    priorityRankSum: numericPriorityRanks.reduce((sum, rank) => sum + rank, 0),
    canonicalKey: canonicalActionKey(action)
  };
}

function compareActions(actionA, actionB, desiresById) {
  const scoreA = scoreAction(actionA, desiresById);
  const scoreB = scoreAction(actionB, desiresById);

  if (scoreA.satisfiedCount !== scoreB.satisfiedCount) {
    return scoreB.satisfiedCount - scoreA.satisfiedCount;
  }

  if (scoreA.participantCount !== scoreB.participantCount) {
    return scoreA.participantCount - scoreB.participantCount;
  }

  const priorityRankComparison = compareNumericArrays(scoreA.priorityRanks, scoreB.priorityRanks);
  if (priorityRankComparison !== 0) {
    return priorityRankComparison;
  }

  const createdAtComparison = compareNumericArrays(scoreA.createdAtValues, scoreB.createdAtValues);
  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  if (scoreA.hasPriorityRanks && scoreB.hasPriorityRanks && scoreA.priorityRankSum !== scoreB.priorityRankSum) {
    return scoreA.priorityRankSum - scoreB.priorityRankSum;
  }

  return compareStrings(scoreA.canonicalKey, scoreB.canonicalKey);
}

function findBestBoundedSwaps(users, schedulesByUser, blockedByUser, desires, openAvailabilityBySlot) {
  const clerkshipDefinitions = buildClerkshipDefinitions();
  const normalizedUsers = normalizeUsers(users);
  const normalizedSchedulesByUser = normalizeSchedulesByUser(schedulesByUser);
  const normalizedBlockedByUser = normalizeBlockedByUser(blockedByUser);
  const normalizedDesires = normalizeDesires(desires);
  const normalizedAvailability = normalizeAvailability(openAvailabilityBySlot);
  const desiresById = Object.fromEntries(
    normalizedDesires.map((desire) => [normalizeId(desire.id), desire])
  );
  const desiresByUser = groupDesiresByUser(normalizedDesires);
  const initialErrors = validateStartingSchedules(
    normalizedSchedulesByUser,
    normalizedBlockedByUser,
    clerkshipDefinitions
  );

  if (initialErrors.length > 0) {
    return buildResult({
      usersById: normalizedUsers,
      acceptedActions: [],
      schedulesByUser: normalizedSchedulesByUser,
      blockedByUser: normalizedBlockedByUser,
      satisfiedDesires: [],
      unmetDesires: normalizedDesires,
      totalDesires: normalizedDesires.length,
      errors: initialErrors,
      validationDiagnostics: buildValidationDiagnostics(
        normalizedUsers,
        normalizedSchedulesByUser,
        normalizedBlockedByUser,
        clerkshipDefinitions
      )
    });
  }

  const state = {
    schedulesByUser: cloneSchedulesByUser(normalizedSchedulesByUser),
    openAvailabilityBySlot: { ...normalizedAvailability },
    occupancyBySlot: buildOccupancyBySlot(normalizedSchedulesByUser),
    satisfiedDesireIds: new Set()
  };
  const immobileByUser = buildImmobileByUser(state.schedulesByUser);
  const acceptedActions = [];

  while (true) {
    const freeMoves = generateFreeMoveCandidates(
      state,
      normalizedDesires,
      normalizedBlockedByUser,
      immobileByUser,
      clerkshipDefinitions
    );
    const twoWaySwaps = generateTwoWaySwapCandidates(
      state,
      normalizedDesires,
      desiresByUser,
      immobileByUser,
      normalizedBlockedByUser,
      clerkshipDefinitions
    );
    const threeWaySwaps = generateThreeWaySwapCandidates(
      state,
      normalizedDesires,
      desiresByUser,
      immobileByUser,
      normalizedBlockedByUser,
      clerkshipDefinitions
    );
    const candidates = [...freeMoves, ...twoWaySwaps, ...threeWaySwaps];

    if (candidates.length === 0) {
      break;
    }

    candidates.sort((actionA, actionB) => compareActions(actionA, actionB, desiresById));

    const bestAction = candidates[0];
    commitAction(state, bestAction);
    acceptedActions.push(bestAction);
  }

  const satisfiedDesires = normalizedDesires.filter((desire) => state.satisfiedDesireIds.has(normalizeId(desire.id)));
  const unmetDesires = normalizedDesires.filter((desire) => !state.satisfiedDesireIds.has(normalizeId(desire.id)));

  return buildResult({
    usersById: normalizedUsers,
    acceptedActions,
    schedulesByUser: state.schedulesByUser,
    blockedByUser: normalizedBlockedByUser,
    satisfiedDesires,
    unmetDesires,
    totalDesires: normalizedDesires.length,
    errors: [],
    validationDiagnostics: []
  });
}

function findSwaps(users, schedulesByUser, blockedByUser, desires, openAvailabilityBySlot) {
  return findBestBoundedSwaps(users, schedulesByUser, blockedByUser, desires, openAvailabilityBySlot);
}

function generateFreeMoveCandidates(state, desires, blockedByUser, immobileByUser, clerkshipDefinitions) {
  const candidates = [];

  for (const desire of getCurrentDesires(state, desires, immobileByUser)) {
    const targetKey = makeSlotKey(desire.clerkship, desire.toPeriod, desire.toYear);
    if (Number(state.openAvailabilityBySlot[targetKey] || 0) <= 0) {
      continue;
    }

    const action = finalizeAction({
      type: 'FREE_MOVE',
      participantUserIds: [desire.userId],
      desireIdsSatisfied: [desire.id],
      moves: [
        makeMove(
          desire.userId,
          desire.clerkship,
          desire.fromPeriod,
          desire.fromYear,
          desire.toPeriod,
          desire.toYear
        )
      ]
    });

    const simulation = simulateAction(state, action, blockedByUser, immobileByUser, clerkshipDefinitions);
    if (simulation.valid) {
      candidates.push(action);
    }
  }

  return candidates;
}

function generateTwoWaySwapCandidates(state, desires, desiresByUser, immobileByUser, blockedByUser, clerkshipDefinitions) {
  const candidates = [];
  const seen = new Set();

  for (const desireA of getCurrentDesires(state, desires, immobileByUser)) {
    const targetOccupants = sortedOccupants(state.occupancyBySlot[makeSlotKey(desireA.clerkship, desireA.toPeriod, desireA.toYear)]);

    for (const userB of targetOccupants) {
      if (userB === normalizeId(desireA.userId)) {
        continue;
      }

      for (const desireB of desiresByUser[userB] || []) {
        if (!isCurrentDesire(state, desireB, immobileByUser)) {
          continue;
        }

        const targetForB = makeSlotKey(desireB.clerkship, desireB.toPeriod, desireB.toYear);
        if (!state.occupancyBySlot[targetForB]?.has(normalizeId(desireA.userId))) {
          continue;
        }

        const action = finalizeAction({
          type: 'SWAP_2',
          participantUserIds: [desireA.userId, desireB.userId],
          desireIdsSatisfied: [desireA.id, desireB.id],
          moves: [
            makeMove(
              desireA.userId,
              desireA.clerkship,
              desireA.fromPeriod,
              desireA.fromYear,
              desireA.toPeriod,
              desireA.toYear
            ),
            makeMove(
              desireB.userId,
              desireB.clerkship,
              desireB.fromPeriod,
              desireB.fromYear,
              desireB.toPeriod,
              desireB.toYear
            )
          ]
        });

        const actionKey = canonicalActionKey(action);
        if (seen.has(actionKey)) {
          continue;
        }

        seen.add(actionKey);

        const simulation = simulateAction(state, action, blockedByUser, immobileByUser, clerkshipDefinitions);
        if (simulation.valid) {
          candidates.push(action);
        }
      }
    }
  }

  return candidates;
}

function generateThreeWaySwapCandidates(state, desires, desiresByUser, immobileByUser, blockedByUser, clerkshipDefinitions) {
  const candidates = [];
  const seen = new Set();

  for (const desireA of getCurrentDesires(state, desires, immobileByUser)) {
    const occupantsB = sortedOccupants(state.occupancyBySlot[makeSlotKey(desireA.clerkship, desireA.toPeriod, desireA.toYear)]);

    for (const userB of occupantsB) {
      if (userB === normalizeId(desireA.userId)) {
        continue;
      }

      for (const desireB of desiresByUser[userB] || []) {
        if (!isCurrentDesire(state, desireB, immobileByUser)) {
          continue;
        }

        const occupantsC = sortedOccupants(state.occupancyBySlot[makeSlotKey(desireB.clerkship, desireB.toPeriod, desireB.toYear)]);

        for (const userC of occupantsC) {
          if ([normalizeId(desireA.userId), normalizeId(desireB.userId)].includes(userC)) {
            continue;
          }

          for (const desireC of desiresByUser[userC] || []) {
            if (!isCurrentDesire(state, desireC, immobileByUser)) {
              continue;
            }

            const targetForC = makeSlotKey(desireC.clerkship, desireC.toPeriod, desireC.toYear);
            if (!state.occupancyBySlot[targetForC]?.has(normalizeId(desireA.userId))) {
              continue;
            }

            const participants = uniqueByValue([desireA.userId, desireB.userId, desireC.userId]);
            if (participants.length !== MAX_SWAP_SIZE) {
              continue;
            }

            const action = finalizeAction({
              type: 'SWAP_3',
              participantUserIds: participants,
              desireIdsSatisfied: [desireA.id, desireB.id, desireC.id],
              moves: [
                makeMove(
                  desireA.userId,
                  desireA.clerkship,
                  desireA.fromPeriod,
                  desireA.fromYear,
                  desireA.toPeriod,
                  desireA.toYear
                ),
                makeMove(
                  desireB.userId,
                  desireB.clerkship,
                  desireB.fromPeriod,
                  desireB.fromYear,
                  desireB.toPeriod,
                  desireB.toYear
                ),
                makeMove(
                  desireC.userId,
                  desireC.clerkship,
                  desireC.fromPeriod,
                  desireC.fromYear,
                  desireC.toPeriod,
                  desireC.toYear
                )
              ]
            });

            const actionKey = canonicalActionKey(action);
            if (seen.has(actionKey)) {
              continue;
            }

            seen.add(actionKey);

            const simulation = simulateAction(state, action, blockedByUser, immobileByUser, clerkshipDefinitions);
            if (simulation.valid) {
              candidates.push(action);
            }
          }
        }
      }
    }
  }

  return candidates;
}

function getCurrentDesires(state, desires, immobileByUser) {
  return [...(desires || [])]
    .filter((desire) => isCurrentDesire(state, desire, immobileByUser))
    .sort(compareDesiresDeterministically);
}

function isCurrentDesire(state, desire, immobileByUser) {
  const desireId = normalizeId(desire.id);
  const userId = normalizeId(desire.userId);

  if (state.satisfiedDesireIds.has(desireId)) {
    return false;
  }

  if (immobileByUser[userId]?.has(desire.clerkship)) {
    return false;
  }

  const entry = findEntry(state.schedulesByUser[userId], desire.clerkship);
  if (!entry) {
    return false;
  }

  if (entry.startPeriod !== desire.fromPeriod || entry.year !== desire.fromYear) {
    return false;
  }

  if (desire.fromPeriod === desire.toPeriod && desire.fromYear === desire.toYear) {
    return false;
  }

  return true;
}

function buildResult({
  usersById,
  acceptedActions,
  schedulesByUser,
  blockedByUser,
  satisfiedDesires,
  unmetDesires,
  totalDesires,
  errors,
  validationDiagnostics
}) {
  const freeMoves = acceptedActions
    .filter((action) => action.type === 'FREE_MOVE')
    .map((action) => formatFreeMove(action, usersById));
  const swaps = acceptedActions
    .filter((action) => action.type !== 'FREE_MOVE')
    .map((action) => formatSwap(action, usersById));
  const unmet = unmetDesires.map((desire) => formatDesireForDisplay(desire, usersById));

  return {
    acceptedActions,
    finalSchedulesByUser: cloneSchedulesByUser(schedulesByUser),
    satisfiedDesires,
    unmetDesires,
    freeMoves,
    swaps,
    unmet,
    summary: {
      totalDesires,
      freeMoves: freeMoves.length,
      swaps: swaps.length,
      unmet: unmet.length
    },
    errors,
    validationDiagnostics: validationDiagnostics || []
  };
}

function formatFreeMove(action, usersById) {
  const move = action.moves[0];
  const user = usersById[normalizeId(move.userId)];

  return {
    userId: move.userId,
    userName: user?.name || `User ${move.userId}`,
    clerkship: move.clerkship,
    from: formatPeriodYear(move.fromPeriod, move.fromYear),
    to: formatPeriodYear(move.toPeriod, move.toYear)
  };
}

function formatSwap(action, usersById) {
  return {
    type: action.type === 'SWAP_2' ? '2-Way Swap' : '3-Way Swap',
    participants: action.moves.map((move) => {
      const user = usersById[normalizeId(move.userId)];
      return {
        userId: move.userId,
        userName: user?.name || `User ${move.userId}`,
        clerkship: move.clerkship,
        from: formatPeriodYear(move.fromPeriod, move.fromYear),
        to: formatPeriodYear(move.toPeriod, move.toYear)
      };
    })
  };
}

function formatDesireForDisplay(desire, usersById) {
  const user = usersById[normalizeId(desire.userId)];

  return {
    id: desire.id,
    userId: desire.userId,
    userName: user?.name || `User ${desire.userId}`,
    clerkship: desire.clerkship,
    from: formatPeriodYear(desire.fromPeriod, desire.fromYear),
    to: formatPeriodYear(desire.toPeriod, desire.toYear)
  };
}

function formatScheduleEntryForDisplay(entry) {
  return {
    clerkship: entry.clerkship,
    start: formatPeriodYear(entry.startPeriod, entry.year),
    isImmobile: Boolean(entry.isImmobile)
  };
}

function buildValidationDiagnostics(usersById, schedulesByUser, blockedByUser, clerkshipDefinitions) {
  const diagnostics = [];

  for (const userId of Object.keys(schedulesByUser).sort(compareStrings)) {
    const schedule = schedulesByUser[userId] || [];
    const blockedPeriods = blockedByUser[userId] || [];
    const validation = validateSchedule(schedule, blockedPeriods, clerkshipDefinitions);

    if (!validation.errors.length) {
      continue;
    }

    const user = usersById[userId];
    diagnostics.push({
      userId: user?.id ?? userId,
      userName: user?.name || `User ${userId}`,
      email: user?.email || '',
      errors: validation.errors,
      schedule: schedule.map(formatScheduleEntryForDisplay),
      blockedPeriods: blockedPeriods
        .map((blockedPeriod) => formatPeriodYear(blockedPeriod.period, blockedPeriod.year))
        .sort(compareStrings)
    });
  }

  return diagnostics;
}

function validateStartingSchedules(schedulesByUser, blockedByUser, clerkshipDefinitions) {
  const errors = [];

  for (const userId of Object.keys(schedulesByUser).sort(compareStrings)) {
    const validation = validateSchedule(
      schedulesByUser[userId],
      blockedByUser[userId] || [],
      clerkshipDefinitions
    );

    for (const error of validation.errors) {
      errors.push(`User ${userId}: ${error}`);
    }
  }

  return errors;
}

function normalizeUsers(users) {
  return Object.fromEntries(
    (users || []).map((user) => {
      const userId = normalizeId(user.id);
      return [
        userId,
        {
          id: user.id,
          name: user.name || `User ${user.id}`,
          email: user.email || '',
          isAdmin: Boolean(user.is_admin ?? user.isAdmin)
        }
      ];
    })
  );
}

function normalizeSchedulesByUser(schedulesByUser) {
  const normalized = Object.create(null);

  for (const [userId, schedule] of Object.entries(schedulesByUser || {})) {
    const userKey = normalizeId(userId);
    normalized[userKey] = (schedule || []).map((entry) => normalizeScheduleEntry(entry, userId));
    sortSchedule(normalized[userKey]);
  }

  return normalized;
}

function normalizeBlockedByUser(blockedByUser) {
  const normalized = Object.create(null);

  for (const [userId, blockedPeriods] of Object.entries(blockedByUser || {})) {
    normalized[normalizeId(userId)] = (blockedPeriods || []).map(normalizeBlockedPeriod);
  }

  return normalized;
}

function normalizeDesires(desires) {
  return (desires || []).map((desire, index) => normalizeDesire(desire, index)).sort(compareDesiresDeterministically);
}

function normalizeAvailability(openAvailabilityBySlot) {
  return Object.fromEntries(
    Object.entries(openAvailabilityBySlot || {}).map(([slotKey, spots]) => [slotKey, Number(spots || 0)])
  );
}

function normalizeScheduleEntry(entry, fallbackUserId) {
  return {
    id: entry.id,
    userId: entry.userId ?? entry.user_id ?? fallbackUserId,
    clerkship: entry.clerkship,
    startPeriod: entry.startPeriod ?? entry.start_period,
    year: Number(entry.year),
    isImmobile: Boolean(entry.isImmobile ?? entry.is_immobile)
  };
}

function normalizeBlockedPeriod(blockedPeriod) {
  return {
    period: blockedPeriod.period,
    year: Number(blockedPeriod.year)
  };
}

function normalizeDesire(desire, index) {
  return {
    id: desire.id != null ? desire.id : `desire-${index}`,
    userId: desire.userId ?? desire.user_id,
    clerkship: desire.clerkship,
    fromPeriod: desire.fromPeriod ?? desire.from_period,
    fromYear: Number(desire.fromYear ?? desire.from_year),
    toPeriod: desire.toPeriod ?? desire.to_period,
    toYear: Number(desire.toYear ?? desire.to_year),
    createdAt: desire.createdAt ?? desire.created_at,
    priorityRank: desire.priorityRank ?? desire.priority_rank
  };
}

function buildImmobileByUser(schedulesByUser) {
  const immobileByUser = Object.create(null);

  for (const [userId, schedule] of Object.entries(schedulesByUser || {})) {
    immobileByUser[userId] = new Set(
      (schedule || [])
        .filter((entry) => entry.isImmobile)
        .map((entry) => entry.clerkship)
    );
  }

  return immobileByUser;
}

function groupDesiresByUser(desires) {
  const desiresByUser = Object.create(null);

  for (const desire of desires || []) {
    const userId = normalizeId(desire.userId);
    if (!desiresByUser[userId]) {
      desiresByUser[userId] = [];
    }
    desiresByUser[userId].push(desire);
  }

  for (const userId of Object.keys(desiresByUser)) {
    desiresByUser[userId].sort(compareDesiresDeterministically);
  }

  return desiresByUser;
}

function finalizeAction(action) {
  return {
    ...action,
    participantUserIds: [...(action.participantUserIds || [])].sort(compareIds),
    desireIdsSatisfied: [...(action.desireIdsSatisfied || [])].sort(compareIds),
    moves: [...(action.moves || [])].sort(compareMoves)
  };
}

function makeMove(userId, clerkship, fromPeriod, fromYear, toPeriod, toYear) {
  return {
    userId,
    clerkship,
    fromPeriod,
    fromYear,
    toPeriod,
    toYear
  };
}

function cloneSchedulesByUser(schedulesByUser) {
  const cloned = Object.create(null);

  for (const [userId, schedule] of Object.entries(schedulesByUser || {})) {
    cloned[userId] = (schedule || []).map(cloneScheduleEntry);
  }

  return cloned;
}

function cloneScheduleEntry(entry) {
  return { ...entry };
}

function sortSchedule(schedule) {
  schedule.sort((entryA, entryB) => {
    if (entryA.year !== entryB.year) {
      return entryA.year - entryB.year;
    }

    const startComparison = periodLabelToHalfSlotIndex(entryA.startPeriod) - periodLabelToHalfSlotIndex(entryB.startPeriod);
    if (startComparison !== 0) {
      return startComparison;
    }

    return compareStrings(entryA.clerkship, entryB.clerkship);
  });
}

function compareMoves(moveA, moveB) {
  const userComparison = compareIds(moveA.userId, moveB.userId);
  if (userComparison !== 0) {
    return userComparison;
  }

  const clerkshipComparison = compareStrings(moveA.clerkship, moveB.clerkship);
  if (clerkshipComparison !== 0) {
    return clerkshipComparison;
  }

  if (moveA.fromYear !== moveB.fromYear) {
    return moveA.fromYear - moveB.fromYear;
  }

  const fromPeriodComparison = periodLabelToHalfSlotIndex(moveA.fromPeriod) - periodLabelToHalfSlotIndex(moveB.fromPeriod);
  if (fromPeriodComparison !== 0) {
    return fromPeriodComparison;
  }

  if (moveA.toYear !== moveB.toYear) {
    return moveA.toYear - moveB.toYear;
  }

  return periodLabelToHalfSlotIndex(moveA.toPeriod) - periodLabelToHalfSlotIndex(moveB.toPeriod);
}

function compareDesiresDeterministically(desireA, desireB) {
  const userComparison = compareIds(desireA.userId, desireB.userId);
  if (userComparison !== 0) {
    return userComparison;
  }

  const clerkshipComparison = compareStrings(desireA.clerkship, desireB.clerkship);
  if (clerkshipComparison !== 0) {
    return clerkshipComparison;
  }

  if (desireA.fromYear !== desireB.fromYear) {
    return desireA.fromYear - desireB.fromYear;
  }

  const fromPeriodComparison = periodLabelToHalfSlotIndex(desireA.fromPeriod) - periodLabelToHalfSlotIndex(desireB.fromPeriod);
  if (fromPeriodComparison !== 0) {
    return fromPeriodComparison;
  }

  if (desireA.toYear !== desireB.toYear) {
    return desireA.toYear - desireB.toYear;
  }

  const toPeriodComparison = periodLabelToHalfSlotIndex(desireA.toPeriod) - periodLabelToHalfSlotIndex(desireB.toPeriod);
  if (toPeriodComparison !== 0) {
    return toPeriodComparison;
  }

  return compareIds(desireA.id, desireB.id);
}

function compareIds(idA, idB) {
  return compareStrings(normalizeId(idA), normalizeId(idB));
}

function compareStrings(valueA, valueB) {
  return valueA.localeCompare(valueB, 'en', { numeric: true });
}

function compareNumericArrays(valuesA, valuesB) {
  const maxLength = Math.max(valuesA.length, valuesB.length);

  for (let index = 0; index < maxLength; index += 1) {
    const valueA = valuesA[index] ?? Number.MAX_SAFE_INTEGER;
    const valueB = valuesB[index] ?? Number.MAX_SAFE_INTEGER;

    if (valueA !== valueB) {
      return valueA - valueB;
    }
  }

  return 0;
}

function normalizeCreatedAt(createdAt) {
  if (createdAt == null) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (typeof createdAt === 'number' && Number.isFinite(createdAt)) {
    return createdAt;
  }

  const timestamp = Date.parse(createdAt);
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
}

function normalizePriorityRank(priorityRank) {
  if (priorityRank == null) {
    return null;
  }

  const numericPriority = Number(priorityRank);
  return Number.isFinite(numericPriority) ? numericPriority : null;
}

function normalizeId(value) {
  return String(value);
}

function uniqueStrings(values) {
  return [...new Set(values)];
}

function uniqueByValue(values) {
  const seen = new Set();
  const result = [];

  for (const value of values) {
    const key = normalizeId(value);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }

  return result;
}

function sortedOccupants(occupants) {
  return [...(occupants || [])].sort(compareStrings);
}

function periodLabelFromGlobalHalfSlot(halfSlot) {
  if (halfSlot < YEAR_BASE_OFFSETS[1]) {
    return ALL_PERIODS[halfSlot - YEAR_BASE_OFFSETS[0]];
  }

  if (halfSlot < YEAR_BASE_OFFSETS[2]) {
    return ALL_PERIODS[halfSlot - YEAR_BASE_OFFSETS[1]];
  }

  return ALL_PERIODS[halfSlot - YEAR_BASE_OFFSETS[2]];
}

function formatPeriodYear(period, year) {
  return `${period} ${YEAR_LABELS[year] || `Year ${year}`}`;
}

module.exports = {
  periodLabelToHalfSlotIndex,
  globalHalfSlot,
  getOccupiedGlobalHalfSlots,
  makeSlotKey,
  findEntry,
  buildOccupancyBySlot,
  validateSchedule,
  simulateAction,
  commitAction,
  canonicalActionKey,
  scoreAction,
  compareActions,
  findBestBoundedSwaps,
  findSwaps,
  buildClerkshipDefinitions
};
