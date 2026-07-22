const { sql } = require('./db');
const { buildShopeeUrl } = require('./shopeeSign');

/**
 * Tarik order Shopee utk 1 toko dalam rentang waktu [timeFrom, timeTo] (unix seconds),
 * simpan ke order_headers + order_line_items (upsert, idempotent), lalu HITUNG ULANG
 * daily_metrics dari data tsb (bukan nambah2 dari nilai lama) - supaya aman dipanggil
 * berkali-kali (retry cron, atau backfill yg overlap) tanpa dobel hitung.
 */
async function pullShopWindow(shop, timeFrom, timeTo) {
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
    },
  });
  const firstRes = await fetch(orderListUrl).then((r) => r.json());
  if (firstRes.error) throw new Error(`get_order_list: ${firstRes.error} - ${firstRes.message}`);

  let orderSnList = (firstRes.response?.order_list || []).map((o) => o.order_sn);
  let more = firstRes.response?.more;
  let cursor = firstRes.response?.next_cursor;

  while (more && cursor) {
    const nextUrl = buildShopeeUrl({
      partnerId: shop.partnerId,
      partnerKey: shop.partnerKey,
      path: '/api/v2/order/get_order_list',
      accessToken: shop.accessToken,
      shopId: shop.shopId,
      extraParams: {
        time_range_field: 'create_time', time_from: timeFrom, time_to: timeTo,
        page_size: 100, cursor,
      },
    });
    const nextRes = await fetch(nextUrl).then((r) => r.json());
    if (nextRes.error) throw new Error(`get_order_list(next): ${nextRes.error} - ${nextRes.message}`);
    orderSnList = orderSnList.concat((nextRes.response?.order_list || []).map((o) => o.order_sn));
    more = nextRes.response?.more;
    cursor = nextRes.response?.next_cursor;
  }

  if (orderSnList.length === 0) return { shop: shop.code, dates: [], orders: 0 };

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
    if (detailRes.error) throw new Error(`get_order_detail: ${detailRes.error} - ${detailRes.message}`);
    allOrders.push(...(detailRes.response?.order_list || []));
  }

  const shopRow = await sql`SELECT id FROM shops WHERE code = ${shop.code}`;
  if (shopRow.length === 0) throw new Error(`Toko ${shop.code} belum ada di tabel shops`);
  const shopId = shopRow[0].id;

  const affectedDates = new Set();
  for (const o of allOrders) {
    affectedDates.add(new Date(o.create_time * 1000).toISOString().slice(0, 10));
  }

  // Tulis ke DB scr paralel (batch kecil2) - jauh lebih cepat drpd satu-satu berurutan,
  // penting krn Vercel functions punya batas waktu (maxDuration).
  const CONCURRENCY = 8;
  for (let i = 0; i < allOrders.length; i += CONCURRENCY) {
    const batch = allOrders.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map(async (o) => {
      const dateStr = new Date(o.create_time * 1000).toISOString().slice(0, 10);
      await sql`
        INSERT INTO order_headers (shop_id, order_sn, order_status, total_amount, order_date, updated_at)
        VALUES (${shopId}, ${o.order_sn}, ${o.order_status}, ${Number(o.total_amount || 0)}, ${dateStr}, now())
        ON CONFLICT (shop_id, order_sn) DO UPDATE SET
          order_status = EXCLUDED.order_status,
          total_amount = EXCLUDED.total_amount,
          updated_at = now()
      `;
      await Promise.all((o.item_list || []).map((item) => {
        const qty = Number(item.model_quantity_purchased || item.quantity_purchased || 0);
        const modelId = String(item.model_id || item.item_id);
        const skuVar = item.model_sku || item.item_sku || '';
        const itemTotal = Number(item.model_discounted_price || item.item_price || 0) * qty;
        return sql`
          INSERT INTO order_line_items (shop_id, order_sn, model_id, sku_variasi, qty, item_total, order_date, order_status, updated_at)
          VALUES (${shopId}, ${o.order_sn}, ${modelId}, ${skuVar}, ${qty}, ${itemTotal}, ${dateStr}, ${o.order_status}, now())
          ON CONFLICT (shop_id, order_sn, model_id) DO UPDATE SET
            qty = EXCLUDED.qty, item_total = EXCLUDED.item_total, order_status = EXCLUDED.order_status, updated_at = now()
        `;
      }));
    }));
  }

  // Hitung ULANG daily_metrics dari order_headers + order_line_items (idempotent, bukan nambah2)
  // total_dicairkan: pakai nilai escrow ASLI kalau sudah disync (lihat lib/escrowSync.js),
  // kalau belum, ESTIMASI pakai omset_sales dulu (jauh lebih masuk akal drpd 0) - ditandai is_estimasi.
  await Promise.all([...affectedDates].map(async (dateStr) => {
    const agg = await sql`
      SELECT
        COALESCE(SUM(CASE WHEN order_status <> 'CANCELLED' THEN total_amount ELSE 0 END), 0) AS omset_sales,
        COUNT(*) FILTER (WHERE order_status <> 'CANCELLED') AS total_sales_trx,
        COUNT(*) FILTER (WHERE order_status = 'CANCELLED') AS total_cancel,
        COALESCE(SUM(CASE
          WHEN order_status <> 'CANCELLED' AND escrow_settled THEN escrow_amount
          WHEN order_status <> 'CANCELLED' THEN total_amount
          ELSE 0 END), 0) AS total_dicairkan,
        BOOL_OR(order_status <> 'CANCELLED' AND NOT COALESCE(escrow_settled, false)) AS masih_estimasi
      FROM order_headers
      WHERE shop_id = ${shopId} AND order_date = ${dateStr}
    `;
    const productSalesRes = await sql`
      SELECT COALESCE(SUM(qty), 0) AS product_sales
      FROM order_line_items
      WHERE shop_id = ${shopId} AND order_date = ${dateStr} AND order_status <> 'CANCELLED'
    `;
    const a = agg[0];
    const productSales = productSalesRes[0].product_sales;

    await sql`
      INSERT INTO daily_metrics (shop_id, metric_date, omset_sales, total_sales_trx, product_sales, total_cancel, total_dicairkan, is_estimasi, updated_at)
      VALUES (${shopId}, ${dateStr}, ${a.omset_sales}, ${a.total_sales_trx}, ${productSales}, ${a.total_cancel}, ${a.total_dicairkan}, ${a.masih_estimasi}, now())
      ON CONFLICT (shop_id, metric_date) DO UPDATE SET
        omset_sales = EXCLUDED.omset_sales,
        total_sales_trx = EXCLUDED.total_sales_trx,
        product_sales = EXCLUDED.product_sales,
        total_cancel = EXCLUDED.total_cancel,
        total_dicairkan = EXCLUDED.total_dicairkan,
        is_estimasi = EXCLUDED.is_estimasi,
        updated_at = now()
    `;
  }));

  return { shop: shop.code, dates: [...affectedDates], orders: allOrders.length };
}

module.exports = { pullShopWindow };
