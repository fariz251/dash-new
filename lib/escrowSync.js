const { sql } = require('./db');
const { buildShopeeUrl } = require('./shopeeSign');

/**
 * PENTING: field response get_escrow_detail di sini best-effort berdasarkan pola umum
 * Shopee Open API v2 (nested di response.order_income.escrow_amount / .total_amount).
 * BELUM 100% diverifikasi ke dokumentasi resmi terbaru. Kalau amount yg tersimpan
 * kelihatan salah/nol terus, cek field `_raw_response_sample` yg dikembalikan endpoint
 * /api/cron/sync-escrow (mode debug) dan sesuaikan `extractEscrowAmount` di bawah ini.
 */
function extractEscrowAmount(resp) {
  const oi = resp.response?.order_income || resp.response || {};
  const candidates = [
    oi.escrow_amount,
    oi.escrow_amount_after_tax,
    resp.response?.escrow_amount,
    oi.total_amount,
  ];
  const found = candidates.find((v) => typeof v === 'number');
  return found;
}

/**
 * Sync escrow utk order2 yg statusnya COMPLETED tapi belum ke-settle di DB kita.
 * Diproses per-batch kecil (limit) supaya aman dari batas waktu Vercel.
 */
async function syncEscrowForShop(shop, limit = 15) {
  const shopRow = await sql`SELECT id FROM shops WHERE code = ${shop.code}`;
  if (shopRow.length === 0) throw new Error(`Toko ${shop.code} tidak ditemukan`);
  const shopId = shopRow[0].id;

  const pending = await sql`
    SELECT order_sn, order_date FROM order_headers
    WHERE shop_id = ${shopId} AND order_status = 'COMPLETED' AND COALESCE(escrow_settled, false) = false
    ORDER BY order_date ASC
    LIMIT ${limit}
  `;

  const processed = [];
  const failed = [];
  let rawSample = null;
  const affectedDates = new Set();

  for (const row of pending) {
    const url = buildShopeeUrl({
      partnerId: shop.partnerId,
      partnerKey: shop.partnerKey,
      path: '/api/v2/payment/get_escrow_detail',
      accessToken: shop.accessToken,
      shopId: shop.shopId,
      extraParams: { order_sn: row.order_sn },
    });
    const resp = await fetch(url).then((r) => r.json());
    if (!rawSample) rawSample = resp; // simpan 1 contoh mentah utk debug

    if (resp.error) {
      failed.push({ order_sn: row.order_sn, error: `${resp.error} - ${resp.message}` });
      continue;
    }
    const amount = extractEscrowAmount(resp);
    if (amount === undefined) {
      failed.push({ order_sn: row.order_sn, error: 'Field escrow_amount tidak ditemukan di response - cek _raw_response_sample' });
      continue;
    }
    await sql`
      UPDATE order_headers SET escrow_amount = ${amount}, escrow_settled = true, updated_at = now()
      WHERE shop_id = ${shopId} AND order_sn = ${row.order_sn}
    `;
    affectedDates.add(row.order_date.toISOString ? row.order_date.toISOString().slice(0, 10) : row.order_date);
    processed.push(row.order_sn);
  }

  // Recompute daily_metrics utk tanggal yg baru saja disync
  for (const dateStr of affectedDates) {
    const agg = await sql`
      SELECT
        COALESCE(SUM(CASE
          WHEN order_status <> 'CANCELLED' AND escrow_settled THEN escrow_amount
          WHEN order_status <> 'CANCELLED' THEN total_amount
          ELSE 0 END), 0) AS total_dicairkan,
        BOOL_OR(order_status <> 'CANCELLED' AND NOT COALESCE(escrow_settled, false)) AS masih_estimasi
      FROM order_headers WHERE shop_id = ${shopId} AND order_date = ${dateStr}
    `;
    const a = agg[0];
    await sql`
      UPDATE daily_metrics SET total_dicairkan = ${a.total_dicairkan}, is_estimasi = ${a.masih_estimasi}, updated_at = now()
      WHERE shop_id = ${shopId} AND metric_date = ${dateStr}
    `;
  }

  return { shop: shop.code, processed: processed.length, failed, sisa_pending: pending.length === limit, _raw_response_sample: rawSample };
}

module.exports = { syncEscrowForShop };
