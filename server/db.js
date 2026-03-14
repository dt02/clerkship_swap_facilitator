const { Pool } = require('pg');
const { CLERKSHIPS, SUPPORTED_YEARS } = require('./clerkships');
const { hashPassword, validatePasswordInput } = require('./passwords');

const defaultAdminEmail = process.env.ADMIN_EMAIL || 'admin@clerkship.local';
const defaultAdminName = process.env.ADMIN_NAME || 'Clerkship Admin';
const defaultAdminPassword = process.env.ADMIN_PASSWORD || '';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Configure Render Postgres and set DATABASE_URL.');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function withTransaction(callback) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      password_hash TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS schedule_entries (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      clerkship TEXT NOT NULL,
      start_period TEXT NOT NULL,
      year INTEGER NOT NULL,
      is_immobile BOOLEAN DEFAULT FALSE,
      UNIQUE(user_id, clerkship)
    );

    CREATE TABLE IF NOT EXISTS blocked_periods (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      period TEXT NOT NULL,
      year INTEGER NOT NULL,
      UNIQUE(user_id, period, year)
    );

    CREATE TABLE IF NOT EXISTS desired_moves (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      clerkship TEXT NOT NULL,
      from_period TEXT NOT NULL,
      from_year INTEGER NOT NULL,
      to_period TEXT NOT NULL,
      to_year INTEGER NOT NULL,
      priority_rank INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS availability (
      id SERIAL PRIMARY KEY,
      clerkship TEXT NOT NULL,
      period TEXT NOT NULL,
      year INTEGER NOT NULL,
      spots INTEGER NOT NULL DEFAULT 0,
      UNIQUE(clerkship, period, year)
    );

    CREATE TABLE IF NOT EXISTS match_results (
      id SERIAL PRIMARY KEY,
      run_at TIMESTAMPTZ DEFAULT NOW(),
      result_json JSONB NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_content (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
    ALTER TABLE desired_moves ADD COLUMN IF NOT EXISTS priority_rank INTEGER;
    ALTER TABLE desired_moves ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
  `);

  await pool.query(`
    WITH ranked AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY user_id
          ORDER BY priority_rank NULLS LAST, created_at NULLS LAST, id
        ) AS next_rank
      FROM desired_moves
    )
    UPDATE desired_moves AS desires
    SET
      created_at = COALESCE(desires.created_at, NOW()),
      priority_rank = COALESCE(desires.priority_rank, ranked.next_rank)
    FROM ranked
    WHERE desires.id = ranked.id;
  `);

  await pool.query(
    `
      INSERT INTO users (name, email, is_admin)
      VALUES ($1, $2, TRUE)
      ON CONFLICT (email)
      DO UPDATE SET name = EXCLUDED.name, is_admin = TRUE
    `,
    [defaultAdminName, defaultAdminEmail]
  );

  if (defaultAdminPassword) {
    const validationError = validatePasswordInput(defaultAdminPassword);
    if (validationError) {
      throw new Error(`ADMIN_PASSWORD invalid: ${validationError}`);
    }

    const adminPasswordHash = await hashPassword(defaultAdminPassword);
    await pool.query(
      'UPDATE users SET password_hash = $1 WHERE lower(email) = lower($2)',
      [adminPasswordHash, defaultAdminEmail]
    );
  }

  const defaultSiteContent = {
    hero_title: '',
    hero_body:
      "Website to facilitate clerkship swaps. It may or may not work, but it doesn't hurt to try. Email deantran@stanford.edu if you have any questions.",
    signed_out_callout:
      'Sign in or create an account below to start entering your schedule and preferences. IMPORTANT: Please do not use a password that you normally use for other accounts. Passwords are hashed (meaning I can\'t see them), but the data is stored (temporarily) on a free Render database, and I don\'t know how secure it is.',
    signed_in_callout:
      'You are signed in and can use the tabs above to enter schedules, add desired moves, and review availability.',
    home_blocks: JSON.stringify([
      {
        title: 'How To Fill Out Your Information',
        items: [
          'Open the Schedule tab and enter each clerkship at its current start period and year.',
          'Mark any Blocked Periods where you do not want to schedule a clerkship. (e.g. periods 10-12 of 2025-26).',
          'If there is a non core clerkship scheduled that you do not want to drop, mark those periods as blocked.',
          'If you do not want a specific clerkship moved, mark it as immobile in the schedule grid.',
          'Go to Desired Moves and add the clerkships you want moved, along with the destination period and year.'
        ]
      },
      {
        title: 'How The Algorithm Works',
        items: [
          'The algorithm looks for the best legal way to reshuffle schedules using only three kinds of moves: an open spot, a 2-person swap, or a 3-person swap.',
          "It checks whether a requested move would keep everyone's full schedule valid, including no overlaps, no blocked times, correct clerkship timing, required prerequisites, and at least four clerkships in the year 0/1 window.",
          'If more than one possible swap could work, it ranks them and picks the option that helps the most students, then repeats the process until no more valid moves are possible.'
        ]
      },
      {
        title: 'IMPORTANT: Availability Tab',
        items: [
          'When you login, there is a tab for current core clerkship availabilities that the algorithm uses when proposing matches.',
          'This may not necessarily be up to date. Please ensure that it is, or else the algorithm will not work as intended.',
          'Anyone can edit the availability tab, and the changes should reflect for everyone.'
        ]
      }
    ])
  };

  for (const [key, value] of Object.entries(defaultSiteContent)) {
    await pool.query(
      `
        INSERT INTO site_content (key, value)
        VALUES ($1, $2)
        ON CONFLICT (key) DO NOTHING
      `,
      [key, value]
    );
  }

  const availabilityCount = await pool.query('SELECT COUNT(*)::int AS count FROM availability');
  if (availabilityCount.rows[0].count === 0) {
    const rows = [];

    function seedRows(clerkship, yearData) {
      for (const [period, spots] of Object.entries(yearData.y1 || {})) rows.push([clerkship, period, 1, spots]);
      for (const [period, spots] of Object.entries(yearData.y2 || {})) rows.push([clerkship, period, 2, spots]);
    }

    seedRows('ANES 306A', {
      y1: { '1A':0,'2A':0,'3A':0,'4A':0,'5A':0,'6A':1,'7A':0,'8A':0,'9A':0,'10A':0,'11A':0,'12A':4 },
      y2: { '1A':3,'2A':1,'3A':0,'4A':0,'5A':2,'6A':7,'7A':0,'8A':0,'9A':0,'10A':0 }
    });
    seedRows('ANES 306P', {
      y1: { '1A':2,'2A':0,'3A':1,'4A':0,'5A':3,'6A':3,'7A':0,'8A':0,'9A':0,'10A':0,'11A':3,'12A':2 },
      y2: { '1A':4,'2A':4,'3A':3,'4A':0,'5A':3,'6A':4,'7A':0,'8A':0,'9A':0,'10A':0 }
    });
    seedRows('EMED 301A', {
      y1: { '1A':0,'2A':1,'3A':0,'4A':0,'5A':0,'6A':1,'7A':0,'8A':2,'9A':0,'10A':0,'11A':8,'12A':10 },
      y2: { '1A':7,'2A':9,'3A':4,'4A':0,'5A':8,'6A':9,'7A':1,'8A':0,'9A':1,'10A':8 }
    });
    seedRows('FAMMED 301A', {
      y1: { '1A':0,'2A':0,'3A':0,'4A':0,'5A':0,'6A':2,'7A':0,'8A':0,'9A':0,'10A':0,'11A':4,'12A':4 },
      y2: { '1A':4,'2A':5,'3A':0,'4A':0,'5A':9,'6A':7,'7A':0,'8A':0,'9A':0,'10A':0 }
    });
    seedRows('MED 300A', {
      y1: { '1A':0,'3A':0,'5A':0,'7A':0,'9A':5,'11A':12 }
    });
    seedRows('MED 313A', {
      y1: { '1A':0,'2A':0,'3A':0,'4A':0,'5A':0,'6A':1,'7A':0,'8A':0,'9A':0,'10A':0,'11A':0,'12A':6 },
      y2: { '1A':4,'2A':1,'3A':0,'4A':0,'5A':7,'6A':7,'7A':1,'8A':0,'9A':0,'10A':0 }
    });
    seedRows('NENS 301A', {
      y1: { '1A':0,'2A':0,'3A':0,'4A':0,'5A':2,'6A':3,'7A':0,'8A':0,'9A':0,'10A':0,'11A':4,'12A':7 },
      y2: { '1A':9,'2A':8,'3A':5,'4A':3,'5A':5,'6A':9,'7A':0,'8A':1,'9A':0,'10A':1 }
    });
    seedRows('OBGYN 300A', {
      y1: { '1A':0,'2B':0,'4A':6,'5B':0,'7A':0,'8B':2,'10A':7,'11B':9 },
      y2: { '1A':15,'2B':10 }
    });
    seedRows('PEDS 300A', {
      y1: { '1A':0,'3A':0,'5A':0,'7A':0,'9A':0,'11A':3 },
      y2: { '1A':10,'3A':0,'5A':15,'7A':0 }
    });
    seedRows('PSYC 300A', {
      y1: { '1A':0,'2A':0,'3A':0,'4A':0,'5A':5,'6A':2,'7A':0,'8A':0,'9A':0,'10A':0,'11A':8,'12A':9 },
      y2: { '1A':10,'2A':8,'3A':4,'4A':3,'5A':7,'6A':9,'7A':4,'8A':0,'9A':0,'10A':6 }
    });
    seedRows('SURG 300A', {
      y1: { '1A':0,'3A':0,'5A':0,'7A':0,'9A':2,'11A':18 }
    });

    for (const [clerkship, period, year, spots] of rows) {
      await pool.query(
        `
          INSERT INTO availability (clerkship, period, year, spots)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (clerkship, period, year) DO NOTHING
        `,
        [clerkship, period, year, spots]
      );
    }
  }

  for (const [clerkship, definition] of Object.entries(CLERKSHIPS)) {
    for (const year of SUPPORTED_YEARS) {
      for (const period of definition.validStarts[year] || []) {
        await pool.query(
          `
            INSERT INTO availability (clerkship, period, year, spots)
            VALUES ($1, $2, $3, 0)
            ON CONFLICT (clerkship, period, year) DO NOTHING
          `,
          [clerkship, period, year]
        );
      }
    }
  }
}

module.exports = {
  pool,
  query,
  withTransaction,
  initDb
};
