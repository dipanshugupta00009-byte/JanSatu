# Security Features — What Was Added & How It Was Tested

## What's in `security.js` (shared by both `server.js` and `server.sql.js`)

| Feature | What it protects against | Tested? |
|---|---|---|
| **Rate limiting** (5 login attempts / 15 min, 10 registrations / hour per IP) | Brute-force password guessing, spam account creation | ✅ Yes — see below |
| **Security headers** (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy) | Clickjacking, MIME-sniffing attacks, leaking full URLs to other sites | ✅ Yes — see below |
| **Server-side input validation** (email format, password strength, field length caps) | Garbage/malicious data reaching the database, oversized payloads | ✅ Yes — see below |
| **Configurable CORS** (`ALLOWED_ORIGIN`) | Other websites calling your API using a stolen/leaked token | Set this once deployed — see .env.example |
| **Parameterized SQL queries** (already existed — `$1`/`?` placeholders everywhere) | SQL injection | ✅ Confirmed — no raw string concatenation anywhere in `db/queries.js` |
| **Frontend HTML-escaping** (already existed — `escapeHtml()` in every page) | Cross-site scripting (XSS) via a submitted title/description | ✅ Yes — see below |
| **Password hashing** (already existed — pbkdf2, 10,000 iterations, per-user salt) | Passwords being readable even if the database is ever exposed | Unchanged, already solid |

## What was actually tested (not just written — run and verified)

**1. Security headers are present:**
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(self)
```

**2. Weak passwords rejected:** `"abc"` → `400 Password must be at least 8 characters and include a letter and a number.`

**3. Invalid emails rejected:** `"not-an-email"` → `400 Please enter a valid email address.`

**4. Brute-force login blocked:** 5 wrong-password attempts return `401`; the 6th onward returns `429 Too many failed sign-in attempts` — even a *correct* password is blocked once the limit is hit, which is the point.

**5. Genuine users aren't punished:** 2 typos followed by the correct password still succeeds (`200`) — the counter resets on a successful login instead of piling up.

**6. Injection-style input doesn't crash the server:** an email field containing `' OR 1=1--` just fails login normally (`401`), no server error, no odd behavior.

**7. XSS payload confirmed harmless in a real browser:** submitted a challenge with the title `<img src=x onerror=alert(1)>XSS Test` and description `<script>document.title="HACKED"</script>`. Loaded the Browse page in an actual headless browser afterward:
   - No JavaScript alert fired
   - Page title stayed normal (wasn't hijacked to "HACKED")
   - The payload displayed as plain, harmless text on the page

## Admin accounts — separate on purpose

Admin is the most powerful role (only admins can assign a challenge to an
institution), so it's **not** offered as a public sign-up option anymore —
`auth.html` only lets people register as citizen, institution, or industry.
The backend rejects `role: "admin"` on `/api/auth/register` too, even if
called directly.

**To create the first admin account:**
```
node create-admin.js "Admin Name" admin@example.com "StrongPass123"
```
(or `node db/create-admin.js ...` for the Postgres/Supabase version)

⚠️ **JSON-file version only:** if the server is already running, **restart
it** after running this script — `server.js` keeps its data in memory and
only reads `data/db.json` once at startup, so it won't see the new admin
account until it restarts. The Postgres version doesn't have this issue
since every request reads live from the database.

Admins sign in separately at **`/admin-login.html`** (linked quietly in the
homepage footer) — not through the public `/auth.html`. That page rejects
any account that isn't role `admin`, even with a correct password, and
signs them back out immediately with a clear message.

## What you should still do yourself before a real public launch

- **Set `ALLOWED_ORIGIN`** in your deployment's environment variables to your actual frontend URL, so browsers block any other website from using a stolen token against your API.
- **Never commit `.env`** to GitHub (already covered by `.gitignore`).
- **Rotate `ANTHROPIC_API_KEY`** if it's ever accidentally exposed (e.g. pasted publicly).
- The rate limiter is in-memory per server instance — fine for a single Railway/Render service, but if you ever run multiple instances behind a load balancer, move it to Redis instead so all instances share the same counters.
