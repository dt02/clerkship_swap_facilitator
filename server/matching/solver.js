const {
  ALL_PERIODS,
  CLERKSHIPS,
  FIRST_YEAR_EQUIVALENT_YEARS,
  YEAR_BASE_OFFSETS,
  YEAR_LABELS
} = require('../clerkships');

const HALF_SLOTS_PER_YEAR = 24;
const MAX_HALF_SLOTS = YEAR_BASE_OFFSETS[2] + HALF_SLOTS_PER_YEAR;
const MAX_SWAP_SIZE = 5;
const MAX_SUPPORT_MOVES = 2;

let _highsPromise = null;
function getHighsSolver() {
  if (!_highsPromise) _highsPromise = require('highs')();
  return _highsPromise;
}

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
  const prepared = applyActionToTempSchedules(state, action, immobileByUser);
  if (!prepared.valid) {
    return prepared;
  }

  const { affectedUserIds, tempSchedulesByUser, touchedSlotKeys } = prepared;

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

function applyActionToTempSchedules(state, action, immobileByUser) {
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

  return {
    valid: true,
    tempSchedulesByUser,
    affectedUserIds,
    touchedSlotKeys
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

function buildDesireGraph(state, desires, immobileByUser) {
  const adjacency = Object.create(null);
  const freeEdges = Object.create(null);

  for (const desire of desires) {
    if (!isCurrentDesire(state, desire, immobileByUser)) {
      continue;
    }

    const userId = normalizeId(desire.userId);
    const targetKey = makeSlotKey(desire.clerkship, desire.toPeriod, desire.toYear);
    const occupants = state.occupancyBySlot[targetKey];

    if (occupants) {
      for (const occupant of occupants) {
        if (occupant === userId) continue;
        if (!adjacency[userId]) adjacency[userId] = [];
        adjacency[userId].push({ to: occupant, desire });
      }
    }

    if (Number(state.openAvailabilityBySlot[targetKey] || 0) > 0) {
      if (!freeEdges[userId]) freeEdges[userId] = [];
      freeEdges[userId].push(desire);
    }
  }

  return { adjacency, freeEdges };
}

function expandActionWithSupportMoves(baseAction, state, blockedByUser, immobileByUser, clerkshipDefinitions) {
  const validActions = [];
  const seenActionKeys = new Set();

  function search(action, depth) {
    const actionKey = canonicalActionKey(action);
    if (seenActionKeys.has(actionKey)) {
      return;
    }
    seenActionKeys.add(actionKey);

    const prepared = applyActionToTempSchedules(state, action, immobileByUser);
    if (!prepared.valid) {
      return;
    }

    const invalidUsers = [];
    for (const userId of prepared.affectedUserIds.sort(compareStrings)) {
      const validation = validateSchedule(
        prepared.tempSchedulesByUser[userId],
        blockedByUser[userId] || [],
        clerkshipDefinitions
      );

      if (!validation.valid) {
        invalidUsers.push({ userId, validation });
      }
    }

    if (invalidUsers.length === 0) {
      const simulation = simulateAction(state, action, blockedByUser, immobileByUser, clerkshipDefinitions);
      if (simulation.valid) {
        validActions.push(action);
      }
      return;
    }

    if (depth >= MAX_SUPPORT_MOVES) {
      return;
    }

    const firstInvalidUser = invalidUsers[0].userId;
    const supportMoves = enumerateSupportMovesForUser(
      firstInvalidUser,
      prepared.tempSchedulesByUser[firstInvalidUser],
      action,
      state,
      immobileByUser,
      clerkshipDefinitions
    );

    for (const supportMove of supportMoves) {
      search(
        finalizeAction({
          ...action,
          participantUserIds: distinctParticipantUserIds([...action.participantUserIds, supportMove.userId]),
          desireIdsSatisfied: [...action.desireIdsSatisfied],
          moves: [...action.moves, supportMove]
        }),
        depth + 1
      );
    }
  }

  search(baseAction, 0);
  return validActions;
}

function enumerateSupportMovesForUser(userId, schedule, action, state, immobileByUser, clerkshipDefinitions) {
  const lockedClerkships = new Set(
    (action.moves || [])
      .filter((move) => normalizeId(move.userId) === userId)
      .map((move) => move.clerkship)
  );
  const immobileClerkships = immobileByUser[userId] || new Set();
  const slotDeltas = computeSlotDeltas(action);
  const supportMovesByKey = new Map();
  const repairSpecs = [
    ...buildOverlapRepairSpecs(schedule, lockedClerkships, immobileClerkships, clerkshipDefinitions),
    ...buildYearMinimumRepairSpecs(schedule, lockedClerkships, immobileClerkships),
    ...buildPrerequisiteRepairSpecs(schedule, lockedClerkships, immobileClerkships, clerkshipDefinitions)
  ].sort(compareRepairSpecs);

  // Support moves are local same-user repairs that can restore validity after a desired action lands.
  for (const repairSpec of repairSpecs) {
    const definition = clerkshipDefinitions[repairSpec.entry.clerkship];
    if (!definition) {
      continue;
    }

    for (const year of repairSpec.targetYears) {
      for (const startPeriod of definition.validStarts?.[year] || []) {
        if (repairSpec.entry.startPeriod === startPeriod && repairSpec.entry.year === year) {
          continue;
        }

        if (!repairSpec.isAllowedTarget(startPeriod, year)) {
          continue;
        }

        if (!hasSupportMoveCapacity(repairSpec.entry.clerkship, startPeriod, year, state, slotDeltas)) {
          continue;
        }

        const move = makeMove(
          repairSpec.entry.userId,
          repairSpec.entry.clerkship,
          repairSpec.entry.startPeriod,
          repairSpec.entry.year,
          startPeriod,
          year
        );
        supportMovesByKey.set(canonicalMoveDescriptor(move), move);
      }
    }
  }

  return [...supportMovesByKey.values()].sort(compareMoves);
}

function buildOverlapRepairSpecs(schedule, lockedClerkships, immobileClerkships, clerkshipDefinitions) {
  return findOverlapRepairCandidates(
    schedule,
    lockedClerkships,
    immobileClerkships,
    clerkshipDefinitions
  ).map((entry) => ({
    type: 'OVERLAP',
    entry,
    targetYears: [0, 1, 2],
    isAllowedTarget: () => true
  }));
}

function buildYearMinimumRepairSpecs(schedule, lockedClerkships, immobileClerkships) {
  const normalizedSchedule = (schedule || []).slice().sort(compareScheduleEntries);
  const yearOneEquivalentCount = normalizedSchedule.filter((entry) => FIRST_YEAR_EQUIVALENT_YEARS.has(entry.year)).length;

  if (normalizedSchedule.length < 4 || yearOneEquivalentCount >= 4) {
    return [];
  }

  return normalizedSchedule
    .filter((entry) => entry.year === 2)
    .filter((entry) => !lockedClerkships.has(entry.clerkship))
    .filter((entry) => !immobileClerkships.has(entry.clerkship))
    .map((entry) => ({
      type: 'YEAR_ONE_MINIMUM',
      entry,
      targetYears: [0, 1],
      isAllowedTarget: (startPeriod, year) => FIRST_YEAR_EQUIVALENT_YEARS.has(year)
    }));
}

function buildPrerequisiteRepairSpecs(schedule, lockedClerkships, immobileClerkships, clerkshipDefinitions) {
  const normalizedSchedule = (schedule || []).slice().sort(compareScheduleEntries);
  const repairSpecs = [];

  for (const entry of normalizedSchedule) {
    const definition = clerkshipDefinitions[entry.clerkship];
    if (!definition?.prerequisites?.length) {
      continue;
    }

    const entryStart = globalHalfSlot(entry.startPeriod, entry.year);
    if (entryStart === -1) {
      continue;
    }

    const presentPrerequisites = [];
    const violatingPrerequisites = [];

    for (const prerequisiteClerkship of definition.prerequisites) {
      const prerequisiteEntry = findEntry(normalizedSchedule, prerequisiteClerkship);
      if (!prerequisiteEntry) {
        continue;
      }

      const occupiedHalfSlots = getOccupiedGlobalHalfSlots(
        prerequisiteClerkship,
        prerequisiteEntry.startPeriod,
        prerequisiteEntry.year,
        clerkshipDefinitions
      );
      if (!occupiedHalfSlots.length) {
        continue;
      }

      const prerequisiteEnd = Math.max(...occupiedHalfSlots);
      presentPrerequisites.push({ entry: prerequisiteEntry, end: prerequisiteEnd });

      if (prerequisiteEnd >= entryStart) {
        violatingPrerequisites.push({ entry: prerequisiteEntry, end: prerequisiteEnd });
      }
    }

    if (!violatingPrerequisites.length) {
      continue;
    }

    const latestPrerequisiteEnd = Math.max(...presentPrerequisites.map((prerequisite) => prerequisite.end));
    if (!lockedClerkships.has(entry.clerkship) && !immobileClerkships.has(entry.clerkship)) {
      repairSpecs.push({
        type: 'PREREQUISITE_DEPENDENT',
        entry,
        targetYears: [0, 1, 2],
        isAllowedTarget: (startPeriod, year) => globalHalfSlot(startPeriod, year) > latestPrerequisiteEnd
      });
    }

    for (const prerequisite of violatingPrerequisites.sort((itemA, itemB) => compareScheduleEntries(itemA.entry, itemB.entry))) {
      if (lockedClerkships.has(prerequisite.entry.clerkship) || immobileClerkships.has(prerequisite.entry.clerkship)) {
        continue;
      }

      repairSpecs.push({
        type: 'PREREQUISITE_PREREQ',
        entry: prerequisite.entry,
        targetYears: [0, 1, 2],
        isAllowedTarget: (startPeriod, year) => {
          const occupiedHalfSlots = getOccupiedGlobalHalfSlots(
            prerequisite.entry.clerkship,
            startPeriod,
            year,
            clerkshipDefinitions
          );

          return occupiedHalfSlots.length > 0 && Math.max(...occupiedHalfSlots) < entryStart;
        }
      });
    }
  }

  return repairSpecs;
}

function hasSupportMoveCapacity(clerkship, startPeriod, year, state, slotDeltas) {
  const targetKey = makeSlotKey(clerkship, startPeriod, year);
  const beforeCount = state.occupancyBySlot[targetKey]?.size || 0;
  const projectedDelta = slotDeltas[targetKey] || 0;
  const openAvailability = Number(state.openAvailabilityBySlot[targetKey] || 0);

  return beforeCount + projectedDelta + 1 <= beforeCount + openAvailability;
}

function compareRepairSpecs(specA, specB) {
  const priorityByType = {
    OVERLAP: 0,
    YEAR_ONE_MINIMUM: 1,
    PREREQUISITE_DEPENDENT: 2,
    PREREQUISITE_PREREQ: 3
  };
  const typeComparison = (priorityByType[specA.type] ?? 99) - (priorityByType[specB.type] ?? 99);
  if (typeComparison !== 0) {
    return typeComparison;
  }

  return compareScheduleEntries(specA.entry, specB.entry);
}

function canonicalMoveDescriptor(move) {
  return [
    normalizeId(move.userId),
    move.clerkship,
    `${move.fromYear}:${move.fromPeriod}`,
    `${move.toYear}:${move.toPeriod}`
  ].join(':');
}

function findOverlapRepairCandidates(schedule, lockedClerkships, immobileClerkships, clerkshipDefinitions) {
  const entriesByHalfSlot = new Map();
  const repairCandidates = [];
  const seenClerkships = new Set();

  for (const entry of schedule || []) {
    const occupiedHalfSlots = getOccupiedGlobalHalfSlots(
      entry.clerkship,
      entry.startPeriod,
      entry.year,
      clerkshipDefinitions
    );

    for (const halfSlot of occupiedHalfSlots) {
      if (!entriesByHalfSlot.has(halfSlot)) {
        entriesByHalfSlot.set(halfSlot, []);
      }
      entriesByHalfSlot.get(halfSlot).push(entry);
    }
  }

  for (const halfSlot of [...entriesByHalfSlot.keys()].sort((valueA, valueB) => valueA - valueB)) {
    const entries = entriesByHalfSlot.get(halfSlot) || [];
    if (entries.length < 2) {
      continue;
    }

    const uniqueEntries = [...new Map(entries.map((entry) => [entry.clerkship, entry])).values()]
      .sort((entryA, entryB) => compareStrings(entryA.clerkship, entryB.clerkship));

    for (const entry of uniqueEntries) {
      if (seenClerkships.has(entry.clerkship)) {
        continue;
      }
      if (lockedClerkships.has(entry.clerkship)) {
        continue;
      }
      if (immobileClerkships.has(entry.clerkship)) {
        continue;
      }

      seenClerkships.add(entry.clerkship);
      repairCandidates.push(entry);
    }
  }

  return repairCandidates;
}

function enumerateValidCycles(state, graph, blockedByUser, immobileByUser, clerkshipDefinitions) {
  const validCycles = [];
  const seen = new Set();

  for (const userId of Object.keys(graph.freeEdges).sort(compareStrings)) {
    for (const desire of graph.freeEdges[userId]) {
      const action = finalizeAction({
        type: 'FREE_MOVE',
        participantUserIds: [desire.userId],
        desireIdsSatisfied: [desire.id],
        moves: [
          makeMove(desire.userId, desire.clerkship, desire.fromPeriod, desire.fromYear, desire.toPeriod, desire.toYear)
        ]
      });

      const actionKey = canonicalActionKey(action);
      if (seen.has(actionKey)) continue;
      seen.add(actionKey);

      const supportedActions = expandActionWithSupportMoves(
        action,
        state,
        blockedByUser,
        immobileByUser,
        clerkshipDefinitions
      );
      for (const supportedAction of supportedActions) {
        validCycles.push(supportedAction);
      }
    }
  }

  const allNodes = Object.keys(graph.adjacency).sort(compareStrings);

  for (const startNode of allNodes) {
    const path = [startNode];
    const pathEdges = [];
    const visited = new Set([startNode]);

    function dfs(current) {
      const edges = graph.adjacency[current];
      if (!edges) return;

      for (const edge of edges) {
        if (edge.to === startNode && path.length >= 2) {
          const isSmallest = path.every((node) => compareStrings(startNode, node) <= 0);
          if (!isSmallest) continue;

          const cycleEdges = [...pathEdges, edge];
          const swapType = `SWAP_${path.length}`;
          const action = finalizeAction({
            type: swapType,
            participantUserIds: path.map((node) => cycleEdges.find((e) => normalizeId(e.desire.userId) === node)?.desire.userId || node),
            desireIdsSatisfied: cycleEdges.map((e) => e.desire.id),
            moves: cycleEdges.map((e) => {
              const d = e.desire;
              return makeMove(d.userId, d.clerkship, d.fromPeriod, d.fromYear, d.toPeriod, d.toYear);
            })
          });

          const actionKey = canonicalActionKey(action);
          if (seen.has(actionKey)) continue;
          seen.add(actionKey);

          const supportedActions = expandActionWithSupportMoves(
            action,
            state,
            blockedByUser,
            immobileByUser,
            clerkshipDefinitions
          );
          for (const supportedAction of supportedActions) {
            validCycles.push(supportedAction);
          }
          continue;
        }

        if (visited.has(edge.to)) continue;
        if (path.length >= MAX_SWAP_SIZE) continue;

        visited.add(edge.to);
        path.push(edge.to);
        pathEdges.push(edge);
        dfs(edge.to);
        pathEdges.pop();
        path.pop();
        visited.delete(edge.to);
      }
    }

    dfs(startNode);
  }

  return validCycles;
}

function sanitizeLPName(raw) {
  return raw.replace(/[^a-zA-Z0-9_]/g, '_');
}

function computeSlotDeltas(action) {
  const deltas = Object.create(null);

  for (const move of action.moves) {
    const fromKey = makeSlotKey(move.clerkship, move.fromPeriod, move.fromYear);
    const toKey = makeSlotKey(move.clerkship, move.toPeriod, move.toYear);
    deltas[fromKey] = (deltas[fromKey] || 0) - 1;
    deltas[toKey] = (deltas[toKey] || 0) + 1;
  }

  return deltas;
}

function buildLPModel(validCycles, state, desiresById) {
  const n = validCycles.length;

  const weights = validCycles.map((cycle) => {
    const desireMetadata = (cycle.desireIdsSatisfied || [])
      .map((desireId) => desiresById[normalizeId(desireId)])
      .filter(Boolean);

    let w = cycle.desireIdsSatisfied.length * 1000;

    for (const desire of desireMetadata) {
      const rank = normalizePriorityRank(desire.priorityRank);
      if (rank != null) {
        w += (100 - rank);
      }
    }

    for (const desire of desireMetadata) {
      const ts = normalizeCreatedAt(desire.createdAt);
      if (ts !== Number.MAX_SAFE_INTEGER) {
        const normalized = ts / (Date.now() + 1);
        w += 0.001 * (1 - normalized);
      }
    }

    const canonicalKey = canonicalActionKey(cycle);
    let hashVal = 0;
    for (let i = 0; i < canonicalKey.length; i++) {
      hashVal = ((hashVal << 5) - hashVal + canonicalKey.charCodeAt(i)) | 0;
    }
    w += Math.abs(hashVal) * 1e-9;

    return w;
  });

  const objTerms = weights.map((w, i) => `${w} x_${i}`).join(' + ');

  const userToCycles = Object.create(null);
  for (let i = 0; i < n; i++) {
    for (const uid of validCycles[i].participantUserIds) {
      const key = normalizeId(uid);
      if (!userToCycles[key]) userToCycles[key] = [];
      userToCycles[key].push(i);
    }
  }

  const constraintLines = [];
  for (const userId of Object.keys(userToCycles).sort(compareStrings)) {
    const indices = userToCycles[userId];
    const terms = indices.map((i) => `x_${i}`).join(' + ');
    constraintLines.push(` user_${sanitizeLPName(userId)}: ${terms} <= 1`);
  }

  const slotToCycles = Object.create(null);
  const slotDeltas = validCycles.map((cycle) => computeSlotDeltas(cycle));

  for (let i = 0; i < n; i++) {
    for (const [slotKey, delta] of Object.entries(slotDeltas[i])) {
      if (delta > 0) {
        if (!slotToCycles[slotKey]) slotToCycles[slotKey] = [];
        slotToCycles[slotKey].push({ index: i, delta });
      }
    }
  }

  for (const slotKey of Object.keys(slotToCycles).sort(compareStrings)) {
    const openAvailability = Number(state.openAvailabilityBySlot[slotKey] || 0);
    const entries = slotToCycles[slotKey];
    const terms = entries.map((e) => `${e.delta} x_${e.index}`).join(' + ');
    constraintLines.push(` slot_${sanitizeLPName(slotKey)}: ${terms} <= ${openAvailability}`);
  }

  const varNames = Array.from({ length: n }, (_, i) => `x_${i}`).join(' ');

  const lp = [
    'Maximize',
    ` obj: ${objTerms}`,
    'Subject To',
    ...constraintLines,
    'Binary',
    ` ${varNames}`,
    'End'
  ].join('\n');

  return lp;
}

async function selectOptimalCycles(validCycles, state, desiresById) {
  if (validCycles.length === 0) return [];
  if (validCycles.length === 1) return [validCycles[0]];

  const lpString = buildLPModel(validCycles, state, desiresById);
  const highs = await getHighsSolver();
  const solution = highs.solve(lpString);

  if (solution.Status === 'Optimal') {
    const selected = [];
    for (let i = 0; i < validCycles.length; i++) {
      const col = solution.Columns[`x_${i}`];
      if (col && col.Primal >= 0.5) {
        selected.push(validCycles[i]);
      }
    }
    selected.sort((a, b) => compareActions(a, b, desiresById));
    return selected;
  }

  throw new Error(`Matching optimization failed with status: ${solution.Status}`);
}

async function findBestBoundedSwaps(users, schedulesByUser, blockedByUser, desires, openAvailabilityBySlot) {
  const clerkshipDefinitions = buildClerkshipDefinitions();
  const normalizedUsers = normalizeUsers(users);
  const normalizedSchedulesByUser = normalizeSchedulesByUser(schedulesByUser);
  const normalizedBlockedByUser = normalizeBlockedByUser(blockedByUser);
  const normalizedDesires = normalizeDesires(desires);
  const normalizedAvailability = normalizeAvailability(openAvailabilityBySlot);
  const desiresById = Object.fromEntries(
    normalizedDesires.map((desire) => [normalizeId(desire.id), desire])
  );
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

  const graph = buildDesireGraph(state, normalizedDesires, immobileByUser);
  const validCycles = enumerateValidCycles(state, graph, normalizedBlockedByUser, immobileByUser, clerkshipDefinitions);
  const selectedCycles = await selectOptimalCycles(validCycles, state, desiresById);

  for (const action of selectedCycles) {
    commitAction(state, action);
    acceptedActions.push(action);
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

async function findSwaps(users, schedulesByUser, blockedByUser, desires, openAvailabilityBySlot) {
  return findBestBoundedSwaps(users, schedulesByUser, blockedByUser, desires, openAvailabilityBySlot);
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
    type: `${action.participantUserIds.length}-Way Swap`,
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


function finalizeAction(action) {
  return {
    ...action,
    participantUserIds: [...(action.participantUserIds || [])].sort(compareIds),
    desireIdsSatisfied: [...(action.desireIdsSatisfied || [])].sort(compareIds),
    moves: [...(action.moves || [])].sort(compareMoves)
  };
}

function distinctParticipantUserIds(userIds) {
  return [...new Set((userIds || []).map(normalizeId))].sort(compareStrings);
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
  schedule.sort(compareScheduleEntries);
}

function compareScheduleEntries(entryA, entryB) {
  if (entryA.year !== entryB.year) {
    return entryA.year - entryB.year;
  }

  const startComparison = periodLabelToHalfSlotIndex(entryA.startPeriod) - periodLabelToHalfSlotIndex(entryB.startPeriod);
  if (startComparison !== 0) {
    return startComparison;
  }

  return compareStrings(entryA.clerkship, entryB.clerkship);
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
  buildClerkshipDefinitions,
  buildDesireGraph,
  enumerateValidCycles,
  buildLPModel,
  selectOptimalCycles
};
