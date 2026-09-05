/**
 * Database connection pool (PostgreSQL — works with Supabase, Railway
 * Postgres, Render Postgres, or a local Postgres install).
 * Reads connection details from environment variables (see .env.example).
 */
require('dotenv').config();
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

// Cloud Postgres providers (Supabase included) require SSL. Local installs
// usually don't have it set up, so we only turn SSL on when a connection
// string is used and it doesn't point at localhost, unless PGSSL overrides it.
function wantsSSL() {
  if (process.env.PGSSL === 'true') return true;
  if (process.env.PGSSL === 'false') return false;
  return !!connectionString && !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1');
}

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: wantsSSL() ? { rejectUnauthorized: false } : false
    })
  : new Pool({
      host: process.env.PGHOST || 'localhost',
      port: process.env.PGPORT || 5432,
      database: process.env.PGDATABASE || 'jansatu',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres'
    });

pool.on('error', (err) => {
  console.error('Unexpected error on idle Postgres client', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(), // for multi-statement transactions
  pool
};
