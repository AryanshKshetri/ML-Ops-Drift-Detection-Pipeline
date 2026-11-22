import pg from "pg";
import { config } from "../config.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
});

pool.on("error", (err) => {
  // Neon closes idle connections when its compute suspends.
  // The pool opens a new connection on the next query, so do not exit.
  console.error("Idle PostgreSQL client error:", err.message);
});

export async function testConnection() {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT NOW()");
    console.log("Connected to PostgreSQL at:", res.rows[0].now);
  } finally {
    client.release();
  }
}