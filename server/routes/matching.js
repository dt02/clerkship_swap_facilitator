const express = require('express');
const router = express.Router();
const db = require('../db');
const { findSwaps } = require('../matching/solver');
const { requireAdmin } = require('../auth');
const { sanitizeBlockedPeriods } = require('../blockedPeriods');

router.post('/run', async (req, res, next) => {
  try {
    const actingUser = await requireAdmin(req, res);
    if (!actingUser) return;

    const [users, allSchedules, allBlocked, allDesires, allAvailability] = await Promise.all([
      db.query('SELECT * FROM users'),
      db.query('SELECT * FROM schedule_entries'),
      db.query('SELECT * FROM blocked_periods'),
      db.query('SELECT * FROM desired_moves'),
      db.query('SELECT * FROM availability')
    ]);

    const schedules = {};
    for (const entry of allSchedules.rows) {
      if (!schedules[entry.user_id]) schedules[entry.user_id] = [];
      schedules[entry.user_id].push(entry);
    }

    const blocked = {};
    for (const entry of allBlocked.rows) {
      if (!blocked[entry.user_id]) blocked[entry.user_id] = [];
      blocked[entry.user_id].push(entry);
    }

    for (const user of users.rows) {
      const userId = user.id;
      blocked[userId] = sanitizeBlockedPeriods(blocked[userId] || [], schedules[userId] || []);
    }

    const availability = {};
    for (const entry of allAvailability.rows) {
      availability[`${entry.clerkship}|${entry.period}|${entry.year}`] = entry.spots;
    }

    const result = await findSwaps(users.rows, schedules, blocked, allDesires.rows, availability);

    if (result.errors?.length) {
      return res.status(400).json({
        error: result.errors[0],
        details: result.errors,
        validationDiagnostics: result.validationDiagnostics || []
      });
    }

    const saved = await db.query(
      `
        INSERT INTO match_results (result_json)
        VALUES ($1::jsonb)
        RETURNING id
      `,
      [JSON.stringify(result)]
    );

    res.json({
      id: saved.rows[0].id,
      ...result
    });
  } catch (error) {
    console.error('Matching error:', error);
    next(error);
  }
});

router.get('/results', async (req, res, next) => {
  try {
    const actingUser = await requireAdmin(req, res);
    if (!actingUser) return;

    const latest = await db.query('SELECT * FROM match_results ORDER BY id DESC LIMIT 1');
    if (!latest.rows[0]) return res.json(null);

    res.json(latest.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.get('/results/:id', async (req, res, next) => {
  try {
    const actingUser = await requireAdmin(req, res);
    if (!actingUser) return;

    const id = parseInt(req.params.id, 10);
    const result = await db.query('SELECT * FROM match_results WHERE id = $1', [id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Not found' });

    res.json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
