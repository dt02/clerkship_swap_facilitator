const crypto = require('crypto');
const db = require('./db');

function toPublicUser(user) {
  if (!user) return null;

  const { password_hash, ...rest } = user;
  return {
    ...rest,
    has_password: Boolean(password_hash)
  };
}

async function getActingUser(req) {
  const sessionToken = req.header('x-session-token');
  if (!sessionToken) return null;

  const result = await db.query(
    `
      SELECT u.*
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token = $1
    `,
    [sessionToken]
  );
  return result.rows[0] || null;
}

async function createSessionForUser(userId) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  await db.query(
    `
      INSERT INTO sessions (user_id, token)
      VALUES ($1, $2)
    `,
    [userId, sessionToken]
  );
  return sessionToken;
}

async function revokeSessionByToken(sessionToken) {
  if (!sessionToken) return;
  await db.query('DELETE FROM sessions WHERE token = $1', [sessionToken]);
}

async function requireSignedIn(req, res) {
  const user = await getActingUser(req);
  if (!user) {
    res.status(401).json({ error: 'Please sign in first' });
    return null;
  }
  return user;
}

async function requireAdmin(req, res) {
  const user = await requireSignedIn(req, res);
  if (!user) return null;

  if (!user.is_admin) {
    res.status(403).json({ error: 'Admin access required' });
    return null;
  }

  return user;
}

async function requireUserAccess(req, res, targetUserId) {
  const user = await requireSignedIn(req, res);
  if (!user) return null;

  if (!user.is_admin && user.id !== targetUserId) {
    res.status(403).json({ error: 'You can only access your own data' });
    return null;
  }

  return user;
}

module.exports = {
  createSessionForUser,
  getActingUser,
  requireSignedIn,
  requireAdmin,
  requireUserAccess,
  revokeSessionByToken,
  toPublicUser
};
