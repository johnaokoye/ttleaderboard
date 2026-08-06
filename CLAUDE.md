# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A leaderboard API + web UI, with a password-protected admin panel for managing it. Node.js/Express backend, Postgres for storage, containerized with Docker and orchestrated via `docker-compose.yml` (`app` + `db` services).

## Commands

Run everything (app + Postgres) via Docker:

```bash
docker compose up --build       # foreground
docker compose up --build -d    # detached
docker compose down             # stop (keeps db_data volume)
docker compose down -v          # stop and wipe the database
```

The app is on host port **8080** (mapped to container port 3000 in `docker-compose.yml`) — chosen because 3000/5000/5432 were already bound on the host dev machine. Adjust the `ports` mapping in `docker-compose.yml` if that changes.

Local development without Docker (requires a reachable Postgres, e.g. `docker compose up db`):

```bash
npm install
cp .env.example .env   # set DATABASE_URL, ADMIN_PASSWORD, SESSION_SECRET
npm run dev             # node --watch
npm test                 # node --test (no tests written yet)
```

There is no separate build/lint step — plain CommonJS, no bundler or TypeScript compile.

## Architecture

- `src/server.js` — Express bootstrap: session middleware, login/logout/session routes, mounts `routes/public.js` at `/api` and `routes/admin.js` (behind `requireAdmin`) at `/api/admin`, then serves `public/` statically.
- `src/auth.js` — `checkPassword` (constant-time compare against `ADMIN_PASSWORD` env var) and `requireAdmin` middleware (checks `req.session.isAdmin`). Single shared admin password, not per-user accounts — sufficient for a small internal tool; revisit if multiple named admins are ever needed.
- `src/routes/public.js` — unauthenticated read endpoints: settings, leaderboards, a team's individuals.
- `src/routes/admin.js` — authenticated write endpoints: competition settings, teams/individuals CRUD + score awards, reset.
- `src/db.js` — exports a shared `pg` `Pool` (`DATABASE_URL` env var). All queries go through this pool directly; no ORM/query builder.
- `db/init.sql` — schema, auto-applied by the official `postgres` image's docker-entrypoint-initdb.d mechanism **only on first container start with an empty volume**. If you change the schema, either `docker compose down -v` to force re-init, or write a migration and apply it manually — there is no migration tool wired up.
- `public/` — public frontend (`index.html` + `app.js` + `style.css`), served directly by Express via `express.static`. No build step, no framework — plain DOM/fetch.
- `public/admin/` — admin frontend, same static-serving mechanism, reachable at `/admin/`. It's plain HTML/JS with no auth gate on the static files themselves — only the `/api/admin/*` calls it makes are protected; loading the page unauthenticated just shows a login form.

Sessions use `express-session`'s default in-memory store — sessions are lost on app restart/redeploy and won't work if this is ever scaled to multiple app instances. Fine for a single-container deployment; swap in a store (e.g. `connect-pg-simple` against the existing Postgres) before running more than one instance.

## API

Public (`/api/...`):
- `GET /api/health` — pings the DB, returns `{status}`
- `GET /api/settings` — `{name, mode}` for the current competition
- `GET /api/leaderboard?kind=team|individual&limit=10` — top scores for that kind, `ORDER BY score DESC, created_at ASC`, limit capped at 100. `kind` is required.
- `GET /api/teams/:id/individuals?limit=10` — individuals belonging to a team, same ordering

Admin (`/api/admin/...`, requires a session from `POST /api/admin/login`):
- `POST /api/admin/login` `{password}`, `POST /api/admin/logout`, `GET /api/admin/session` — auth lifecycle, defined directly in `server.js` (not `requireAdmin`-gated, since login must work while unauthenticated)
- `GET/PUT /api/admin/settings` — competition name, `mode` (`team`|`individual`|`both`)
- `GET/POST /api/admin/teams`, `PATCH/DELETE /api/admin/teams/:id`, `POST /api/admin/teams/:id/award {points}` (adds `points` to current score, can be negative)
- `GET/POST /api/admin/individuals`, `PATCH/DELETE /api/admin/individuals/:id`, `POST /api/admin/individuals/:id/award {points}` — `PATCH` also handles team reassignment via `team_id` (nullable)
- `POST /api/admin/reset {scope: 'scores'|'all'}` — `scores` zeroes every score in place; `all` `TRUNCATE`s both `teams` and `individuals` (irreversible, no soft-delete)

## Data model

Three tables in `db/init.sql`:
- `competition` — singleton settings row (`id` fixed to `1` via a `CHECK` constraint), holds `name` and `mode`. `mode` drives what the public frontend renders — it is not enforced at the data layer, so admin-created teams/individuals persist regardless of mode and just aren't shown until mode changes.
- `teams` — `id`, `name`, `score`, `created_at`, `updated_at`. `score` is only the source of truth for a team with **no individuals assigned** (team-only competitions) — mutated in place there (`award` adds a delta, `PATCH` can set an absolute value). The instant a team has one or more individuals, its displayed score is **derived** at read time as `SUM(individuals.score)` for that team (see the `GROUP BY t.id` queries in `routes/public.js` and `routes/admin.js`), and the admin endpoints reject direct `score`/`award` writes on that team (`teamHasMembers()` guard in `routes/admin.js`, returns 400). This means once a team is emptied back out (all its individuals reassigned/deleted), its score falls back to whatever `teams.score` last held — usually a stale pre-assignment value, not the last computed sum. There's no history/audit trail of how a score was reached either way.
- `individuals` — same shape plus `team_id` (nullable FK to `teams`, `ON DELETE SET NULL`). Deleting a team does not delete its individuals; they become teamless and keep showing in the individual leaderboard (and make that team's score directly editable again, if it still exists — deleting the team itself removes it entirely).

`init.sql` seeds sample data matching the original design mockup (Team Draxhall/Ocho Rios/Kingston with assigned individuals) so the UI has data and the "both" mode drill-down is demonstrable on first run.

## Frontend behavior

`public/app.js` fetches `/api/settings` on load and drives everything off `mode`:
- `team` → only the Teams board renders (centered via `.boards.single` in `style.css`, since the grid still reserves two columns otherwise).
- `individual` → only the Individuals board renders, showing the global individual leaderboard.
- `both` → both boards render; Individuals starts as a "select a team" hint and is only populated by clicking a team row (`GET /api/teams/:id/individuals`), not a global list. `state.selectedTeamId` tracks the highlighted row.

Score entry was intentionally moved out of the public page entirely (previously a public "add score" form) — all mutation now requires the admin session in `public/admin/`. There is no sharing/export feature on the public board (an Instagram share button existed briefly and was removed).

The "Last Updated" pill shows date and time (`formatDate()` in `app.js` uses `toLocaleString` with `hour`/`minute` options), driven by the `updated_at` column returned alongside each leaderboard row.

## Frontend theme

Both `public/style.css` and `public/admin/style.css` implement a specific branded design (dark green background `#007e37`, gold `#f6c915` accents, pastel-green `#a9ddb4` highlight for 1st place, Poppins font, rounded white cards, "Last Updated" pill overlapping the card's bottom edge). Preserve this palette/layout when touching either stylesheet unless asked to change the design — it was matched from a provided mockup, not chosen arbitrarily.

The header logo (`public/images/logo.png`) is the user's actual brand asset, not a generic placeholder — it's a flat PNG with an opaque green background baked in (`#007e37`), so `--green` in both stylesheets is set to that exact value to keep it seamless against the page background. If the logo asset is ever replaced, re-sample its background color and update `--green` in both files to match, or the header will show a visible rectangular seam.

## Mobile

Both stylesheets have a mobile breakpoint (`public/style.css` at 480px, `public/admin/style.css` at 640px — chosen independently per page's own content, not meant to be kept in sync).

- `public/style.css`: shrinks the leaderboard row's `grid-template-columns` and, critically, drops `.row--header`'s font-size to 9px independently of the data rows — at the mobile column widths, matching the data row's 14px overflows "POSITION" into "NAME". If you widen those columns later, re-check whether the header still needs its own smaller size. The "Last Updated" pill also had a real overflow bug (`white-space: nowrap` on a 40+ character string on a narrow card) — fixed by giving it `max-width: calc(100% - 24px)` and letting it wrap; don't reintroduce `nowrap` there. Hover-triggered styles (row lift/shadow, background swap) are wrapped in `@media (hover: hover) and (pointer: fine)` so touch devices don't get stuck in a "hovered" state after a tap — touch feedback instead comes from `:active` rules outside that query.
- `public/admin/style.css`: below 640px, the CRUD tables (5-6 columns) stop being tables and become stacked cards — `thead` is hidden, every `tr`/`td` becomes `display: block`, and each `td::before { content: attr(data-label) }` prints a label sourced from a `data-label` attribute set in `admin/app.js`'s `renderTeams()`/`renderIndividuals()` template strings (not in the static HTML `<thead>`, which only serves the desktop table). **If you add a column to either table, you must add the matching `data-label` in `app.js`, or that field silently loses its label on mobile.** Between 640px and roughly 900px, tables aren't yet cards but might still be tight — `.table-wrap { overflow-x: auto }` around each `<table>` is a scroll-instead-of-break safety net for that range; the mobile media query resets `table`/`tr`/`td`'s `min-width` back to `0` there so the card layout isn't forced wide by the desktop table's `min-width: 480px`.

## Security notes for future changes

- `ADMIN_PASSWORD` and `SESSION_SECRET` have insecure defaults baked into `docker-compose.yml` (`change-me` / `dev-only-session-secret-change-me`) so `docker compose up` works with zero setup. These **must** be overridden (via a `.env` file next to `docker-compose.yml`, which Compose auto-loads) before this is exposed beyond local dev.
- The session cookie is not marked `secure`, since the default deployment target is plain HTTP on localhost. If this goes behind HTTPS, set that explicitly.
