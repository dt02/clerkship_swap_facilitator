const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { hashPassword } = require('../passwords');

const dbPath = require.resolve('../db');
const authPath = require.resolve('../auth');
const routePath = require.resolve('./users');

test('POST /api/users creates a password-protected account and a session token', async () => {
  const mockDb = createMockDb();

  await withUsersApp(mockDb, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Alice',
        email: 'alice@example.com',
        password: 'password123'
      })
    });
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(typeof body.sessionToken, 'string');
    assert.equal(body.user.name, 'Alice');
    assert.equal(body.user.email, 'alice@example.com');
    assert.equal(body.user.has_password, true);
    assert.equal('password_hash' in body.user, false);
  });
});

test('POST /api/users/login verifies password-protected accounts', async () => {
  const passwordHash = await hashPassword('password123');
  const mockDb = createMockDb({
    users: [
      {
        id: 7,
        name: 'Alice',
        email: 'alice@example.com',
        is_admin: false,
        password_hash: passwordHash
      }
    ]
  });

  await withUsersApp(mockDb, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/users/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        password: 'password123'
      })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(typeof body.sessionToken, 'string');
    assert.equal(body.user.id, 7);
    assert.equal(body.user.has_password, true);
  });
});

async function withUsersApp(mockDb, runTest) {
  const originalDbModule = require.cache[dbPath];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: mockDb
  };
  delete require.cache[authPath];
  delete require.cache[routePath];

  const router = require('./users');
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

function createMockDb(options = {}) {
  const users = [...(options.users || [])];
  const sessions = [];
  let nextUserId = users.reduce((maxId, user) => Math.max(maxId, user.id), 0) + 1;

  return {
    async query(text, params = []) {
      const normalizedText = text.replace(/\s+/g, ' ').trim();

      if (normalizedText === 'SELECT * FROM users ORDER BY name') {
        return { rows: [...users].sort((userA, userB) => userA.name.localeCompare(userB.name)) };
      }

      if (normalizedText === 'SELECT * FROM users WHERE lower(email) = lower($1)') {
        const email = String(params[0]).toLowerCase();
        return { rows: users.filter((user) => user.email.toLowerCase() === email) };
      }

      if (normalizedText === 'SELECT * FROM users WHERE id = $1') {
        return { rows: users.filter((user) => user.id === Number(params[0])) };
      }

      if (normalizedText === 'INSERT INTO sessions (user_id, token) VALUES ($1, $2)') {
        sessions.push({ user_id: Number(params[0]), token: params[1] });
        return { rows: [] };
      }

      if (normalizedText === 'INSERT INTO users (name, email, is_admin, password_hash) VALUES ($1, $2, $3, $4) RETURNING *') {
        const createdUser = {
          id: nextUserId,
          name: params[0],
          email: params[1],
          is_admin: Boolean(params[2]),
          password_hash: params[3]
        };
        nextUserId += 1;
        users.push(createdUser);
        return { rows: [createdUser] };
      }

      if (normalizedText === 'DELETE FROM sessions WHERE token = $1') {
        return { rows: [] };
      }

      throw new Error(`Unhandled query in users route test: ${normalizedText}`);
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
