# Using the Total Tools Leaderboard

This guide is for whoever runs the competition — setting it up, keeping scores updated, and wrapping it up at the end. If you're looking for technical/deployment details instead, see `README.md` and `CLAUDE.md`.

## The two pages

- **Public board** — `http://<your-server>:8082/` — this is the leaderboard everyone sees (in-store display, shared link, etc.). Read-only, no login.
- **Admin panel** — `http://<your-server>:8082/admin/` — where you set everything up and keep scores current. Password-protected.

## Signing in for the first time

1. Go to the admin panel.
2. Sign in with the default password: `change-me`
3. You'll be dropped straight into a **Set a new password** screen — nothing else is usable until you do this. Enter the default password as your "current password," then choose and confirm a new one (at least 8 characters).
4. Once submitted, the full dashboard unlocks immediately — no need to sign in again.

You can change your password again any time later from the **Security** card at the top of the dashboard.

**Forgot your password?** There's no email reset — you'll need someone with access to the server's database to clear the stored credential, which puts it back to `change-me` and forces a new password on next login. Ask whoever deployed the app for help with this.

## Setting up a competition

In the **Competition** card:

1. **Competition name** — shown on the public board under the logo (e.g. "August Sales Sprint").
2. **Mode** — this decides what the public board shows:
   - **Teams only** — just a team leaderboard.
   - **Individuals only** — just an individual leaderboard.
   - **Both** — a team leaderboard *and* an individual leaderboard. Visitors can click any team to drill into that team's members' scores. A team's score in this mode is automatically the total of its members' scores (see below).
3. Click **Save settings**.

You can change the mode at any time — teams and individuals aren't deleted when you switch modes, they just stop/start being shown.

## Teams and individuals

### Adding

- **Teams** card: type a name, optionally a starting score, click **Add team**.
- **Individuals** card: type a name, optionally assign a team from the dropdown, optionally a starting score, click **Add individual**.

### Awarding points

Find the person or team's row and use the **Award points** box — type a number and click **Award**. This *adds* to their current score (type a negative number to subtract, e.g. for a correction).

**Important — how team scores work in "Both" mode:** the moment a team has one or more individuals assigned to it, that team's score becomes the *sum of its members' scores* and updates automatically — you'll see "Auto — N members" instead of an Award box for that team. **Award points to the individual members, not the team, once a team has anyone assigned to it.** You'll only see a normal Award box on a team that has zero members (relevant for "Teams only" competitions with no individuals at all).

One thing to know: if you award a team points *before* it has any members, and then assign it a member, that manual score is replaced by the member's score — not added to it. Award members first, or don't award a team directly if you know it'll get members later.

### Reassigning someone to a different team

Use the **Team** dropdown on that person's row in the Individuals table — it saves automatically when you change it.

### Renaming or deleting

Use the **Rename**/**Delete** buttons on the relevant row.

- Deleting a **team** does *not* delete its individuals — they just become teamless (and keep showing on the individual leaderboard).
- Deleting an **individual** is permanent.

## Ending a competition

The **Reset** card at the bottom has two options — pick carefully, the second one can't be undone:

- **Reset scores** — sets every score back to 0, but keeps all your teams, individuals, and team assignments. Use this if you're running the *same* roster again for a new round.
- **Reset everything** — permanently deletes all teams and individuals, for a completely clean slate with a new roster next time.

## What visitors see on the public board

- The competition name and the relevant leaderboard(s), based on the mode you set.
- A trophy next to whoever's in 1st place, and a "Last Updated" time stamp on each board.
- In **Both** mode: a note below the boards says *"Select a team above to see the scores for that team's members"* — clicking any team row shows that team's individual members underneath, without leaving the page.

The board refreshes when the page loads — if you're awarding points live while someone has the board open on a screen, they'll need to refresh to see the update.
