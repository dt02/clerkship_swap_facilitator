const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const dbPath = require.resolve('../db');
const authPath = require.resolve('../auth');
const routePath = require.resolve('./schedules');

test('PUT /api/users/:id/blocked removes blocked periods that overlap the current schedule', async () => {
  const mockDb = createMockDb({
    sessionToken: 'user-session',
    actingUser: { id: 8, name: 'Emily', email: 'emily@example.com', is_admin: false },
    users: [{ id: 8 }],
    schedules: [
      { id: 1, user_id: 8, clerkship: 'OBGYN 300A', start_period: '1A', year: 2, is_immobile: false }
    ],
    blocked: []
  });

  await withSchedulesApp(mockDb, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/users/8/blocked`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': 'user-session'
      },
      body: JSON.stringify({
        blocked: [
          { period: '2A', year: 2 },
          { period: '4A', year: 2 }
        ]
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, [{ period: '4A', year: 2 }]);
  });
});

test('PUT /api/users/:id/schedule removes existing blocked periods that overlap the new schedule', async () => {
  const mockDb = createMockDb({
    sessionToken: 'user-session',
    actingUser: { id: 8, name: 'Emily', email: 'emily@example.com', is_admin: false },
    users: [{ id: 8 }],
    schedules: [],
    blocked: [
      { period: '2A', year: 2 },
      { period: '4A', year: 2 }
    ]
  });

  await withSchedulesApp(mockDb, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/users/8/schedule`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': 'user-session'
      },
      body: JSON.stringify({
        entries: [
          { clerkship: 'OBGYN 300A', start_period: '1A', year: 2, is_immobile: false }
        ]
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.length, 1);
    assert.deepEqual(mockDb.getBlockedRows(), [{ period: '4A', year: 2 }]);
  });
});

test('GET /api/users/:id/blocked drops stale blocked periods that are no longer valid for year 0', async () => {
  const mockDb = createMockDb({
    sessionToken: 'user-session',
    actingUser: { id: 8, name: 'Emily', email: 'emily@example.com', is_admin: false },
    users: [{ id: 8 }],
    schedules: [],
    blocked: [
      { period: '10A', year: 0 },
      { period: '10B', year: 0 },
      { period: '11A', year: 0 }
    ]
  });

  await withSchedulesApp(mockDb, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/users/8/blocked`, {
      headers: {
        'x-session-token': 'user-session'
      }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, [{ period: '11A', year: 0 }]);
  });
});

async function withSchedulesApp(mockDb, runTest) {
  const originalDbModule = require.cache[dbPath];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: mockDb
  };
  delete require.cache[authPath];
  delete require.cache[routePath];

  const router = require('./schedules');
  const app = express();
  app.use(express.json());
  app.use('/api/users', router);
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

function createMockDb({ sessionToken, actingUser, users = [], schedules = [], blocked = [] }) {
  const scheduleRows = schedules.map((entry) => ({ ...entry }));
  const blockedRows = blocked.map((entry) => ({ ...entry }));

  const mockDb = {
    async query(text, params = []) {
      return handleQuery(text, params, sessionToken, actingUser, users, scheduleRows, blockedRows);
    },
    async withTransaction(callback) {
      return callback({
        async query(text, params = []) {
          return handleQuery(text, params, sessionToken, actingUser, users, scheduleRows, blockedRows);
        }
      });
    },
    getBlockedRows() {
      return blockedRows
        .slice()
        .sort((a, b) => a.year - b.year || a.period.localeCompare(b.period, 'en', { numeric: true }))
        .map((entry) => ({ period: entry.period, year: entry.year }));
    }
  };

  return mockDb;
}

function handleQuery(text, params, sessionToken, actingUser, users, scheduleRows, blockedRows) {
  const normalizedText = text.replace(/\s+/g, ' ').trim();

  if (normalizedText === 'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1') {
    return Promise.resolve({ rows: actingUser && params[0] === sessionToken ? [actingUser] : [] });
  }

  if (normalizedText === 'SELECT id FROM users WHERE id = $1') {
    return Promise.resolve({ rows: users.filter((user) => user.id === Number(params[0])) });
  }

  if (normalizedText === 'SELECT * FROM schedule_entries WHERE user_id = $1 ORDER BY clerkship') {
    return Promise.resolve({
      rows: scheduleRows
        .filter((entry) => entry.user_id === Number(params[0]))
        .slice()
        .sort((a, b) => a.clerkship.localeCompare(b.clerkship))
    });
  }

  if (normalizedText === 'SELECT clerkship, start_period, year, is_immobile FROM schedule_entries WHERE user_id = $1 ORDER BY clerkship') {
    return Promise.resolve({
      rows: scheduleRows
        .filter((entry) => entry.user_id === Number(params[0]))
        .slice()
        .sort((a, b) => a.clerkship.localeCompare(b.clerkship))
        .map((entry) => ({
          clerkship: entry.clerkship,
          start_period: entry.start_period,
          year: entry.year,
          is_immobile: entry.is_immobile
        }))
    });
  }

  if (normalizedText === 'DELETE FROM schedule_entries WHERE user_id = $1') {
    const userId = Number(params[0]);
    for (let index = scheduleRows.length - 1; index >= 0; index -= 1) {
      if (scheduleRows[index].user_id === userId) {
        scheduleRows.splice(index, 1);
      }
    }
    return Promise.resolve({ rows: [] });
  }

  if (normalizedText === 'INSERT INTO schedule_entries (user_id, clerkship, start_period, year, is_immobile) VALUES ($1, $2, $3, $4, $5)') {
    scheduleRows.push({
      user_id: Number(params[0]),
      clerkship: params[1],
      start_period: params[2],
      year: Number(params[3]),
      is_immobile: Boolean(params[4])
    });
    return Promise.resolve({ rows: [] });
  }

  if (normalizedText === 'SELECT * FROM blocked_periods WHERE user_id = $1 ORDER BY year, period') {
    return Promise.resolve({
      rows: blockedRows
        .filter((entry) => entry.user_id == null || entry.user_id === Number(params[0]))
        .slice()
        .sort((a, b) => a.year - b.year || a.period.localeCompare(b.period, 'en', { numeric: true }))
        .map((entry) => ({ period: entry.period, year: entry.year }))
    });
  }

  if (normalizedText === 'SELECT period, year FROM blocked_periods WHERE user_id = $1 ORDER BY year, period') {
    return Promise.resolve({
      rows: blockedRows
        .filter((entry) => entry.user_id == null || entry.user_id === Number(params[0]))
        .slice()
        .sort((a, b) => a.year - b.year || a.period.localeCompare(b.period, 'en', { numeric: true }))
        .map((entry) => ({ period: entry.period, year: entry.year }))
    });
  }

  if (normalizedText === 'DELETE FROM blocked_periods WHERE user_id = $1') {
    const userId = Number(params[0]);
    for (let index = blockedRows.length - 1; index >= 0; index -= 1) {
      if (blockedRows[index].user_id == null || blockedRows[index].user_id === userId) {
        blockedRows.splice(index, 1);
      }
    }
    return Promise.resolve({ rows: [] });
  }

  if (normalizedText === 'INSERT INTO blocked_periods (user_id, period, year) VALUES ($1, $2, $3)') {
    blockedRows.push({
      user_id: Number(params[0]),
      period: params[1],
      year: Number(params[2])
    });
    return Promise.resolve({ rows: [] });
  }

  throw new Error(`Unhandled query in schedules route test: ${normalizedText}`);
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
