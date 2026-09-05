/**
 * Security utilities shared by both backends (server.js and server.sql.js).
 * Zero external dependencies — plain Node.js, so it doesn't break the
 * JSON-file prototype's "no npm install needed" promise.
 */

// ---------- Security headers ----------
// Applied to every response. TLS/HTTPS itself is handled by your hosting
// platform (Railway/Render/etc. all terminate HTTPS for you automatically)
// — these headers protect against clickjacking, MIME-sniffing, and give
// browsers extra XSS/referrer protection on top of that.
function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'geolocation=(self)'); // only this site can use Geolocation (submit.html's GPS button)
}

// CORS — defaults to '*' for easy local development, but you should set
// ALLOWED_ORIGIN in .env to your real domain once deployed, so only your
// own frontend can call the API with a logged-in user's token.
function corsOrigin() {
  return process.env.ALLOWED_ORIGIN || '*';
}

// ---------- In-memory rate limiter ----------
// Sliding-window limiter keyed by whatever string you give it (IP, or
// IP+email). Not distributed — fine for a single server instance, which
// is what this app runs as. Resets if the server restarts.
class RateLimiter {
  constructor(maxAttempts, windowMs) {
    this.maxAttempts = maxAttempts;
    this.windowMs = windowMs;
    this.hits = new Map(); // key -> array of timestamps
  }

  // Returns { allowed: boolean, retryAfterSeconds: number }
  check(key) {
    const now = Date.now();
    const timestamps = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (timestamps.length >= this.maxAttempts) {
      const oldest = timestamps[0];
      const retryAfterSeconds = Math.ceil((this.windowMs - (now - oldest)) / 1000);
      this.hits.set(key, timestamps);
      return { allowed: false, retryAfterSeconds };
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  // Call on a successful login to clear the counter early (so a real user
  // who mistypes their password a couple of times isn't punished after
  // they get it right).
  reset(key) {
    this.hits.delete(key);
  }
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

// ---------- Input validation ----------
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 255 && EMAIL_RE.test(email);
}

// At least 8 characters, at least one letter and one number.
// Deliberately not more aggressive than that — this is a civic platform
// for the general public, not a bank; usability matters.
function isStrongPassword(password) {
  return typeof password === 'string' &&
    password.length >= 8 && password.length <= 200 &&
    /[a-zA-Z]/.test(password) && /[0-9]/.test(password);
}

// Trim + hard-cap length on any free-text field, so a malicious or buggy
// client can't send a 5MB "title" and bloat the database.
function sanitizeText(value, maxLen) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, maxLen);
}

module.exports = {
  applySecurityHeaders, corsOrigin, RateLimiter, clientIp,
  isValidEmail, isStrongPassword, sanitizeText
};
