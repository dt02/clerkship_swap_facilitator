const express = require('express');
const router = express.Router();
const db = require('../db');
const {
  createSessionForUser,
  getActingUser,
  requireAdmin,
  requireSignedIn,
  requireUserAccess,
  revokeSessionByToken,
  toPublicUser
} = require('../auth');
const { hashPassword, verifyPassword, validatePasswordInput } = require('../passwords');

router.get('/', async (req, res, next) => {
  try {
    const actingUser = await requireAdmin(req, res);
    if (!actingUser) return;

    const users = await db.query('SELECT * FROM users ORDER BY name');
    res.json(users.rows.map(toPublicUser));
  } catch (error) {
    next(error);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    const actingUser = await requireSignedIn(req, res);
    if (!actingUser) return;

    res.json(toPublicUser(actingUser));
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const userResult = await db.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email.trim()]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'No user found for that email' });

    if (user.password_hash) {
      if (!password) {
        return res.status(400).json({ error: 'Password required' });
      }

      const passwordMatches = await verifyPassword(password, user.password_hash);
      if (!passwordMatches) {
        return res.status(401).json({ error: 'Incorrect password' });
      }
    }

    const sessionToken = await createSessionForUser(user.id);
    res.json({
      sessionToken,
      user: toPublicUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const sessionToken = req.header('x-session-token');
    await revokeSessionByToken(sessionToken);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const actingUser = await requireUserAccess(req, res, targetUserId);
    if (!actingUser) return;

    const user = await db.query('SELECT * FROM users WHERE id = $1', [targetUserId]);
    if (!user.rows[0]) return res.status(404).json({ error: 'User not found' });

    res.json(toPublicUser(user.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, email, password, is_admin } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

    let createAsAdmin = false;
    if (is_admin) {
      const actingUser = await getActingUser(req);
      if (!actingUser?.is_admin) {
        return res.status(403).json({ error: 'Only admins can create admin users' });
      }
      createAsAdmin = true;
    }

    const validationError = validatePasswordInput(password);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const passwordHash = await hashPassword(password);
    const result = await db.query(
      `
        INSERT INTO users (name, email, is_admin, password_hash)
        VALUES ($1, $2, $3, $4)
        RETURNING *
      `,
      [name.trim(), email.trim(), createAsAdmin, passwordHash]
    );

    const createdUser = result.rows[0];
    const sessionToken = await createSessionForUser(createdUser.id);

    res.status(201).json({
      sessionToken,
      user: toPublicUser(createdUser)
    });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    next(error);
  }
});

router.put('/:id/password', async (req, res, next) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const actingUser = await requireUserAccess(req, res, targetUserId);
    if (!actingUser) return;

    const { current_password, new_password } = req.body;
    const validationError = validatePasswordInput(new_password);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const userResult = await db.query('SELECT * FROM users WHERE id = $1', [targetUserId]);
    const targetUser = userResult.rows[0];
    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!actingUser.is_admin && targetUser.password_hash) {
      const passwordMatches = await verifyPassword(current_password, targetUser.password_hash);
      if (!passwordMatches) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    const passwordHash = await hashPassword(new_password);
    const updatedUser = await db.query(
      'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING *',
      [passwordHash, targetUserId]
    );

    res.json(toPublicUser(updatedUser.rows[0]));
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const targetUserId = parseInt(req.params.id, 10);
    const actingUser = await requireSignedIn(req, res);
    if (!actingUser) return;

    if (!actingUser.is_admin && actingUser.id !== targetUserId) {
      return res.status(403).json({ error: 'Only admins can delete other users' });
    }

    await db.query('DELETE FROM users WHERE id = $1', [targetUserId]);

    if (actingUser.id === targetUserId) {
      const sessionToken = req.header('x-session-token');
      await revokeSessionByToken(sessionToken);
    }

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
