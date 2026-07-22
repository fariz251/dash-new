const { sql } = require('../../lib/db');

function mask(value) {
  if (!value) return '(kosong)';
  const s = String(value);
  if (s.length <= 6) return `${s[0]}***${s[s.length - 1]} (panjang: ${s.length})`;
  return `${s.slice(0, 3)}...${s.slice(-3)} (panjang: ${s.length})`;
}

module.exports = async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.query.admin_secret;
  if (!process.env.ADMIN_SECRET || token !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // GET tanpa partner_id/partner_key = mode CEK nilai yg sudah tersimpan (masked, aman ditempel ke chat)
  if (req.method === 'GET' && !req.query.partner_id && !req.query.partner_key) {
    const shop = req.query.shop;
    if (!shop) return res.status(400).json({ error: 'Parameter shop wajib diisi' });
    const rows = await sql`SELECT code, partner_id, partner_key FROM shops WHERE code = ${shop}`;
    if (rows.length === 0) return res.status(404).json({ error: `Toko '${shop}' tidak ditemukan` });
    return res.status(200).json({
      shop,
      partner_id_tersimpan: rows[0].partner_id || '(kosong)',
      partner_key_tersimpan: mask(rows[0].partner_key),
    });
  }

  // GET dengan partner_id & partner_key (lewat address bar browser, aman dari masalah escaping quote di Windows)
  // ATAU POST dengan JSON body (cara lama, masih didukung)
  const source = req.method === 'GET' ? req.query : (req.body || {});
  const { shop, partner_id, partner_key } = source;
  if (!shop || !partner_id || !partner_key) {
    return res.status(400).json({ error: 'shop, partner_id, partner_key wajib diisi' });
  }

  try {
    const result = await sql`
      UPDATE shops SET partner_id = ${Number(partner_id)}, partner_key = ${String(partner_key).trim()}, updated_at = now()
      WHERE code = ${shop}
      RETURNING code, name, partner_id
    `;
    if (result.length === 0) return res.status(404).json({ error: `Toko dengan code '${shop}' tidak ditemukan di tabel shops` });
    res.status(200).json({
      ok: true,
      shop: result[0],
      partner_key_tersimpan: mask(partner_key),
      catatan: 'Cek partner_key_tersimpan di atas - cocokkan panjang & 3 huruf awal/akhir dgn App Shopee Anda',
    });
  } catch (err) {
    res.status(500).json({ error: 'Gagal menyimpan partner_id/partner_key', detail: err.message });
  }
};
