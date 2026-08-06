const crypto = require('crypto');

function checkPassword(password) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected || typeof password !== 'string') return false;

  const a = Buffer.from(password);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { checkPassword, requireAdmin };
