const db = require('./db');

async function getActingUser(req) {
  const rawUserId = req.header('x-user-id');
  if (!rawUserId) return null;

  const userId = parseInt(rawUserId, 10);
  if (!Number.isInteger(userId)) return null;

  const result = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
  return result.rows[0] || null;
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
  getActingUser,
  requireSignedIn,
  requireAdmin,
  requireUserAccess
};
