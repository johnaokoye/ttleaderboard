const express = require('express');
const { pool } = require('../db');
const asyncHandler = require('../asyncHandler');

const router = express.Router();

function validName(name) {
  return typeof name === 'string' && name.trim().length > 0 && name.length <= 64;
}

const DERIVED_SCORE_ERROR =
  'This team has individuals assigned — its score is derived from them. Award points to individuals instead.';

async function teamHasMembers(id) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM individuals WHERE team_id = $1', [id]);
  return rows[0].count > 0;
}

// --- Competition settings ---

router.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query('SELECT name, mode FROM competition WHERE id = 1');
    res.json(rows[0]);
  })
);

router.put(
  '/settings',
  asyncHandler(async (req, res) => {
    const { name, mode } = req.body;

    if (!validName(name)) {
      return res.status(400).json({ error: 'name must be a non-empty string up to 64 characters' });
    }
    if (!['team', 'individual', 'both'].includes(mode)) {
      return res.status(400).json({ error: 'mode must be team, individual, or both' });
    }

    const { rows } = await pool.query(
      `INSERT INTO competition (id, name, mode, updated_at)
       VALUES (1, $1, $2, now())
       ON CONFLICT (id) DO UPDATE SET name = $1, mode = $2, updated_at = now()
       RETURNING name, mode`,
      [name.trim(), mode]
    );
    res.json(rows[0]);
  })
);

// --- Teams ---

router.get(
  '/teams',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT
         t.id,
         t.name,
         (CASE WHEN COUNT(i.id) > 0 THEN COALESCE(SUM(i.score), 0) ELSE t.score END)::int AS score,
         COUNT(i.id)::int AS member_count,
         t.created_at,
         GREATEST(t.updated_at, COALESCE(MAX(i.updated_at), t.updated_at)) AS updated_at
       FROM teams t
       LEFT JOIN individuals i ON i.team_id = t.id
       GROUP BY t.id
       ORDER BY score DESC`
    );
    res.json(rows);
  })
);

router.post(
  '/teams',
  asyncHandler(async (req, res) => {
    const { name, score } = req.body;
    if (!validName(name)) {
      return res.status(400).json({ error: 'name must be a non-empty string up to 64 characters' });
    }
    const initialScore = Number.isInteger(score) ? score : 0;
    const { rows } = await pool.query(
      'INSERT INTO teams (name, score) VALUES ($1, $2) RETURNING id, name, score, created_at, updated_at',
      [name.trim(), initialScore]
    );
    res.status(201).json(rows[0]);
  })
);

router.patch(
  '/teams/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, score } = req.body;
    const sets = [];
    const values = [];

    if (name !== undefined) {
      if (!validName(name)) return res.status(400).json({ error: 'invalid name' });
      values.push(name.trim());
      sets.push(`name = $${values.length}`);
    }
    if (score !== undefined) {
      if (!Number.isInteger(score)) return res.status(400).json({ error: 'score must be an integer' });
      if (await teamHasMembers(id)) return res.status(400).json({ error: DERIVED_SCORE_ERROR });
      values.push(score);
      sets.push(`score = $${values.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' });

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE teams SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING id, name, score, created_at, updated_at`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'team not found' });
    res.json(rows[0]);
  })
);

router.post(
  '/teams/:id/award',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { points } = req.body;
    if (!Number.isInteger(points)) return res.status(400).json({ error: 'points must be an integer' });
    if (await teamHasMembers(id)) return res.status(400).json({ error: DERIVED_SCORE_ERROR });
    const { rows } = await pool.query(
      'UPDATE teams SET score = score + $1, updated_at = now() WHERE id = $2 RETURNING id, name, score, created_at, updated_at',
      [points, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'team not found' });
    res.json(rows[0]);
  })
);

router.delete(
  '/teams/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM teams WHERE id = $1', [id]);
    res.status(204).end();
  })
);

// --- Individuals ---

router.get(
  '/individuals',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT individuals.id, individuals.name, individuals.score, individuals.team_id,
              teams.name AS team_name, individuals.created_at, individuals.updated_at
       FROM individuals
       LEFT JOIN teams ON teams.id = individuals.team_id
       ORDER BY individuals.score DESC`
    );
    res.json(rows);
  })
);

router.post(
  '/individuals',
  asyncHandler(async (req, res) => {
    const { name, score, team_id } = req.body;
    if (!validName(name)) {
      return res.status(400).json({ error: 'name must be a non-empty string up to 64 characters' });
    }
    const initialScore = Number.isInteger(score) ? score : 0;
    const teamId = team_id === undefined || team_id === null || team_id === '' ? null : parseInt(team_id, 10);
    const { rows } = await pool.query(
      'INSERT INTO individuals (name, score, team_id) VALUES ($1, $2, $3) RETURNING id, name, score, team_id, created_at, updated_at',
      [name.trim(), initialScore, teamId]
    );
    res.status(201).json(rows[0]);
  })
);

router.patch(
  '/individuals/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { name, score, team_id } = req.body;
    const sets = [];
    const values = [];

    if (name !== undefined) {
      if (!validName(name)) return res.status(400).json({ error: 'invalid name' });
      values.push(name.trim());
      sets.push(`name = $${values.length}`);
    }
    if (score !== undefined) {
      if (!Number.isInteger(score)) return res.status(400).json({ error: 'score must be an integer' });
      values.push(score);
      sets.push(`score = $${values.length}`);
    }
    if (team_id !== undefined) {
      values.push(team_id === null || team_id === '' ? null : parseInt(team_id, 10));
      sets.push(`team_id = $${values.length}`);
    }
    if (sets.length === 0) return res.status(400).json({ error: 'nothing to update' });

    values.push(id);
    const { rows } = await pool.query(
      `UPDATE individuals SET ${sets.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING id, name, score, team_id, created_at, updated_at`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: 'individual not found' });
    res.json(rows[0]);
  })
);

router.post(
  '/individuals/:id/award',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const { points } = req.body;
    if (!Number.isInteger(points)) return res.status(400).json({ error: 'points must be an integer' });
    const { rows } = await pool.query(
      'UPDATE individuals SET score = score + $1, updated_at = now() WHERE id = $2 RETURNING id, name, score, team_id, created_at, updated_at',
      [points, id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'individual not found' });
    res.json(rows[0]);
  })
);

router.delete(
  '/individuals/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await pool.query('DELETE FROM individuals WHERE id = $1', [id]);
    res.status(204).end();
  })
);

// --- Reset ---

router.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const { scope } = req.body;
    if (scope !== 'scores' && scope !== 'all') {
      return res.status(400).json({ error: 'scope must be "scores" or "all"' });
    }

    if (scope === 'scores') {
      await pool.query('UPDATE teams SET score = 0, updated_at = now()');
      await pool.query('UPDATE individuals SET score = 0, updated_at = now()');
    } else {
      await pool.query('TRUNCATE individuals, teams RESTART IDENTITY');
    }
    res.json({ ok: true, scope });
  })
);

module.exports = router;
