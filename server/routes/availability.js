const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res, next) => {
  try {
    const rows = await db.query('SELECT * FROM availability ORDER BY clerkship, year, period');
    res.json(rows.rows);
  } catch (error) {
    next(error);
  }
});

router.get('/:clerkship', async (req, res, next) => {
  try {
    const clerkship = decodeURIComponent(req.params.clerkship);
    const rows = await db.query(
      'SELECT * FROM availability WHERE clerkship = $1 ORDER BY year, period',
      [clerkship]
    );
    res.json(rows.rows);
  } catch (error) {
    next(error);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const { entries } = req.body;
    if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries array required' });

    await db.withTransaction(async (client) => {
      for (const entry of entries) {
        await client.query(
          `
            INSERT INTO availability (clerkship, period, year, spots)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (clerkship, period, year)
            DO UPDATE SET spots = EXCLUDED.spots
          `,
          [entry.clerkship, entry.period, entry.year, entry.spots]
        );
      }
    });

    const rows = await db.query('SELECT * FROM availability ORDER BY clerkship, year, period');
    res.json(rows.rows);
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', async (req, res, next) => {
  try {
    const { spots } = req.body;
    const id = parseInt(req.params.id, 10);
    if (spots === undefined) return res.status(400).json({ error: 'spots required' });

    const row = await db.query(
      'UPDATE availability SET spots = $1 WHERE id = $2 RETURNING *',
      [spots, id]
    );

    res.json(row.rows[0] || null);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
