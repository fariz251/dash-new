const { pullShopWindow } = require('../../lib/shopeePull');
const { getShopConfig } = require('../../lib/shops');

const CHUNK_SECONDS = 24 * 60 * 60; // 1 hari per panggilan - Hobby plan Vercel default cuma 10 detik/request

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

  const now = Math.floor(Date.now() / 1000);

  // Titik mulai: dari parameter ?from= (lanjutan panggilan sebelumnya), atau default awal bulan ini
  let timeFrom;
  if (req.query.from) {
    timeFrom = Number(req.query.from);
  } else if (req.query.days_back) {
    const daysBack = Math.min(Number(req.query.days_back), 90);
    timeFrom = now - daysBack * 24 * 60 * 60;
  } else {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    timeFrom = Math.floor(startOfMonth.getTime() / 1000);
  }

  if (timeFrom >= now) {
    return res.status(200).json({ ok: true, done: true, note: 'Tidak ada lagi yg perlu ditarik, sudah sampai waktu sekarang.' });
  }

  const chunkEnd = Math.min(timeFrom + CHUNK_SECONDS, now);

  try {
    const result = await pullShopWindow(shop, timeFrom, chunkEnd);
    const done = chunkEnd >= now;
    const responseBody = {
      ok: true,
      done,
      shop: shopCode,
      period_selesai: { from: new Date(timeFrom * 1000).toISOString(), to: new Date(chunkEnd * 1000).toISOString() },
      result,
    };
    if (!done) {
      const nextUrl = new URL(req.url, `https://${req.headers.host}`);
      nextUrl.searchParams.set('from', chunkEnd);
      responseBody.lanjutkan_dengan_url = nextUrl.toString();
      responseBody.note = 'Belum selesai - buka lanjutkan_dengan_url di atas utk lanjut ke potongan berikutnya.';
    }
    res.status(200).json(responseBody);
  } catch (err) {
    console.error(`Backfill gagal utk chunk ${timeFrom}-${chunkEnd}:`, err);
    res.status(500).json({ ok: false, error: err.message, retry_from: timeFrom });
  }
};
