const { buildAuthPartnerUrl } = require('../../lib/shopeeSign');
const { getShopConfig } = require('../../lib/shops');

module.exports = async (req, res) => {
  const token = req.headers['x-admin-secret'] || req.query.admin_secret;
  if (!process.env.ADMIN_SECRET || token !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { redirect_url: redirectUrl, shop } = req.query;
  if (!redirectUrl) return res.status(400).json({ error: 'Parameter redirect_url wajib diisi' });
  if (!shop) return res.status(400).json({ error: 'Parameter shop wajib diisi (diansari_plastik / mitra_diansari)' });

  const shopConfig = await getShopConfig(shop);
  if (!shopConfig) return res.status(404).json({ error: `Toko '${shop}' tidak ditemukan` });
  if (!shopConfig.partnerId || !shopConfig.partnerKey) {
    return res.status(400).json({
      error: `partner_id/partner_key utk toko '${shop}' belum diisi. Isi dulu lewat POST /api/admin/set-partner`,
    });
  }

  const url = buildAuthPartnerUrl({
    partnerId: shopConfig.partnerId,
    partnerKey: shopConfig.partnerKey,
    redirectUrl,
  });
  res.status(200).json({ auth_url: url, shop, note: 'Link berlaku 5 menit, buka di browser & login sbg pemilik toko yg mau di-authorize' });
};
