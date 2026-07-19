const crypto = require('crypto');

/**
 * Formula resmi Shopee Open Platform v2:
 * sign = HMAC_SHA256(partner_id + api_path + timestamp + access_token + shop_id, partner_key)
 * (cek ulang ke dokumentasi resmi open.shopee.com kalau ada perubahan)
 */
function signRequest({ partnerId, partnerKey, path, timestamp, accessToken = '', shopId = '' }) {
  const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');
}

function buildShopeeUrl({ partnerId, partnerKey, path, accessToken, shopId, extraParams = {} }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signRequest({ partnerId, partnerKey, path, timestamp, accessToken, shopId });
  const url = new URL(`https://partner.shopeemobile.com${path}`);
  url.searchParams.set('partner_id', partnerId);
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', sign);
  if (accessToken) url.searchParams.set('access_token', accessToken);
  if (shopId) url.searchParams.set('shop_id', shopId);
  for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v);
  return url.toString();
}

module.exports = { signRequest, buildShopeeUrl };
