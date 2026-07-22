const { pullShopWindow } = require('../../lib/shopeePull');
const { getShopConfigs } = require('../../lib/shops');

module.exports = async (req, res) => {
  // Boleh dipicu oleh: (a) scheduler eksternal dgn CRON_SECRET, atau
  // (b) tombol "Tarik Sekarang" di dashboard dgn ADMIN_SECRET (dicek via header)
  const cronToken = req.query.token || req.headers['x-cron-secret'];
  const adminToken = req.headers['x-admin-secret'];
  const isCronAuthorized = process.env.CRON_SECRET && cronToken === process.env.CRON_SECRET;
  const isAdminAuthorized = process.env.ADMIN_SECRET && adminToken === process.env.ADMIN_SECRET;
  if (!isCronAuthorized && !isAdminAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const timeTo = Math.floor(Date.now() / 1000);
  const timeFrom = timeTo - 17 * 60; // window 15 menit + buffer 2 menit

  const results = [];
  const errors = [];
  const shops = await getShopConfigs();
  for (const shop of shops) {
    if (!shop.shopId || !shop.accessToken) {
      errors.push({ shop: shop.code, error: 'Kredensial belum diisi (jalankan setup OAuth dulu, lihat README)' });
      continue;
    }
    if (shop.tokenExpiresAt && new Date(shop.tokenExpiresAt).getTime() < Date.now()) {
      errors.push({ shop: shop.code, error: 'access_token sudah kedaluwarsa, menunggu cron refresh-token berikutnya' });
      continue;
    }
    try {
      results.push(await pullShopWindow(shop, timeFrom, timeTo));
    } catch (err) {
      console.error(`Gagal tarik data ${shop.code}:`, err);
      errors.push({ shop: shop.code, error: err.message });
    }
  }

  res.status(200).json({ ok: errors.length === 0, results, errors, pulled_at: new Date().toISOString() });
};
