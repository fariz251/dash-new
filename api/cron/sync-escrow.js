const { syncEscrowForShop } = require('../../lib/escrowSync');
const { getShopConfigs } = require('../../lib/shops');

module.exports = async (req, res) => {
  const cronToken = req.query.token || req.headers['x-cron-secret'];
  const adminToken = req.headers['x-admin-secret'] || req.query.admin_secret;
  const isCronAuthorized = process.env.CRON_SECRET && cronToken === process.env.CRON_SECRET;
  const isAdminAuthorized = process.env.ADMIN_SECRET && adminToken === process.env.ADMIN_SECRET;
  if (!isCronAuthorized && !isAdminAuthorized) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results = [];
  const shops = await getShopConfigs();
  for (const shop of shops) {
    if (!shop.shopId || !shop.accessToken) continue;
    try {
      results.push(await syncEscrowForShop(shop, Number(req.query.limit) || 15));
    } catch (err) {
      console.error(`Sync escrow gagal utk ${shop.code}:`, err);
      results.push({ shop: shop.code, error: err.message });
    }
  }

  res.status(200).json({ ok: true, results, synced_at: new Date().toISOString() });
};
