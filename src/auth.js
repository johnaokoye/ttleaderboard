const bcrypt = require('bcryptjs');
const { pool } = require('./db');

const SALT_ROUNDS = 10;

// Creates admin_credentials if it's missing, regardless of whether db/init.sql
// ever ran against this database (see the comment in db/init.sql — a bind-mount
// bug once meant schema changes silently never applied on some deployments).
// This makes the feature work without requiring a volume wipe or manual migration.
async function ensureAdminSeeded() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_credentials (
      id SMALLINT PRIMARY KEY DEFAULT 1,
      password_hash VARCHAR(100) NOT NULL,
      must_change_password BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT admin_credentials_single_row CHECK (id = 1)
    )
  `);

  const { rows } = await pool.query('SELECT id FROM admin_credentials WHERE id = 1');
  if (rows.length > 0) return;

  const bootstrapPassword = process.env.ADMIN_PASSWORD;
  if (!bootstrapPassword) {
    throw new Error('ADMIN_PASSWORD must be set to bootstrap the initial admin login');
  }
  const hash = await bcrypt.hash(bootstrapPassword, SALT_ROUNDS);
  await pool.query(
    'INSERT INTO admin_credentials (id, password_hash, must_change_password) VALUES (1, $1, true) ON CONFLICT (id) DO NOTHING',
    [hash]
  );
}

async function verifyPassword(password) {
  if (typeof password !== 'string' || password.length === 0) return false;
  const { rows } = await pool.query('SELECT password_hash FROM admin_credentials WHERE id = 1');
  if (rows.length === 0) return false;
  return bcrypt.compare(password, rows[0].password_hash);
}

async function mustChangePassword() {
  const { rows } = await pool.query('SELECT must_change_password FROM admin_credentials WHERE id = 1');
  return rows.length > 0 ? rows[0].must_change_password : false;
}

async function setPassword(newPassword) {
  const hash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  await pool.query(
    'UPDATE admin_credentials SET password_hash = $1, must_change_password = false, updated_at = now() WHERE id = 1',
    [hash]
  );
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

module.exports = { ensureAdminSeeded, verifyPassword, mustChangePassword, setPassword, requireAdmin };
