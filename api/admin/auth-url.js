const { buildAuthPartnerUrl } = require('../../lib/shopeeSign');

module.exports = (req, res) => {
  const token = req.headers['x-admin-secret'];
  if (!process.env.ADMIN_SECRET || token !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const redirectUrl = req.query.redirect_url;
  if (!redirectUrl) return res.status(400).json({ error: 'Parameter redirect_url wajib diisi' });

  const url = buildAuthPartnerUrl({
    partnerId: process.env.SHOPEE_PARTNER_ID,
    partnerKey: process.env.SHOPEE_PARTNER_KEY,
    redirectUrl,
  });
  res.status(200).json({ auth_url: url, note: 'Link berlaku 5 menit, buka di browser & login sbg pemilik toko yg mau di-authorize' });
};
