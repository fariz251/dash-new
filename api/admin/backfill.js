const { pullShopWindow } = require('../../lib/shopeePull');
const { getShopConfig } = require('../../lib/shops');

const FIFTEEN_DAYS = 15 * 24 * 60 * 60;

module.exports = async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.query.admin_secret;
  if (!process.env.ADMIN_SECRET || token !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const shopCode = req.query.shop;
  if (!shopCode) return res.status(400).json({ error: 'Parameter shop wajib diisi' });

  const shop = await getShopConfig(shopCode);
  if (!shop) return res.status(404).json({ error: `Toko '${shopCode}' tidak ditemukan` });
  if (!shop.shopId || !shop.accessToken) {
    return res.status(400).json({ error: 'Toko ini belum selesai setup OAuth (shop_id/access_token kosong)' });
  }

  // Default: sejak awal bulan ini. Bisa override lewat ?days_back=30 (maks 90 hari ke belakang)
  const now = Math.floor(Date.now() / 1000);
  let timeFrom;
  if (req.query.days_back) {
    const daysBack = Math.min(Number(req.query.days_back), 90);
    timeFrom = now - daysBack * 24 * 60 * 60;
  } else {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    timeFrom = Math.floor(startOfMonth.getTime() / 1000);
  }

  const results = [];
  const errors = [];
  let cursor = timeFrom;
  while (cursor < now) {
    const chunkEnd = Math.min(cursor + FIFTEEN_DAYS, now);
    try {
      results.push(await pullShopWindow(shop, cursor, chunkEnd));
    } catch (err) {
      console.error(`Backfill gagal utk chunk ${cursor}-${chunkEnd}:`, err);
      errors.push({ from: new Date(cursor * 1000).toISOString(), to: new Date(chunkEnd * 1000).toISOString(), error: err.message });
    }
    cursor = chunkEnd;
  }

  res.status(200).json({
    ok: errors.length === 0,
    shop: shopCode,
    period: { from: new Date(timeFrom * 1000).toISOString(), to: new Date(now * 1000).toISOString() },
    results,
    errors,
  });
};
