const { sql } = require('./db');

// shop_id/access_token/refresh_token diambil dari DB (bukan env) karena berubah tiap di-refresh.
// partner_id/partner_key tetap dari env karena jarang berubah & sensitif.
async function getShopConfigs() {
  const rows = await sql`SELECT code, name, shop_id, access_token, refresh_token, token_expires_at FROM shops ORDER BY code`;
  return rows.map((r) => ({
    code: r.code,
    name: r.name,
    shopId: r.shop_id ? String(r.shop_id) : '',
    accessToken: r.access_token || '',
    refreshToken: r.refresh_token || '',
    tokenExpiresAt: r.token_expires_at,
    partnerId: process.env.SHOPEE_PARTNER_ID,
    partnerKey: process.env.SHOPEE_PARTNER_KEY,
  }));
}

module.exports = { getShopConfigs };
