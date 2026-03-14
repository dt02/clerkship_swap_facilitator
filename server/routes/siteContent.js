const express = require('express');
const router = express.Router();
const db = require('../db');
const { requireAdmin } = require('../auth');

async function getContentMap() {
  const rows = await db.query('SELECT key, value FROM site_content ORDER BY key');
  return Object.fromEntries(rows.rows.map(row => [row.key, row.value]));
}

router.get('/', async (req, res, next) => {
  try {
    res.json(await getContentMap());
  } catch (error) {
    next(error);
  }
});

router.put('/', async (req, res, next) => {
  try {
    const actingUser = await requireAdmin(req, res);
    if (!actingUser) return;

    const { content } = req.body;
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      return res.status(400).json({ error: 'content object required' });
    }

    await db.withTransaction(async (client) => {
      for (const [key, value] of Object.entries(content)) {
        await client.query(
          `
            INSERT INTO site_content (key, value)
            VALUES ($1, $2)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
          `,
          [key, String(value ?? '')]
        );
      }
    });

    res.json(await getContentMap());
  } catch (error) {
    next(error);
  }
});

module.exports = router;
