const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireUserAccess } = require('../auth');

router.get('/:id/desires', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const actingUser = await requireUserAccess(req, res, userId);
    if (!actingUser) return;

    const desires = await db.query('SELECT * FROM desired_moves WHERE user_id = $1 ORDER BY id', [userId]);
    res.json(desires.rows);
  } catch (error) {
    next(error);
  }
});

router.post('/:id/desires', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const actingUser = await requireUserAccess(req, res, userId);
    if (!actingUser) return;

    const { clerkship, from_period, from_year, to_period, to_year } = req.body;
    if (!clerkship || !from_period || !from_year || !to_period || !to_year) {
      return res.status(400).json({ error: 'All fields required: clerkship, from_period, from_year, to_period, to_year' });
    }

    const result = await db.query(
      `
        INSERT INTO desired_moves (user_id, clerkship, from_period, from_year, to_period, to_year)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
      [userId, clerkship, from_period, from_year, to_period, to_year]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.delete('/:id/desires/:desireId', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const desireId = parseInt(req.params.desireId, 10);
    const actingUser = await requireUserAccess(req, res, userId);
    if (!actingUser) return;

    await db.query('DELETE FROM desired_moves WHERE id = $1 AND user_id = $2', [desireId, userId]);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
