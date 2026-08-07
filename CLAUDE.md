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

The app is on host port **8082** (mapped to container port 3000 in `docker-compose.yml`) — 3000/5000/5432/8080 were already bound on the host dev machine. Adjust the `ports` mapping in `docker-compose.yml` if that changes.

Both services have `restart: unless-stopped`. This matters more than it looks: `depends_on: condition: service_healthy` on `app` is a **Compose-only** feature — if this stack is deployed to Docker Swarm (which is what Portainer's "Stacks" typically run under), Swarm silently ignores that condition and starts `app` and `db` with no ordering guarantee. Combined with `asyncHandler` (below) not existing at some point in this app's history, a request landing before Postgres was ready used to crash the whole container permanently. The restart policy is the real safety net under Swarm; don't remove it on the assumption that `depends_on` is doing that job.

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
- `src/auth.js` — admin credentials live in the `admin_credentials` table (bcrypt hash + `must_change_password` flag), not just an env var. `ensureAdminSeeded()` runs `CREATE TABLE IF NOT EXISTS` **and** seeds the row (hashing `ADMIN_PASSWORD`) every time `/api/admin/login` is hit — this makes the whole feature self-healing on a database that predates this table, the same way `db/Dockerfile` fixed the schema-bind-mount incident (see below). `ADMIN_PASSWORD` therefore only matters for the very first login ever, or after someone deletes the `admin_credentials` row to force a reset — changing it in `docker-compose.yml`/Portainer afterward does nothing, since the DB is authoritative from that first login on. Single shared admin credential, not per-user accounts — sufficient for a small internal tool; revisit if multiple named admins are ever needed. `requireAdmin` middleware just checks `req.session.isAdmin`; the separate `must_change_password` enforcement lives in `routes/admin.js` (below), not here.
- `src/routes/public.js` — unauthenticated read endpoints: settings, leaderboards, a team's individuals.
- `src/routes/admin.js` — authenticated write endpoints: competition settings, teams/individuals CRUD + score awards, reset. Also has a `router.use()` guard at the top that 403s every route except `POST /change-password` while `must_change_password` is true — this is enforced here (server-side), not just hidden in `public/admin/`'s UI, so it can't be bypassed by calling the API directly.
- `src/db.js` — exports a shared `pg` `Pool` (`DATABASE_URL` env var), with `connectionTimeoutMillis: 5000` and `query_timeout: 8000` set explicitly. Without these, a network-level failure (route to Postgres exists but nothing responds — e.g. broken overlay networking under Swarm/Portainer) makes `pool.connect()`/`query()` hang **indefinitely** rather than reject, which then hangs the HTTP request, which then hangs the browser's `fetch()` (which also has no default timeout) — the symptom was the public page stuck forever on "Loading…" with no error anywhere. Verified by pointing a throwaway `Pool` at a black-holed IP (`10.255.255.1`) from inside the running container: it now rejects in ~5s instead of hanging. Don't remove these without adding an equivalent bound elsewhere.
- `src/asyncHandler.js` — wraps every async route handler in `routes/public.js` and `routes/admin.js` (except `/api/health`, which has its own try/catch). **This is load-bearing, not boilerplate**: Express 4 does not catch rejected promises from async handlers, so an unhandled DB error becomes an unhandled promise rejection, which crashes the whole Node process (Node's default behavior since v15). That crash previously took the container down for good — no restart policy was set, so it just stayed exited. Any new route handler that touches `pool.query` must be wrapped in `asyncHandler(...)`, or a single bad/slow query can kill the container again. `server.js` also has a final 4-arg error-handling middleware as a backstop that turns anything `asyncHandler` catches into a `500` instead of a crash.
- `db/init.sql` — schema, baked into a custom Postgres image at build time via `db/Dockerfile` (`COPY init.sql /docker-entrypoint-initdb.d/init.sql`), which the `db` service builds from (`build: ./db` in `docker-compose.yml`). It then auto-applies via the official image's docker-entrypoint-initdb.d mechanism **only on first container start with an empty volume**. If you change the schema, `docker compose down -v` to force re-init, or write a migration and apply it manually — there is no migration tool wired up.

  **This used to be a bind mount** (`./db/init.sql:/docker-entrypoint-initdb.d/init.sql`) instead of a build step, and it caused a real production incident: when deployed via Portainer, the bind mount's source path didn't resolve to the actual file (depends on how Portainer materializes the stack's working directory), and Docker's bind-mount behavior when a source path doesn't exist is to **silently create an empty directory** there instead of erroring. Postgres ended up with `/docker-entrypoint-initdb.d/init.sql` as an empty directory, so the schema was never created, and every query failed with `relation "X" does not exist` — indefinitely, across multiple redeploys, because nothing about that state was visibly wrong (no error at container start, just missing tables). Don't reintroduce a bind mount for this file; baking it into the image at build time means it's part of the image everywhere, with no path-resolution dependency on the deployment environment.
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
- `POST /api/admin/login` `{password}` → `{authenticated, mustChangePassword}`, `POST /api/admin/logout`, `GET /api/admin/session` → `{authenticated, mustChangePassword}` — auth lifecycle, defined directly in `server.js` (not `requireAdmin`-gated, since login must work while unauthenticated)
- `POST /api/admin/change-password {currentPassword, newPassword}` — `newPassword` min 8 chars; the only admin route reachable while `mustChangePassword` is true
- `GET/PUT /api/admin/settings` — competition name, `mode` (`team`|`individual`|`both`)
- `GET/POST /api/admin/teams`, `PATCH/DELETE /api/admin/teams/:id`, `POST /api/admin/teams/:id/award {points}` (adds `points` to current score, can be negative)
- `GET/POST /api/admin/individuals`, `PATCH/DELETE /api/admin/individuals/:id`, `POST /api/admin/individuals/:id/award {points}` — `PATCH` also handles team reassignment via `team_id` (nullable)
- `POST /api/admin/reset {scope: 'scores'|'all'}` — `scores` zeroes every score in place; `all` `TRUNCATE`s both `teams` and `individuals` (irreversible, no soft-delete)

## Data model

Four tables (three in `db/init.sql`; `admin_credentials` is created defensively by `src/auth.js` instead — see above):
- `admin_credentials` — singleton row (`id` fixed to `1`), `password_hash` (bcrypt) + `must_change_password`. Not seeded by `init.sql` since SQL can't compute a bcrypt hash; `ensureAdminSeeded()` does it from `ADMIN_PASSWORD` on first login.
- `competition` — singleton settings row (`id` fixed to `1` via a `CHECK` constraint), holds `name` and `mode`. `mode` drives what the public frontend renders — it is not enforced at the data layer, so admin-created teams/individuals persist regardless of mode and just aren't shown until mode changes.
- `teams` — `id`, `name`, `score`, `created_at`, `updated_at`. `score` is only the source of truth for a team with **no individuals assigned** (team-only competitions) — mutated in place there (`award` adds a delta, `PATCH` can set an absolute value). The instant a team has one or more individuals, its displayed score is **derived** at read time as `SUM(individuals.score)` for that team (see the `GROUP BY t.id` queries in `routes/public.js` and `routes/admin.js`), and the admin endpoints reject direct `score`/`award` writes on that team (`teamHasMembers()` guard in `routes/admin.js`, returns 400). This means once a team is emptied back out (all its individuals reassigned/deleted), its score falls back to whatever `teams.score` last held — usually a stale pre-assignment value, not the last computed sum. There's no history/audit trail of how a score was reached either way. It also means a team's manually-awarded score is **replaced, not preserved**, the moment it gets its first individual — award a team 50 points, then assign it one individual worth 30, and the team's displayed score becomes 30, not 80. This surprised a real user in practice; if the UX around this ever needs softening (e.g. folding the team's prior manual score into the derived total instead of discarding it), that's a schema change (need to track the "manual" and "derived" amounts separately), not just a query tweak.

`public/admin/app.js` must refresh the Teams panel (`loadTeams()`) after *any* action that changes an individual's score or team_id — award, delete, add, and team reassignment all go through `loadIndividualsAndTeams()` for this reason. A team row rendered before it had members still shows the "Award points" button; if you click Award on it after it's since gained a member elsewhere in the UI (without a refresh in between), the backend correctly 400s via `teamHasMembers()`, which looks like a bug but is just a stale read — this exact confusion is why both refreshes are now paired. If you add a new individuals-mutating action, pair it the same way.
- `individuals` — same shape plus `team_id` (nullable FK to `teams`, `ON DELETE SET NULL`). Deleting a team does not delete its individuals; they become teamless and keep showing in the individual leaderboard (and make that team's score directly editable again, if it still exists — deleting the team itself removes it entirely).

`init.sql` seeds sample data matching the original design mockup (Team Draxhall/Ocho Rios/Kingston with assigned individuals) so the UI has data and the "both" mode drill-down is demonstrable on first run.

## Frontend behavior

`public/app.js` fetches `/api/settings` on load and drives everything off `mode`:
- `team` → only the Teams board renders (centered via `.boards.single` in `style.css`, since the grid still reserves two columns otherwise).
- `individual` → only the Individuals board renders, showing the global individual leaderboard.
- `both` → both boards render; Individuals starts as a "select a team" hint and is only populated by clicking a team row (`GET /api/teams/:id/individuals`), not a global list. `state.selectedTeamId` tracks the highlighted row. A second, separate hint (`[data-select-team-hint]`, styled as `.select-team-hint` in `style.css`) sits centered below both boards and stays visible for the whole "both"-mode session (unlike the in-card hint, it doesn't hide once a team is selected) — it's explaining the overall interaction pattern, not just the empty state.

Score entry was intentionally moved out of the public page entirely (previously a public "add score" form) — all mutation now requires the admin session in `public/admin/`. There is no sharing/export feature on the public board (an Instagram share button existed briefly and was removed).

The "Last Updated" pill shows date and time (`formatDate()` in `app.js` uses `toLocaleString` with `hour`/`minute` options), driven by the `updated_at` column returned alongside each leaderboard row.

All frontend fetches go through `fetchJSON()` in `app.js`, which applies a 10s `AbortController` timeout and throws on a non-OK response — plain `fetch()` never times out on its own. `init()` is the one place that catches the resulting rejection and calls `showLoadError()`, which overwrites the `data-competition-name` tagline (normally "Loading…") with a visible error message. If you add a new top-level page-load fetch outside `init()`'s call chain, it needs its own failure path, or a hung/failed request will silently leave stale UI instead of surfacing anything.

## Frontend theme

Both `public/style.css` and `public/admin/style.css` implement a specific branded design (dark green background `#007e37`, gold `#f6c915` accents, pastel-green `#a9ddb4` highlight for 1st place, Poppins font, rounded white cards, "Last Updated" pill overlapping the card's bottom edge). Preserve this palette/layout when touching either stylesheet unless asked to change the design — it was matched from a provided mockup, not chosen arbitrarily.

The header logo (`public/images/logo.png`) is the user's actual brand asset, not a generic placeholder — it's a flat PNG with an opaque green background baked in (`#007e37`), so `--green` in both stylesheets is set to that exact value to keep it seamless against the page background. If the logo asset is ever replaced, re-sample its background color and update `--green` in both files to match, or the header will show a visible rectangular seam.

## Mobile

Both stylesheets have a mobile breakpoint (`public/style.css` at 480px, `public/admin/style.css` at 640px — chosen independently per page's own content, not meant to be kept in sync).

- `public/style.css`: shrinks the leaderboard row's `grid-template-columns` and, critically, drops `.row--header`'s font-size to 9px independently of the data rows — at the mobile column widths, matching the data row's 14px overflows "POSITION" into "NAME". If you widen those columns later, re-check whether the header still needs its own smaller size. The "Last Updated" pill also had a real overflow bug (`white-space: nowrap` on a 40+ character string on a narrow card) — fixed by giving it `max-width: calc(100% - 24px)` and letting it wrap; don't reintroduce `nowrap` there. Hover-triggered styles (row lift/shadow, background swap) are wrapped in `@media (hover: hover) and (pointer: fine)` so touch devices don't get stuck in a "hovered" state after a tap — touch feedback instead comes from `:active` rules outside that query.
- `public/admin/style.css`: below 640px, the CRUD tables (5-6 columns) stop being tables and become stacked cards — `thead` is hidden, every `tr`/`td` becomes `display: block`, and each `td::before { content: attr(data-label) }` prints a label sourced from a `data-label` attribute set in `admin/app.js`'s `renderTeams()`/`renderIndividuals()` template strings (not in the static HTML `<thead>`, which only serves the desktop table). **If you add a column to either table, you must add the matching `data-label` in `app.js`, or that field silently loses its label on mobile.** Between 640px and roughly 900px, tables aren't yet cards but might still be tight — `.table-wrap { overflow-x: auto }` around each `<table>` is a scroll-instead-of-break safety net for that range; the mobile media query resets `table`/`tr`/`td`'s `min-width` back to `0` there so the card layout isn't forced wide by the desktop table's `min-width: 480px`.

## Forced password change

First login after `admin_credentials` is seeded (fresh deploy, or after a manual reset) always comes back with `mustChangePassword: true`. `public/admin/app.js` reacts by adding a `password-locked` class to `#dashboard`, which CSS (`admin/style.css`) uses to hide every `.card` except `#security-card` — so the only thing usable is the change-password form. This is UI-level *and* server-level (the `router.use()` guard in `routes/admin.js` described above) — the UI hiding alone wouldn't stop someone hitting the API directly.

The `#security-card`/change-password form isn't only for the forced case — it's a normal part of the dashboard, always available, so there's an ongoing way to change the password later too, not just on first login.

**Forgotten password recovery**: there's no "reset via email" flow. Delete the row (`DELETE FROM admin_credentials WHERE id = 1;` via `psql` in the `db` container) and the next login attempt re-seeds it from `ADMIN_PASSWORD` with `must_change_password` true again — verified working live, including the case where the whole table is missing, not just the row.

## Security notes for future changes

- `ADMIN_PASSWORD` and `SESSION_SECRET` have insecure defaults baked into `docker-compose.yml` (`change-me` / `dev-only-session-secret-change-me`) so `docker compose up` works with zero setup. `SESSION_SECRET` still must be overridden before this is exposed beyond local dev (via a `.env` file next to `docker-compose.yml`, which Compose auto-loads). `ADMIN_PASSWORD` matters less now that a real password is forced on first login — but it's still the bootstrap value and the recovery-reset value, so don't leave it at `change-me` in anything that isn't purely local.
- The session cookie is not marked `secure`, since the default deployment target is plain HTTP on localhost. If this goes behind HTTPS, set that explicitly.
