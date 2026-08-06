# Leaderboard

A leaderboard API and web UI backed by Postgres, containerized with Docker, with a password-protected admin panel for managing teams, individuals, and competition settings.

## Run with Docker

```bash
docker compose up --build
```

The public board is at http://localhost:8080, the admin panel at http://localhost:8080/admin/. Postgres data persists in the `db_data` volume.

The admin login password defaults to `change-me` (see `docker-compose.yml`). Override it — and the session secret — before using this beyond local dev by creating a `.env` file next to `docker-compose.yml`:

```
ADMIN_PASSWORD=some-real-password
SESSION_SECRET=some-random-string
```

## Admin panel

At `/admin/`, sign in to:

- Name the competition and set its **mode** — Teams only, Individuals only, or Both (teams with individuals assigned to them, drillable from the public board)
- Add/rename/delete teams and individuals, assign individuals to teams
- Award points to any team or individual
- Reset scores to zero (keeping the roster) or wipe everything for a fresh competition

## Public API

- `GET /api/settings` — competition name, mode
- `GET /api/leaderboard?kind=team|individual&limit=10` — top scores for that kind, ranked descending
- `GET /api/teams/:id/individuals?limit=10` — individuals belonging to a team, ranked descending
- `GET /api/health` — health check

Write access (creating/editing scores, teams, individuals, and settings) is admin-only — see `/api/admin/...` in `CLAUDE.md`.

## Local development without Docker

```bash
npm install
cp .env.example .env   # point DATABASE_URL at a running Postgres instance, set ADMIN_PASSWORD/SESSION_SECRET
npm run dev
```
