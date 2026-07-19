const { sql } = require('../lib/db');

module.exports = async (req, res) => {
  const { shop, year, month } = req.query;
  if (!shop || !year || !month) {
    return res.status(400).json({ error: 'Parameter shop, year, month wajib diisi' });
  }
  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;

  try {
    const shopRows = await sql`SELECT id, name FROM shops WHERE code = ${shop}`;
    if (shopRows.length === 0) return res.status(404).json({ error: 'Toko tidak ditemukan' });
    const shopId = shopRows[0].id;

    const rows = await sql`
      WITH days AS (
        SELECT metric_date, omset_sales, total_sales_trx, product_sales,
               total_dicairkan, is_estimasi, total_cancel, ads_spend
        FROM daily_metrics
        WHERE shop_id = ${shopId} AND date_trunc('month', metric_date) = ${monthStart}::date
      ),
      hpp_per_day AS (
        SELECT oli.order_date AS metric_date,
               SUM(oli.qty * COALESCE(sh.hpp, 0)) AS hpp_total
        FROM order_line_items oli
        LEFT JOIN sku_hpp sh ON sh.shop_id = oli.shop_id AND sh.model_id = oli.model_id
        WHERE oli.shop_id = ${shopId} AND date_trunc('month', oli.order_date) = ${monthStart}::date
          AND (oli.order_status IS NULL OR oli.order_status <> 'CANCELLED')
        GROUP BY oli.order_date
      )
      SELECT
        d.metric_date, d.omset_sales, d.total_sales_trx, d.product_sales,
        d.total_dicairkan, d.is_estimasi, d.total_cancel, d.ads_spend,
        COALESCE(h.hpp_total, 0) AS hpp_total,
        CASE WHEN d.omset_sales > 0
          THEN ROUND(((d.omset_sales - d.total_dicairkan) / d.omset_sales) * 100, 2)
          ELSE 0 END AS pct_potongan,
        (d.total_dicairkan - COALESCE(h.hpp_total, 0)) AS profit
      FROM days d
      LEFT JOIN hpp_per_day h ON h.metric_date = d.metric_date
      ORDER BY d.metric_date;
    `;

    const summaryRows = await sql`
      WITH days AS (
        SELECT * FROM daily_metrics
        WHERE shop_id = ${shopId} AND date_trunc('month', metric_date) = ${monthStart}::date
      ),
      hpp_month AS (
        SELECT SUM(oli.qty * COALESCE(sh.hpp, 0)) AS hpp_total
        FROM order_line_items oli
        LEFT JOIN sku_hpp sh ON sh.shop_id = oli.shop_id AND sh.model_id = oli.model_id
        WHERE oli.shop_id = ${shopId} AND date_trunc('month', oli.order_date) = ${monthStart}::date
          AND (oli.order_status IS NULL OR oli.order_status <> 'CANCELLED')
      )
      SELECT
        COALESCE(SUM(d.total_sales_trx), 0) AS total_sales_trx,
        COALESCE(SUM(d.omset_sales), 0) AS omset_sales,
        COALESCE(SUM(d.total_dicairkan), 0) AS total_dicairkan,
        COALESCE(SUM(d.total_cancel), 0) AS total_cancel,
        COALESCE(SUM(d.ads_spend), 0) AS ads_spend,
        COALESCE((SELECT hpp_total FROM hpp_month), 0) AS hpp_total
      FROM days d;
    `;
    const s = summaryRows[0];
    const omset = parseFloat(s.omset_sales);
    const pctPotongan = omset > 0
      ? Math.round(((omset - parseFloat(s.total_dicairkan)) / omset) * 10000) / 100
      : 0;
    const profit = parseFloat(s.total_dicairkan) - parseFloat(s.hpp_total);

    res.status(200).json({
      shop: { code: shop, name: shopRows[0].name },
      year: Number(year),
      month: Number(month),
      rows,
      summary: {
        total_sales_trx: Number(s.total_sales_trx),
        omset_sales: omset,
        total_dicairkan: parseFloat(s.total_dicairkan),
        pct_potongan: pctPotongan,
        total_cancel: Number(s.total_cancel),
        ads_spend: parseFloat(s.ads_spend),
        hpp_total: parseFloat(s.hpp_total),
        profit,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil laporan', detail: err.message });
  }
};
