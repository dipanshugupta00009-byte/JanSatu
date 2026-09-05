/**
 * Standalone test — checks ONLY whether DATABASE_URL can connect.
 * Does not touch tables, does not need the rest of the app.
 *
 * Usage (Windows PowerShell):
 *   $env:DATABASE_URL="paste your full connection string here"
 *   node db/test-connection.js
 */
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.log('✘ DATABASE_URL is not set. Set it first, then run this again.');
  process.exit(1);
}

// Show what we're about to try, with the password hidden, so you can
// visually confirm the string looks right before we even attempt to connect.
const masked = connectionString.replace(/:([^:@]+)@/, ':****@');
console.log('Trying to connect with:', masked);

const wantsSSL = !connectionString.includes('localhost');
const client = new Client({
  connectionString,
  ssl: wantsSSL ? { rejectUnauthorized: false } : false
});

client.connect()
  .then(async () => {
    const res = await client.query('SELECT NOW()');
    console.log('✔ SUCCESS — connected to the database.');
    console.log('  Server time:', res.rows[0].now);
    await client.end();
    process.exit(0);
  })
  .catch((err) => {
    console.log('✘ FAILED —', err.message);
    if (err.code) console.log('  Error code:', err.code);
    process.exit(1);
  });
