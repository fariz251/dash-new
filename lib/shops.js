function getShopConfigs() {
  return [
    {
      code: 'diansari_plastik',
      name: 'Diansari Plastik',
      shopId: process.env.SHOP_DIANSARI_PLASTIK_SHOP_ID,
      accessToken: process.env.SHOP_DIANSARI_PLASTIK_ACCESS_TOKEN,
      refreshToken: process.env.SHOP_DIANSARI_PLASTIK_REFRESH_TOKEN,
    },
    {
      code: 'mitra_diansari',
      name: 'Mitra Diansari',
      shopId: process.env.SHOP_MITRA_DIANSARI_SHOP_ID,
      accessToken: process.env.SHOP_MITRA_DIANSARI_ACCESS_TOKEN,
      refreshToken: process.env.SHOP_MITRA_DIANSARI_REFRESH_TOKEN,
    },
  ].map((s) => ({
    ...s,
    partnerId: process.env.SHOPEE_PARTNER_ID,
    partnerKey: process.env.SHOPEE_PARTNER_KEY,
  }));
}

module.exports = { getShopConfigs };
