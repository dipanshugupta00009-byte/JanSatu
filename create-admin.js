/**
 * Creates (or promotes) an admin account directly in data/db.json.
 * Run this on the server itself — never exposed as a public API route.
 *
 * Usage:
 *   node create-admin.js "Admin Name" admin@example.com "StrongPass123"
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, 'data', 'db.json');

function hashPassword(password) {
  const salt = crypto.randomBytes(8).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 10000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

const [name, email, password] = process.argv.slice(2);
if (!name || !email || !password) {
  console.error('Usage: node create-admin.js "Admin Name" admin@example.com "StrongPass123"');
  process.exit(1);
}
if (password.length < 8 || !/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
  console.error('Password must be at least 8 characters and include a letter and a number.');
  process.exit(1);
}

if (!fs.existsSync(DB_PATH)) {
  console.error(`No database found at ${DB_PATH} — start the server once first (node server.js) so it initializes.`);
  process.exit(1);
}

const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
const existing = db.users.find((u) => u.email.toLowerCase() === email.toLowerCase());

if (existing) {
  existing.role = 'admin';
  console.log(`Existing account ${email} promoted to admin.`);
} else {
  db.users.push({
    id: 'u-' + crypto.randomBytes(6).toString('hex'),
    name, email, phone: '', role: 'admin',
    organization: '', district: '',
    password: hashPassword(password),
    createdAt: new Date().toISOString()
  });
  console.log(`Admin account created: ${email}`);
}

fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
console.log('Done. Sign in at /admin-login.html');
