const crypto = require('crypto');

/**
 * Formula resmi Shopee Open Platform v2 utk endpoint yang SUDAH punya shop_id + access_token:
 * sign = HMAC_SHA256(partner_id + api_path + timestamp + access_token + shop_id, partner_key)
 */
function signRequest({ partnerId, partnerKey, path, timestamp, accessToken = '', shopId = '' }) {
  const baseString = `${partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return crypto.createHmac('sha256', partnerKey).update(baseString).digest('hex');
}

/**
 * Formula utk endpoint AUTH (auth_partner, token/get, access_token/get / refresh) -
 * base string TIDAK menyertakan access_token/shop_id, karena dipanggil sebelum/tanpa token valid.
 * sign = HMAC_SHA256(partner_id + api_path + timestamp, partner_key)
 */
function signAuthRequest({ partnerId, partnerKey, path, timestamp }) {
  const baseString = `${partnerId}${path}${timestamp}`;
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

// Link "Authorize Shop" yg dibuka manual di browser sekali di awal (atau saat re-authorize)
function buildAuthPartnerUrl({ partnerId, partnerKey, redirectUrl }) {
  const path = '/api/v2/shop/auth_partner';
  const timestamp = Math.floor(Date.now() / 1000);
  const sign = signAuthRequest({ partnerId, partnerKey, path, timestamp });
  const url = new URL(`https://partner.shopeemobile.com${path}`);
  url.searchParams.set('partner_id', partnerId);
  url.searchParams.set('timestamp', timestamp);
  url.searchParams.set('sign', sign);
  url.searchParams.set('redirect', redirectUrl);
  return url.toString();
}

module.exports = { signRequest, signAuthRequest, buildShopeeUrl, buildAuthPartnerUrl };
