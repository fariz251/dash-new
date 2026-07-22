const { sql } = require('../../lib/db');

module.exports = async (req, res) => {
  const token = req.headers['x-admin-secret'];
  if (!process.env.ADMIN_SECRET || token !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method tidak didukung' });

  const { shop, partner_id, partner_key } = req.body || {};
  if (!shop || !partner_id || !partner_key) {
    return res.status(400).json({ error: 'shop, partner_id, partner_key wajib diisi' });
  }

  try {
    const result = await sql`
      UPDATE shops SET partner_id = ${Number(partner_id)}, partner_key = ${partner_key}, updated_at = now()
      WHERE code = ${shop}
      RETURNING code, name
    `;
    if (result.length === 0) return res.status(404).json({ error: `Toko dengan code '${shop}' tidak ditemukan di tabel shops` });
    res.status(200).json({ ok: true, shop: result[0] });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan partner_id/partner_key', detail: err.message });
  }
};
