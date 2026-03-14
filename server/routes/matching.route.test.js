const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const dbPath = require.resolve('../db');
const authPath = require.resolve('../auth');
const routePath = require.resolve('./matching');

test('POST /api/matching/run returns a saved matching result for an admin', async () => {
  const insertedPayloads = [];
  const mockDb = createMockDb({
    sessionToken: 'admin-session',
    actingUser: { id: 99, name: 'Admin', email: 'admin@example.com', is_admin: true },
    users: [
      { id: 99, name: 'Admin', email: 'admin@example.com', is_admin: true },
      { id: 1, name: 'Alice', email: 'alice@example.com', is_admin: false }
    ],
    schedules: [
      { user_id: 1, clerkship: 'EMED 301A', start_period: '1A', year: 1, is_immobile: false }
    ],
    blocked: [],
    desires: [
      {
        id: 1001,
        user_id: 1,
        clerkship: 'EMED 301A',
        from_period: '1A',
        from_year: 1,
        to_period: '2A',
        to_year: 1
      }
    ],
    availability: [{ clerkship: 'EMED 301A', period: '2A', year: 1, spots: 1 }],
    onInsert(resultJson) {
      insertedPayloads.push(resultJson);
    }
  });

  await withMatchingApp(mockDb, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/matching/run`, {
      method: 'POST',
      headers: { 'x-session-token': 'admin-session' }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.summary.freeMoves, 1);
    assert.equal(body.summary.swaps, 0);
    assert.equal(body.acceptedActions[0].type, 'FREE_MOVE');
    assert.equal(body.freeMoves[0].userName, 'Alice');
    assert.equal(insertedPayloads.length, 1);
    assert.equal(insertedPayloads[0].summary.freeMoves, 1);
  });
});

test('POST /api/matching/run returns 400 and does not save when schedules are invalid', async () => {
  let insertCalls = 0;
  const mockDb = createMockDb({
    sessionToken: 'admin-session',
    actingUser: { id: 99, name: 'Admin', email: 'admin@example.com', is_admin: true },
    users: [
      { id: 99, name: 'Admin', email: 'admin@example.com', is_admin: true },
      { id: 1, name: 'Alice', email: 'alice@example.com', is_admin: false }
    ],
    schedules: [
      { user_id: 1, clerkship: 'SURG 300A', start_period: '5A', year: 1, is_immobile: false },
      { user_id: 1, clerkship: 'MED 300A', start_period: '1A', year: 1, is_immobile: false },
      { user_id: 1, clerkship: 'ANES 306A', start_period: '3A', year: 1, is_immobile: false }
    ],
    blocked: [],
    desires: [],
    availability: [],
    onInsert() {
      insertCalls += 1;
    }
  });

  await withMatchingApp(mockDb, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/matching/run`, {
      method: 'POST',
      headers: { 'x-session-token': 'admin-session' }
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.match(body.error, /ANES 306A must start after SURG 300A ends/i);
    assert.equal(Array.isArray(body.validationDiagnostics), true);
    assert.equal(body.validationDiagnostics.length, 1);
    assert.equal(body.validationDiagnostics[0].userName, 'Alice');
    assert.equal(body.validationDiagnostics[0].schedule.length, 3);
    assert.equal(insertCalls, 0);
  });
});

async function withMatchingApp(mockDb, runTest) {
  const originalDbModule = require.cache[dbPath];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: mockDb
  };
  delete require.cache[authPath];
  delete require.cache[routePath];

  const router = require('./matching');
  const app = express();
  app.use(express.json());
  app.use('/api/matching', router);
  app.use((error, req, res, next) => {
    res.status(500).json({ error: error.message });
  });

  const server = await listen(app);

  try {
    await runTest(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await closeServer(server);
    delete require.cache[routePath];
    delete require.cache[authPath];

    if (originalDbModule) {
      require.cache[dbPath] = originalDbModule;
    } else {
      delete require.cache[dbPath];
    }
  }
}

function createMockDb({ sessionToken, actingUser, users, schedules, blocked, desires, availability, onInsert }) {
  return {
    async query(text, params = []) {
      const normalizedText = text.replace(/\s+/g, ' ').trim();

      if (normalizedText === 'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1') {
        return { rows: actingUser && params[0] === sessionToken ? [actingUser] : [] };
      }

      if (normalizedText === 'SELECT * FROM users') {
        return { rows: users };
      }

      if (normalizedText === 'SELECT * FROM schedule_entries') {
        return { rows: schedules };
      }

      if (normalizedText === 'SELECT * FROM blocked_periods') {
        return { rows: blocked };
      }

      if (normalizedText === 'SELECT * FROM desired_moves') {
        return { rows: desires };
      }

      if (normalizedText === 'SELECT * FROM availability') {
        return { rows: availability };
      }

      if (normalizedText.includes('INSERT INTO match_results')) {
        onInsert?.(JSON.parse(params[0]));
        return { rows: [{ id: 123 }] };
      }

      throw new Error(`Unhandled query in route test: ${normalizedText}`);
    }
  };
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
