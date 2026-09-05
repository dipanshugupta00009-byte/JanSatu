/**
 * Creates (or promotes) an admin account directly in the Postgres database.
 * Run this on the server itself (or against Supabase) — never exposed as a
 * public API route.
 *
 * Usage:
 *   node db/create-admin.js "Admin Name" admin@example.com "StrongPass123"
 */
require('dotenv').config();
const crypto = require('crypto');
const { query, pool } = require('./pool');

function hashPassword(password) {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  const [name, email, password] = process.argv.slice(2);
  if (!name || !email || !password) {
    console.error('Usage: node db/create-admin.js "Admin Name" admin@example.com "StrongPass123"');
    process.exit(1);
  }
  if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    console.error('Password must be at least 8 characters and include a letter and a number.');
    process.exit(1);
  }

  const existing = await query('SELECT id FROM users WHERE lower(email) = lower($1)', [email]);
  if (existing.rows.length) {
    await query("UPDATE users SET role = 'admin' WHERE id = $1", [existing.rows[0].id]);
    console.log(`Existing account ${email} promoted to admin.`);
  } else {
    const password_hash = hashPassword(password);
    await query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,'admin')`,
      [name, email, password_hash]
    );
    console.log(`Admin account created: ${email}`);
  }
  console.log('Done. Sign in at /admin-login.html');
  await pool.end();
}

main().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
