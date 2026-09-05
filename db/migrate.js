/**
 * Run once to create tables, seed categories/institutions, etc.
 *   npm run migrate
 *
 * On Supabase you don't even need this — you can paste db/schema.sql
 * directly into the Supabase dashboard's SQL Editor and click Run instead.
 * This script is here for local Postgres installs or other hosts.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const wantsSSL = process.env.PGSSL === 'true' ||
    (process.env.PGSSL !== 'false' && connectionString && !connectionString.includes('localhost') && !connectionString.includes('127.0.0.1'));

  const client = connectionString
    ? new Client({ connectionString, ssl: wantsSSL ? { rejectUnauthorized: false } : false })
    : new Client({
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT || 5432,
        database: process.env.PGDATABASE || 'jansatu',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres'
      });

  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');

  await client.connect();
  console.log('Connected. Applying db/schema.sql ...');
  try {
    await client.query(sql);
    console.log('✔ Schema applied successfully (tables created, categories + sample institutions seeded).');
  } catch (err) {
    console.error('✘ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
