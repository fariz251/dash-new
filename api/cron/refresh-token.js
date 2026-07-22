const { sql } = require('../../lib/db');
const { signAuthRequest } = require('../../lib/shopeeSign');
const { getShopConfigs } = require('../../lib/shops');

async function refreshOneShop(shop) {
  const partnerId = shop.partnerId;
  const partnerKey = shop.partnerKey;
  const path = '/api/v2/auth/access_token/get';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signAuthRequest({ partnerId, partnerKey, path, timestamp });

  const url = new URL(`https://partner.shopeemobile.com${path}`);
  url.searchParams.set('partner_id', partnerId);
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', sign);

  const resp = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      refresh_token: shop.refreshToken,
      partner_id: Number(partnerId),
      shop_id: Number(shop.shopId),
    }),
  }).then((r) => r.json());

  if (!resp.access_token) {
    throw new Error(resp.message || resp.error || 'Response Shopee tidak berisi access_token baru');
  }

  const expiresAt = new Date(Date.now() + (resp.expire_in || 14400) * 1000);

  await sql`
    UPDATE shops SET
      access_token = ${resp.access_token},
      refresh_token = ${resp.refresh_token || shop.refreshToken},
      token_expires_at = ${expiresAt.toISOString()},
      updated_at = now()
    WHERE code = ${shop.code}
  `;

  return { shop: shop.code, expires_at: expiresAt.toISOString() };
}

module.exports = async (req, res) => {
  const token = req.query.token || req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results = [];
  const errors = [];
  const shops = await getShopConfigs();
  for (const shop of shops) {
    if (!shop.refreshToken || !shop.shopId) {
      errors.push({ shop: shop.code, error: 'refresh_token/shop_id belum diisi (perlu setup OAuth awal dulu)' });
      continue;
    }
    try {
      results.push(await refreshOneShop(shop));
    } catch (err) {
      console.error(`Gagal refresh token ${shop.code}:`, err);
      errors.push({ shop: shop.code, error: err.message });
    }
  }

  res.status(200).json({ ok: errors.length === 0, results, errors, refreshed_at: new Date().toISOString() });
};
