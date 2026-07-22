const { sql } = require('../lib/db');

function checkAdmin(req) {
  const token = req.headers['x-admin-secret'];
  return process.env.ADMIN_SECRET && token === process.env.ADMIN_SECRET;
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    const { shop } = req.query;
    if (!shop) return res.status(400).json({ error: 'Parameter shop wajib diisi' });
    try {
      const shopRows = await sql`SELECT id FROM shops WHERE code = ${shop}`;
      if (shopRows.length === 0) return res.status(404).json({ error: 'Toko tidak ditemukan' });
      const rows = await sql`
        SELECT model_id, sku_variasi, product_name, hpp, updated_at
        FROM sku_hpp WHERE shop_id = ${shopRows[0].id} ORDER BY updated_at DESC`;
      return res.status(200).json({ rows });
    } catch (err) {
      return res.status(500).json({ error: 'Gagal mengambil data HPP', detail: err.message });
    }
  }

  // POST & DELETE = perubahan data, wajib token admin
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized - token admin salah/kosong' });

  if (req.method === 'POST') {
    const { shop, model_id, sku_variasi, product_name, hpp } = req.body;
    if (!shop || !model_id || hpp === undefined) {
      return res.status(400).json({ error: 'shop, model_id, hpp wajib diisi' });
    }
    try {
      const shopRows = await sql`SELECT id FROM shops WHERE code = ${shop}`;
      if (shopRows.length === 0) return res.status(404).json({ error: 'Toko tidak ditemukan' });
      const shopId = shopRows[0].id;
      await sql`
        INSERT INTO sku_hpp (shop_id, model_id, sku_variasi, product_name, hpp, updated_at)
        VALUES (${shopId}, ${model_id}, ${sku_variasi || null}, ${product_name || null}, ${hpp}, now())
        ON CONFLICT (shop_id, model_id)
        DO UPDATE SET sku_variasi = EXCLUDED.sku_variasi, product_name = EXCLUDED.product_name,
                      hpp = EXCLUDED.hpp, updated_at = now()`;
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Gagal menyimpan HPP', detail: err.message });
    }
  }

  if (req.method === 'DELETE') {
    const { shop, model_id } = req.body;
    if (!shop || !model_id) return res.status(400).json({ error: 'shop, model_id wajib diisi' });
    try {
      const shopRows = await sql`SELECT id FROM shops WHERE code = ${shop}`;
      if (shopRows.length === 0) return res.status(404).json({ error: 'Toko tidak ditemukan' });
      await sql`DELETE FROM sku_hpp WHERE shop_id = ${shopRows[0].id} AND model_id = ${model_id}`;
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(500).json({ error: 'Gagal menghapus HPP', detail: err.message });
    }
  }

  res.status(405).json({ error: 'Method tidak didukung' });
};
