const { pullShopWindow } = require('../../lib/shopeePull');
const { getShopConfig } = require('../../lib/shops');

const CHUNK_SECONDS = 24 * 60 * 60; // 1 hari per sub-chunk
const SAFETY_BUDGET_MS = 8000; // berhenti sblm kena limit 10 detik Hobby plan (tanpa Fluid Compute)

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
  let cursor;
  if (req.query.from) {
    cursor = Number(req.query.from);
  } else if (req.query.days_back) {
    const daysBack = Math.min(Number(req.query.days_back), 90);
    cursor = now - daysBack * 24 * 60 * 60;
  } else {
    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);
    cursor = Math.floor(startOfMonth.getTime() / 1000);
  }

  if (cursor >= now) {
    return res.status(200).json({ ok: true, done: true, note: 'Tidak ada lagi yg perlu ditarik, sudah sampai waktu sekarang.' });
  }

  // Proses beberapa chunk sekaligus selama masih ada sisa waktu aman (SAFETY_BUDGET_MS)
  const startedAt = Date.now();
  const processedChunks = [];
  let totalOrders = 0;

  while (cursor < now && (Date.now() - startedAt) < SAFETY_BUDGET_MS) {
    const chunkEnd = Math.min(cursor + CHUNK_SECONDS, now);
    try {
      const result = await pullShopWindow(shop, cursor, chunkEnd);
      processedChunks.push({ from: new Date(cursor * 1000).toISOString(), to: new Date(chunkEnd * 1000).toISOString(), orders: result.orders });
      totalOrders += result.orders;
      cursor = chunkEnd;
    } catch (err) {
      console.error(`Backfill gagal utk chunk ${cursor}-${chunkEnd}:`, err);
      return res.status(500).json({ ok: false, error: err.message, retry_from: cursor, processedChunks });
    }
  }

  const done = cursor >= now;
  const responseBody = {
    ok: true,
    done,
    shop: shopCode,
    chunks_diproses: processedChunks.length,
    total_orders: totalOrders,
    processedChunks,
  };
  if (!done) {
    const nextUrl = new URL(req.url, `https://${req.headers.host}`);
    nextUrl.searchParams.set('from', cursor);
    responseBody.lanjutkan_dengan_url = nextUrl.toString();
    responseBody.next_from = cursor;
  }
  res.status(200).json(responseBody);
};
