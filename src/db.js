const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Without these, a network-level black hole (e.g. misconfigured overlay
  // networking) makes pool.connect()/query() hang forever instead of
  // erroring — which leaves any caller (including HTTP requests) hanging too.
  connectionTimeoutMillis: 5000,
  query_timeout: 8000,
});

module.exports = { pool };
