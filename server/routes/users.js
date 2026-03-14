const express = require('express');
const router = express.Router();
const db = require('../db');
const { getActingUser, requireAdmin, requireSignedIn, requireUserAccess } = require('../auth');

router.get('/', async (req, res, next) => {
  try {
    const actingUser = await requireAdmin(req, res);
    if (!actingUser) return;

    const users = await db.query('SELECT * FROM users ORDER BY name');
    res.json(users.rows);
  } catch (error) {
    next(error);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    const actingUser = await requireSignedIn(req, res);
    if (!actingUser) return;

    res.json(actingUser);
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const user = await db.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email.trim()]);
    if (!user.rows[0]) return res.status(404).json({ error: 'No user found for that email' });

    res.json(user.rows[0]);
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

    res.json(user.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, email, is_admin } = req.body;
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' });

    let createAsAdmin = false;
    if (is_admin) {
      const actingUser = await getActingUser(req);
      if (!actingUser?.is_admin) {
        return res.status(403).json({ error: 'Only admins can create admin users' });
      }
      createAsAdmin = true;
    }

    const result = await db.query(
      `
        INSERT INTO users (name, email, is_admin)
        VALUES ($1, $2, $3)
        RETURNING *
      `,
      [name.trim(), email.trim(), createAsAdmin]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Email already exists' });
    }
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
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
