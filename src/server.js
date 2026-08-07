require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { ensureAdminSeeded, verifyPassword, mustChangePassword, requireAdmin } = require('./auth');
const asyncHandler = require('./asyncHandler');
const publicRoutes = require('./routes/public');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', maxAge: 1000 * 60 * 60 * 8 },
  })
);

app.post(
  '/api/admin/login',
  asyncHandler(async (req, res) => {
    await ensureAdminSeeded();
    const ok = await verifyPassword(req.body.password);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid password' });
    }
    req.session.isAdmin = true;
    res.json({ authenticated: true, mustChangePassword: await mustChangePassword() });
  })
);

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ authenticated: false }));
});

app.get(
  '/api/admin/session',
  asyncHandler(async (req, res) => {
    const isAdmin = !!(req.session && req.session.isAdmin);
    if (!isAdmin) return res.json({ authenticated: false });
    res.json({ authenticated: true, mustChangePassword: await mustChangePassword() });
  })
);

app.use('/api', publicRoutes);
app.use('/api/admin', requireAdmin, adminRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

// Last-resort handler: route handlers use asyncHandler to route DB/other errors
// here instead of crashing the process via an unhandled promise rejection.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Leaderboard app listening on port ${PORT}`);
});
