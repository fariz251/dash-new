const { sql } = require('../../lib/db');
const { buildShopeeUrl } = require('../../lib/shopeeSign');
const { getShopConfigs } = require('../../lib/shops');

async function pullOneShop(shop) {
  const timeTo = Math.floor(Date.now() / 1000);
  const timeFrom = timeTo - 17 * 60; // window 15 menit + buffer 2 menit

  // 1) Get Order List
  const orderListUrl = buildShopeeUrl({
    partnerId: shop.partnerId,
    partnerKey: shop.partnerKey,
    path: '/api/v2/order/get_order_list',
    accessToken: shop.accessToken,
    shopId: shop.shopId,
    extraParams: {
      time_range_field: 'create_time',
      time_from: timeFrom,
      time_to: timeTo,
      page_size: 100,
      order_status: 'ALL',
    },
  });
  const orderListRes = await fetch(orderListUrl).then((r) => r.json());
  const orderSnList = (orderListRes.response?.order_list || []).map((o) => o.order_sn);

  if (orderSnList.length === 0) {
    return { shop: shop.code, dates: [], note: 'Tidak ada order baru di window ini' };
  }

  // 2) Get Order Detail (maks 50 order_sn per call sesuai batas Shopee - dipotong kalau lebih)
  const chunks = [];
  for (let i = 0; i < orderSnList.length; i += 50) chunks.push(orderSnList.slice(i, i + 50));

  const allOrders = [];
  for (const chunk of chunks) {
    const detailUrl = buildShopeeUrl({
      partnerId: shop.partnerId,
      partnerKey: shop.partnerKey,
      path: '/api/v2/order/get_order_detail',
      accessToken: shop.accessToken,
      shopId: shop.shopId,
      extraParams: {
        order_sn_list: chunk.join(','),
        response_optional_fields: 'item_list,total_amount,order_status,create_time,cancel_reason',
      },
    });
    const detailRes = await fetch(detailUrl).then((r) => r.json());
    allOrders.push(...(detailRes.response?.order_list || []));
  }

  // 3) Agregasi per tanggal
  const byDate = {};
  const lineItems = [];
  for (const o of allOrders) {
    const dateStr = new Date(o.create_time * 1000).toISOString().slice(0, 10);
    if (!byDate[dateStr]) byDate[dateStr] = { omset_sales: 0, total_sales_trx: 0, product_sales: 0, total_cancel: 0 };
    const isCancel = o.order_status === 'CANCELLED';
    if (isCancel) {
      byDate[dateStr].total_cancel += 1;
    } else {
      byDate[dateStr].omset_sales += Number(o.total_amount || 0);
      byDate[dateStr].total_sales_trx += 1;
    }
    for (const item of o.item_list || []) {
      const qty = Number(item.model_quantity_purchased || item.quantity_purchased || 0);
      if (!isCancel) byDate[dateStr].product_sales += qty;
      lineItems.push({
        order_sn: o.order_sn,
        model_id: String(item.model_id || item.item_id),
        sku_variasi: item.model_sku || item.item_sku || '',
        qty,
        item_total: Number(item.model_discounted_price || item.item_price || 0) * qty,
        order_date: dateStr,
        order_status: o.order_status,
      });
    }
  }

  // TODO: isi total_dicairkan dari /api/v2/payment/get_escrow_detail (lihat README)
  // TODO: isi ads_spend dari Shopee Marketing/Ads API (lihat README)

  // 4) Simpan ke DB
  const shopRow = await sql`SELECT id FROM shops WHERE code = ${shop.code}`;
  if (shopRow.length === 0) throw new Error(`Toko ${shop.code} belum ada di tabel shops`);
  const shopId = shopRow[0].id;

  for (const [metricDate, agg] of Object.entries(byDate)) {
    await sql`
      INSERT INTO daily_metrics
        (shop_id, metric_date, omset_sales, total_sales_trx, product_sales, total_cancel, is_estimasi, updated_at)
      VALUES (${shopId}, ${metricDate}, ${agg.omset_sales}, ${agg.total_sales_trx}, ${agg.product_sales}, ${agg.total_cancel}, true, now())
      ON CONFLICT (shop_id, metric_date) DO UPDATE SET
        omset_sales = daily_metrics.omset_sales + EXCLUDED.omset_sales,
        total_sales_trx = daily_metrics.total_sales_trx + EXCLUDED.total_sales_trx,
        product_sales = daily_metrics.product_sales + EXCLUDED.product_sales,
        total_cancel = daily_metrics.total_cancel + EXCLUDED.total_cancel,
        updated_at = now()
    `;
  }

  for (const it of lineItems) {
    await sql`
      INSERT INTO order_line_items (shop_id, order_sn, model_id, sku_variasi, qty, item_total, order_date, order_status, updated_at)
      VALUES (${shopId}, ${it.order_sn}, ${it.model_id}, ${it.sku_variasi}, ${it.qty}, ${it.item_total}, ${it.order_date}, ${it.order_status}, now())
      ON CONFLICT (shop_id, order_sn, model_id) DO UPDATE SET
        qty = EXCLUDED.qty, item_total = EXCLUDED.item_total, order_status = EXCLUDED.order_status, updated_at = now()
    `;
  }

  return { shop: shop.code, dates: Object.keys(byDate), orders: allOrders.length };
}

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
      results.push(await pullOneShop(shop));
    } catch (err) {
      console.error(`Gagal tarik data ${shop.code}:`, err);
      errors.push({ shop: shop.code, error: err.message });
    }
  }

  res.status(200).json({ ok: errors.length === 0, results, errors, pulled_at: new Date().toISOString() });
};
