const { Pool } = require('pg');

const defaultAdminEmail = process.env.ADMIN_EMAIL || 'admin@clerkship.local';
const defaultAdminName = process.env.ADMIN_NAME || 'Clerkship Admin';

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
      to_year INTEGER NOT NULL
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

  const defaultSiteContent = {
    hero_title: 'Coordinate clerkship swaps with a shared, structured process',
    hero_body:
      'This site helps students record their current clerkship schedule, mark blocked periods, request preferred moves, and lets an admin run a matching pass that finds direct openings and compatible swap chains.',
    signed_out_callout:
      'Sign in or create an account below to start entering your schedule and preferences.',
    signed_in_callout:
      'You are signed in and can use the tabs above to enter schedules, add desired moves, and review availability.',
    home_blocks: JSON.stringify([
      {
        title: 'How To Fill Out Your Information',
        items: [
          'Open the Schedule tab and enter each clerkship at its current start period and year.',
          'Mark any Blocked Periods where you cannot move a clerkship.',
          'If a clerkship cannot be moved at all, mark it as immobile in the schedule grid.',
          'Go to Desired Moves and add the clerkships you want moved, along with the destination period and year.'
        ]
      },
      {
        title: 'What Preferences Mean',
        items: [
          'Your current schedule is the source of truth for where each clerkship starts.',
          'Blocked periods tell the system where a resulting schedule would be unacceptable.',
          'Desired moves are requests, not guarantees. They are only applied if the result stays valid.',
          'Admins can review all users, clean up accounts, and run the matching algorithm once everyone has entered data.'
        ]
      },
      {
        title: 'How The Algorithm Works',
        items: [
          'It first looks for free moves into open availability.',
          "It then searches for valid swap groups where everyone's requested destination is freed up by the same batch.",
          'Swap groups are capped at 3 users, so the system will not execute 4-way or 5-way chains.',
          'Every proposed result is checked against blocked periods and schedule constraints before being accepted.'
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
}

module.exports = {
  pool,
  query,
  withTransaction,
  initDb
};
