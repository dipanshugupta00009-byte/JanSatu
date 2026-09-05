/**
 * Database connection pool (MySQL).
 * Reads connection details from environment variables (see .env.example).
 * Every other file imports { query, getConnection } from here — nothing
 * else touches mysql2 directly.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

// Most cloud hosts (Railway, PlanetScale, Aiven, etc.) hand you a single
// connection string instead of separate host/user/password variables.
// Support both: use MYSQL_URL/DATABASE_URL if present, otherwise fall back
// to the discrete MYSQL_* variables from .env.example.
const connectionString = process.env.MYSQL_URL || process.env.DATABASE_URL;

const pool = connectionString
  ? mysql.createPool({
      uri: connectionString,
      waitForConnections: true,
      connectionLimit: 10,
      decimalNumbers: true
    })
  : mysql.createPool({
      host: process.env.MYSQL_HOST || 'localhost',
      port: process.env.MYSQL_PORT || 3306,
      database: process.env.MYSQL_DATABASE || 'jansatu',
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      waitForConnections: true,
      connectionLimit: 10,
      decimalNumbers: true // return DECIMAL columns (latitude/longitude) as JS numbers, not strings
    });

module.exports = {
  // returns rows only (not the [rows, fields] tuple mysql2 normally gives back)
  query: async (sql, params) => {
    const [rows] = await pool.query(sql, params);
    return rows;
  },
  getConnection: () => pool.getConnection(), // for multi-statement transactions
  pool
};
