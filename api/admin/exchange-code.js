const { sql } = require('../../lib/db');
const { signAuthRequest } = require('../../lib/shopeeSign');
const { getShopConfig } = require('../../lib/shops');

module.exports = async (req, res) => {
  const token = req.headers['x-admin-secret'];
  if (!process.env.ADMIN_SECRET || token !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { shop, code, shop_id } = req.body || {};
  if (!shop || !code || !shop_id) {
    return res.status(400).json({ error: 'shop, code, shop_id wajib diisi (dari redirect URL setelah authorize)' });
  }

  const shopConfig = await getShopConfig(shop);
  if (!shopConfig) return res.status(404).json({ error: `Toko '${shop}' tidak ditemukan` });
  if (!shopConfig.partnerId || !shopConfig.partnerKey) {
    return res.status(400).json({ error: `partner_id/partner_key utk toko '${shop}' belum diisi. Isi dulu lewat POST /api/admin/set-partner` });
  }
  const partnerId = shopConfig.partnerId;
  const partnerKey = shopConfig.partnerKey;
  const path = '/api/v2/auth/token/get';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signAuthRequest({ partnerId, partnerKey, path, timestamp });

  const url = new URL(`https://partner.shopeemobile.com${path}`);
  url.searchParams.set('partner_id', partnerId);
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', sign);

  try {
    const resp = await fetch(url.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, shop_id: Number(shop_id), partner_id: Number(partnerId) }),
    }).then((r) => r.json());

    if (!resp.access_token) {
      return res.status(400).json({ error: resp.message || resp.error || 'Gagal tukar code, cek code/shop_id' });
    }

    const expiresAt = new Date(Date.now() + (resp.expire_in || 14400) * 1000);
    await sql`
      UPDATE shops SET
        shop_id = ${Number(shop_id)},
        access_token = ${resp.access_token},
        refresh_token = ${resp.refresh_token},
        token_expires_at = ${expiresAt.toISOString()},
        updated_at = now()
      WHERE code = ${shop}
    `;

    res.status(200).json({ ok: true, shop, expires_at: expiresAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'Gagal proses tukar token', detail: err.message });
  }
};
