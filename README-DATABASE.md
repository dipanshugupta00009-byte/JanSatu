# Connecting the database, backend and frontend (PostgreSQL / Supabase)

## How the three pieces talk to each other

```
Frontend (public/*.html, public/js/*.js)
        │  fetch('/api/...')
        ▼
server.sql.js  (Node.js, no frameworks)
        │  SQL over TCP (with SSL for Supabase)
        ▼
PostgreSQL  (Supabase, or any Postgres host)
```

- The frontend never talks to the database directly — it only calls `fetch()`
  against `/api/...` routes.
- `server.sql.js` serves the frontend files AND answers the API — same file
  as always, no changes needed there.
- `db/queries.js` holds every SQL statement.
- `db/pool.js` is the actual connection (works with Supabase, Railway
  Postgres, Render Postgres, or a local install — same code, different
  `DATABASE_URL`).
- `db/schema.sql` creates every table and seeds categories + sample
  institutions.

## Setup — Supabase (recommended, no local install needed)

1. **supabase.com** → free account → **New Project**. Pick a name, a
   database password (save it), and a region close to your users.
2. Once the project is ready: **Project Settings → Database → Connection
   string → URI**. Copy it — it looks like:
   `postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxx.supabase.co:5432/postgres`
3. **Create the tables — no CLI needed:** in the Supabase dashboard, open
   **SQL Editor → New query**, paste the entire contents of `db/schema.sql`,
   and click **Run**. You should see "Success. No rows returned."
4. In your project's `.env` (or your hosting platform's environment
   variables), set:
   ```
   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.xxxxxxxx.supabase.co:5432/postgres
   ```
5. Install dependencies once: `npm install` (installs `pg` + `dotenv`).
6. Start the server: `npm start` → open the site.

## Setup — any other Postgres host (Railway, Render, local install)

Same as above, but:
- If deploying the **app itself** on Railway/Render too, set `DATABASE_URL`
  as an environment variable on that service (not just in a local `.env`).
- For a **local Postgres install** instead of a hosted one, leave
  `DATABASE_URL` blank and fill in `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD`
  in `.env` instead — then run `npm run migrate` to apply `db/schema.sql`
  (this does locally what the Supabase SQL Editor does in the cloud).

## What to check first

After registering an account and submitting a challenge on the site, open
Supabase's **Table Editor** (or run in the SQL Editor):
```sql
SELECT display_id, title, status FROM problems ORDER BY created_at DESC LIMIT 5;
SELECT name, email, role FROM users;
```
If your submissions show up, the database is working end to end.

## Files

| File | Role |
|---|---|
| `db/schema.sql` | table definitions + seed data — paste into Supabase SQL Editor, or run via `npm run migrate` |
| `db/pool.js` | Postgres connection pool (handles Supabase's SSL requirement automatically) |
| `db/queries.js` | every SQL statement, one function per operation |
| `db/migrate.js` | applies `db/schema.sql` from the command line (alternative to the Supabase SQL Editor) |
| `server.sql.js` | the SQL-backed server |

The MySQL version of this backend (from an earlier iteration) is kept in
`db-mysql/` for reference, but isn't used by `npm start` anymore —
`server.sql.js` now requires `db/queries.js`, which is the Postgres version.

The JSON-file prototype (`server.js`) is still there too — `npm run
start:json` — no database needed at all, good for quick local testing.
