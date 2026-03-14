const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const dbPath = require.resolve('../db');
const authPath = require.resolve('../auth');
const routePath = require.resolve('./desires');

test('POST /api/users/:id/desires accepts year 0 requests and appends the next priority rank', async () => {
  const mockDb = createMockDb({
    sessionToken: 'user-session',
    actingUser: { id: 5, name: 'Alice', email: 'alice@example.com', is_admin: false },
    desires: [
      {
        id: 11,
        user_id: 5,
        clerkship: 'EMED 301A',
        from_period: '1A',
        from_year: 1,
        to_period: '2A',
        to_year: 1,
        priority_rank: 1,
        created_at: '2026-03-13T10:00:00Z'
      }
    ]
  });

  await withDesiresApp(mockDb, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/users/5/desires`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': 'user-session'
      },
      body: JSON.stringify({
        clerkship: 'PEDS 300A',
        from_period: '11A',
        from_year: 1,
        to_period: '10A',
        to_year: 0
      })
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(body.to_year, 0);
    assert.equal(body.priority_rank, 2);
    assert.equal(body.clerkship, 'PEDS 300A');
  });
});

test('PUT /api/users/:id/desires/reorder updates request priority order deterministically', async () => {
  const mockDb = createMockDb({
    sessionToken: 'user-session',
    actingUser: { id: 5, name: 'Alice', email: 'alice@example.com', is_admin: false },
    desires: [
      {
        id: 11,
        user_id: 5,
        clerkship: 'EMED 301A',
        from_period: '1A',
        from_year: 1,
        to_period: '2A',
        to_year: 1,
        priority_rank: 1,
        created_at: '2026-03-13T10:00:00Z'
      },
      {
        id: 12,
        user_id: 5,
        clerkship: 'PEDS 300A',
        from_period: '3A',
        from_year: 1,
        to_period: '5A',
        to_year: 1,
        priority_rank: 2,
        created_at: '2026-03-13T10:05:00Z'
      }
    ]
  });

  await withDesiresApp(mockDb, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/users/5/desires/reorder`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'x-session-token': 'user-session'
      },
      body: JSON.stringify({ desireIds: [12, 11] })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.map((desire) => desire.id), [12, 11]);
    assert.deepEqual(body.map((desire) => desire.priority_rank), [1, 2]);
  });
});

async function withDesiresApp(mockDb, runTest) {
  const originalDbModule = require.cache[dbPath];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: mockDb
  };
  delete require.cache[authPath];
  delete require.cache[routePath];

  const router = require('./desires');
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

function createMockDb({ sessionToken, actingUser, desires = [] }) {
  const desireRows = desires.map((desire) => ({ ...desire }));
  let nextDesireId = desireRows.reduce((maxId, desire) => Math.max(maxId, desire.id), 0) + 1;

  return {
    async query(text, params = []) {
      return handleQuery(text, params, desireRows, sessionToken, actingUser, () => nextDesireId++);
    },
    async withTransaction(callback) {
      return callback({
        async query(text, params = []) {
          return handleQuery(text, params, desireRows, sessionToken, actingUser, () => nextDesireId++);
        }
      });
    }
  };
}

function handleQuery(text, params, desireRows, sessionToken, actingUser, nextDesireId) {
  const normalizedText = text.replace(/\s+/g, ' ').trim();

  if (normalizedText === 'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = $1') {
    return Promise.resolve({ rows: actingUser && params[0] === sessionToken ? [actingUser] : [] });
  }

  if (normalizedText === 'SELECT COALESCE(MAX(priority_rank), 0) + 1 AS next_rank FROM desired_moves WHERE user_id = $1') {
    const userId = Number(params[0]);
    const currentMax = desireRows
      .filter((desire) => desire.user_id === userId)
      .reduce((maxRank, desire) => Math.max(maxRank, Number(desire.priority_rank || 0)), 0);
    return Promise.resolve({ rows: [{ next_rank: currentMax + 1 }] });
  }

  if (normalizedText === 'INSERT INTO desired_moves (user_id, clerkship, from_period, from_year, to_period, to_year, priority_rank) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *') {
    const created = {
      id: nextDesireId(),
      user_id: Number(params[0]),
      clerkship: params[1],
      from_period: params[2],
      from_year: Number(params[3]),
      to_period: params[4],
      to_year: Number(params[5]),
      priority_rank: Number(params[6]),
      created_at: '2026-03-13T12:00:00Z'
    };
    desireRows.push(created);
    return Promise.resolve({ rows: [created] });
  }

  if (normalizedText === 'SELECT id FROM desired_moves WHERE user_id = $1 ORDER BY priority_rank NULLS LAST, created_at NULLS LAST, id') {
    const userId = Number(params[0]);
    return Promise.resolve({
      rows: sortDesires(desireRows, userId).map((desire) => ({ id: desire.id }))
    });
  }

  if (normalizedText === 'UPDATE desired_moves SET priority_rank = $1 WHERE id = $2 AND user_id = $3') {
    const nextRank = Number(params[0]);
    const desireId = Number(params[1]);
    const userId = Number(params[2]);
    const target = desireRows.find((desire) => desire.id === desireId && desire.user_id === userId);
    if (target) {
      target.priority_rank = nextRank;
    }
    return Promise.resolve({ rows: [] });
  }

  if (normalizedText === 'SELECT * FROM desired_moves WHERE user_id = $1 ORDER BY priority_rank NULLS LAST, created_at NULLS LAST, id') {
    const userId = Number(params[0]);
    return Promise.resolve({ rows: sortDesires(desireRows, userId).map((desire) => ({ ...desire })) });
  }

  throw new Error(`Unhandled query in desires route test: ${normalizedText}`);
}

function sortDesires(desireRows, userId) {
  return desireRows
    .filter((desire) => desire.user_id === userId)
    .slice()
    .sort((desireA, desireB) => {
      const rankA = desireA.priority_rank ?? Number.MAX_SAFE_INTEGER;
      const rankB = desireB.priority_rank ?? Number.MAX_SAFE_INTEGER;
      if (rankA !== rankB) {
        return rankA - rankB;
      }

      const createdA = desireA.created_at ? Date.parse(desireA.created_at) : Number.MAX_SAFE_INTEGER;
      const createdB = desireB.created_at ? Date.parse(desireB.created_at) : Number.MAX_SAFE_INTEGER;
      if (createdA !== createdB) {
        return createdA - createdB;
      }

      return desireA.id - desireB.id;
    });
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
