const { sql } = require('./db');

// Semua kredensial (termasuk partner_id/partner_key) diambil dari DB, per toko -
// karena tiap toko bisa punya App Shopee yang berbeda (partner_id/key beda-beda).
async function getShopConfigs() {
  const rows = await sql`
    SELECT code, name, partner_id, partner_key, shop_id, access_token, refresh_token, token_expires_at
    FROM shops ORDER BY code`;
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    partnerId: r.partner_id ? String(r.partner_id) : '',
    partnerKey: r.partner_key || '',
    shopId: r.shop_id ? String(r.shop_id) : '',
    accessToken: r.access_token || '',
    refreshToken: r.refresh_token || '',
    tokenExpiresAt: r.token_expires_at,
  }));
}

async function getShopConfig(code) {
  const configs = await getShopConfigs();
  return configs.find((s) => s.code === code) || null;
}

module.exports = { getShopConfigs, getShopConfig };
