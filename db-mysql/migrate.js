/**
 * Run once to create the database, tables, and seed data.
 *   npm run migrate
 * (No need to create the database yourself first — schema.sql does that.)
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function main() {
  const connectionString = process.env.MYSQL_URL || process.env.DATABASE_URL;
  const connection = connectionString
    ? await mysql.createConnection({ uri: connectionString, multipleStatements: true })
    : await mysql.createConnection({
        host: process.env.MYSQL_HOST || 'localhost',
        port: process.env.MYSQL_PORT || 3306,
        user: process.env.MYSQL_USER || 'root',
        password: process.env.MYSQL_PASSWORD || '',
        multipleStatements: true // schema.sql has many statements in one file
      });

  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');

  console.log('Connected. Applying db/schema.sql ...');
  try {
    await connection.query(sql);
    console.log('✔ Schema applied successfully (database + tables created, categories + sample institutions seeded).');
  } catch (err) {
    console.error('✘ Migration failed:', err.message);
    process.exitCode = 1;
  } finally {
    await connection.end();
  }
}

main();
