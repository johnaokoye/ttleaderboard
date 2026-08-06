const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'error', message: err.message });
  }
});

router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query('SELECT name, mode FROM competition WHERE id = 1');
    res.json(rows[0] || { name: '', mode: 'individual' });
  })
);

router.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const { kind } = req.query;
    if (kind !== 'team' && kind !== 'individual') {
      return res.status(400).json({ error: 'kind must be team or individual' });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 100);

    if (kind === 'individual') {
      const { rows } = await pool.query(
        'SELECT id, name, score, created_at, updated_at FROM individuals ORDER BY score DESC, created_at ASC LIMIT $1',
        [limit]
      );
      return res.json(rows);
    }

    // A team's score is derived from its individuals' scores once it has any assigned;
    // otherwise it falls back to its own manually-set score (team-only competitions).
    const { rows } = await pool.query(
      `SELECT
         t.id,
         t.name,
         (CASE WHEN COUNT(i.id) > 0 THEN COALESCE(SUM(i.score), 0) ELSE t.score END)::int AS score,
         t.created_at,
         GREATEST(t.updated_at, COALESCE(MAX(i.updated_at), t.updated_at)) AS updated_at
       FROM teams t
       LEFT JOIN individuals i ON i.team_id = t.id
       GROUP BY t.id
       ORDER BY score DESC, t.created_at ASC
       LIMIT $1`,
      [limit]
    );
    res.json(rows);
  })
);

router.get(
  '/teams/:id/individuals',
  asyncHandler(async (req, res) => {
    const teamId = parseInt(req.params.id, 10);
    if (!Number.isInteger(teamId)) {
      return res.status(400).json({ error: 'invalid team id' });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const { rows } = await pool.query(
      'SELECT id, name, score, created_at, updated_at FROM individuals WHERE team_id = $1 ORDER BY score DESC, created_at ASC LIMIT $2',
      [teamId, limit]
    );
    res.json(rows);
  })
);

module.exports = router;
