const express = require('express');
const router = express.Router();
const db = require('../db');
const { CLERKSHIPS } = require('../clerkships');
const { requireUserAccess } = require('../auth');

router.get('/:id/schedule', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const actingUser = await requireUserAccess(req, res, userId);
    if (!actingUser) return;

    const entries = await db.query('SELECT * FROM schedule_entries WHERE user_id = $1 ORDER BY clerkship', [userId]);
    res.json(entries.rows);
  } catch (error) {
    next(error);
  }
});

router.put('/:id/schedule', async (req, res, next) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries array required' });

    const userId = parseInt(req.params.id, 10);
    const actingUser = await requireUserAccess(req, res, userId);
    if (!actingUser) return;

    const user = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (!user.rows[0]) return res.status(404).json({ error: 'User not found' });

    for (const entry of entries) {
      if (!CLERKSHIPS[entry.clerkship]) {
        return res.status(400).json({ error: `Unknown clerkship: ${entry.clerkship}` });
      }
      if (![1, 2].includes(entry.year)) {
        return res.status(400).json({ error: 'Year must be 1 or 2' });
      }
      const validStarts = CLERKSHIPS[entry.clerkship].validStarts[entry.year];
      if (!validStarts || !validStarts.includes(entry.start_period)) {
        return res.status(400).json({ error: `Invalid start period ${entry.start_period} for ${entry.clerkship} in year ${entry.year}` });
      }
    }

    await db.withTransaction(async (client) => {
      await client.query('DELETE FROM schedule_entries WHERE user_id = $1', [userId]);

      for (const entry of entries) {
        await client.query(
          `
            INSERT INTO schedule_entries (user_id, clerkship, start_period, year, is_immobile)
            VALUES ($1, $2, $3, $4, $5)
          `,
          [userId, entry.clerkship, entry.start_period, entry.year, Boolean(entry.is_immobile)]
        );
      }
    });

    const result = await db.query('SELECT * FROM schedule_entries WHERE user_id = $1 ORDER BY clerkship', [userId]);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id/schedule/:entryId', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const entryId = parseInt(req.params.entryId, 10);
    const actingUser = await requireUserAccess(req, res, userId);
    if (!actingUser) return;

    const { is_immobile } = req.body;
    if (is_immobile !== undefined) {
      await db.query(
        'UPDATE schedule_entries SET is_immobile = $1 WHERE id = $2 AND user_id = $3',
        [Boolean(is_immobile), entryId, userId]
      );
    }

    const entry = await db.query('SELECT * FROM schedule_entries WHERE id = $1', [entryId]);
    res.json(entry.rows[0] || null);
  } catch (error) {
    next(error);
  }
});

router.get('/:id/blocked', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const actingUser = await requireUserAccess(req, res, userId);
    if (!actingUser) return;

    const blocked = await db.query('SELECT * FROM blocked_periods WHERE user_id = $1 ORDER BY year, period', [userId]);
    res.json(blocked.rows);
  } catch (error) {
    next(error);
  }
});

router.put('/:id/blocked', async (req, res, next) => {
  try {
    const { blocked } = req.body;
    if (!Array.isArray(blocked)) return res.status(400).json({ error: 'blocked array required' });

    const userId = parseInt(req.params.id, 10);
    const actingUser = await requireUserAccess(req, res, userId);
    if (!actingUser) return;

    await db.withTransaction(async (client) => {
      await client.query('DELETE FROM blocked_periods WHERE user_id = $1', [userId]);

      for (const block of blocked) {
        await client.query(
          'INSERT INTO blocked_periods (user_id, period, year) VALUES ($1, $2, $3)',
          [userId, block.period, block.year]
        );
      }
    });

    const result = await db.query('SELECT * FROM blocked_periods WHERE user_id = $1 ORDER BY year, period', [userId]);
    res.json(result.rows);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
