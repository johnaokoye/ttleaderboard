require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const { checkPassword, requireAdmin } = require('./auth');
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

app.post('/api/admin/login', (req, res) => {
  if (!checkPassword(req.body.password)) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  req.session.isAdmin = true;
  res.json({ authenticated: true });
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ authenticated: false }));
});

app.get('/api/admin/session', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.isAdmin) });
});

app.use('/api', publicRoutes);
app.use('/api/admin', requireAdmin, adminRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.listen(PORT, () => {
  console.log(`Leaderboard app listening on port ${PORT}`);
});
