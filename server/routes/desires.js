const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireUserAccess } = require('../auth');

router.get('/:id/desires', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const actingUser = await requireUserAccess(req, res, userId);
    if (!actingUser) return;

    const desires = await db.query(
      `
        SELECT *
        FROM desired_moves
        WHERE user_id = $1
        ORDER BY priority_rank NULLS LAST, created_at NULLS LAST, id
      `,
      [userId]
    );
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
    if (
      !clerkship ||
      !from_period ||
      !to_period ||
      from_year === undefined ||
      from_year === null ||
      to_year === undefined ||
      to_year === null
    ) {
      return res.status(400).json({ error: 'All fields required: clerkship, from_period, from_year, to_period, to_year' });
    }

    const nextRankResult = await db.query(
      'SELECT COALESCE(MAX(priority_rank), 0) + 1 AS next_rank FROM desired_moves WHERE user_id = $1',
      [userId]
    );
    const nextRank = Number(nextRankResult.rows[0].next_rank || 1);

    const result = await db.query(
      `
        INSERT INTO desired_moves (user_id, clerkship, from_period, from_year, to_period, to_year, priority_rank)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *
      `,
      [userId, clerkship, from_period, from_year, to_period, to_year, nextRank]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    next(error);
  }
});

router.put('/:id/desires/reorder', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    const actingUser = await requireUserAccess(req, res, userId);
    if (!actingUser) return;

    const { desireIds } = req.body;
    if (!Array.isArray(desireIds)) {
      return res.status(400).json({ error: 'desireIds array required' });
    }

    const current = await db.query(
      `
        SELECT id
        FROM desired_moves
        WHERE user_id = $1
        ORDER BY priority_rank NULLS LAST, created_at NULLS LAST, id
      `,
      [userId]
    );
    const currentIds = current.rows.map((row) => row.id);
    const normalizedIds = desireIds.map((id) => parseInt(id, 10)).filter(Number.isInteger);

    if (normalizedIds.length !== currentIds.length) {
      return res.status(400).json({ error: 'Reorder payload must include every desire exactly once' });
    }

    const currentIdSet = new Set(currentIds);
    if (normalizedIds.some((id) => !currentIdSet.has(id)) || new Set(normalizedIds).size !== normalizedIds.length) {
      return res.status(400).json({ error: 'Reorder payload contains invalid desire ids' });
    }

    await db.withTransaction(async (client) => {
      for (const [index, desireId] of normalizedIds.entries()) {
        await client.query(
          'UPDATE desired_moves SET priority_rank = $1 WHERE id = $2 AND user_id = $3',
          [index + 1, desireId, userId]
        );
      }
    });

    const desires = await db.query(
      `
        SELECT *
        FROM desired_moves
        WHERE user_id = $1
        ORDER BY priority_rank NULLS LAST, created_at NULLS LAST, id
      `,
      [userId]
    );
    res.json(desires.rows);
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

    const remaining = await db.query(
      `
        SELECT id
        FROM desired_moves
        WHERE user_id = $1
        ORDER BY priority_rank NULLS LAST, created_at NULLS LAST, id
      `,
      [userId]
    );

    await db.withTransaction(async (client) => {
      for (const [index, row] of remaining.rows.entries()) {
        await client.query(
          'UPDATE desired_moves SET priority_rank = $1 WHERE id = $2 AND user_id = $3',
          [index + 1, row.id, userId]
        );
      }
    });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
