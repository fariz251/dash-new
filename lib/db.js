const { neon } = require('@neondatabase/serverless');

// DATABASE_URL diisi di Vercel > Project Settings > Environment Variables
// Gunakan connection string "pooled" dari Neon (ada kata "-pooler" di host)
const sql = neon(process.env.DATABASE_URL);

module.exports = { sql };
