const { sql } = require('../lib/db');

module.exports = async (_req, res) => {
  try {
    const rows = await sql`SELECT code, name FROM shops ORDER BY name`;
    res.status(200).json({ rows });
  } catch (err) {
    res.status(500).json({ error: 'Gagal mengambil daftar toko', detail: err.message });
  }
};
