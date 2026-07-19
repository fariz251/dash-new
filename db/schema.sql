-- ============================================================
-- Shopee Sales Dashboard - Database Schema (PostgreSQL)
-- ============================================================

CREATE TABLE IF NOT EXISTS shops (
    id              SERIAL PRIMARY KEY,
    code            TEXT UNIQUE NOT NULL,        -- 'diansari_plastik' / 'mitra_diansari'
    name            TEXT NOT NULL,               -- 'Diansari Plastik' / 'Mitra Diansari'
    shop_id         BIGINT NOT NULL,             -- Shopee shop_id
    partner_id      BIGINT NOT NULL,
    partner_key     TEXT NOT NULL,
    access_token    TEXT,
    refresh_token   TEXT,
    token_expires_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Data agregat per hari, per toko (ini yang jadi baris tabel utama)
CREATE TABLE IF NOT EXISTS daily_metrics (
    id                  SERIAL PRIMARY KEY,
    shop_id             INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    metric_date         DATE NOT NULL,
    omset_sales         NUMERIC(16,2) DEFAULT 0,   -- total nilai order (sebelum potongan)
    total_sales_trx     INT DEFAULT 0,             -- jumlah transaksi/invoice valid
    product_sales       INT DEFAULT 0,             -- jumlah unit produk terjual
    total_dicairkan     NUMERIC(16,2) DEFAULT 0,   -- actual/estimasi pencairan (escrow)
    is_estimasi         BOOLEAN DEFAULT TRUE,       -- true jika dana belum benar2 cair
    total_cancel        INT DEFAULT 0,             -- jumlah transaksi cancel
    ads_spend           NUMERIC(16,2) DEFAULT 0,   -- biaya iklan Shopee Ads hari itu
    updated_at          TIMESTAMPTZ DEFAULT now(),
    UNIQUE(shop_id, metric_date)
);

-- HPP diinput manual, per SKU VARIASI (model_id), bukan per SKU produk induk
CREATE TABLE IF NOT EXISTS sku_hpp (
    id          SERIAL PRIMARY KEY,
    shop_id     INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    model_id    TEXT NOT NULL,        -- model_id dari Shopee (unik per variasi)
    sku_variasi TEXT,                 -- nama SKU variasi utk kemudahan baca
    product_name TEXT,                -- nama produk induk (opsional, utk referensi)
    hpp         NUMERIC(14,2) NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE(shop_id, model_id)
);

-- Detail line item order, dipakai untuk hitung total HPP terjual per hari
CREATE TABLE IF NOT EXISTS order_line_items (
    id           SERIAL PRIMARY KEY,
    shop_id      INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    order_sn     TEXT NOT NULL,
    model_id     TEXT NOT NULL,
    sku_variasi  TEXT,
    qty          INT NOT NULL DEFAULT 0,
    item_total   NUMERIC(16,2) DEFAULT 0,
    order_date   DATE NOT NULL,
    order_status TEXT,               -- COMPLETED / CANCELLED / dll (dipakai utk exclude cancel dari HPP)
    updated_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE(shop_id, order_sn, model_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_metrics_shop_date ON daily_metrics(shop_id, metric_date);
CREATE INDEX IF NOT EXISTS idx_line_items_shop_date ON order_line_items(shop_id, order_date);
CREATE INDEX IF NOT EXISTS idx_line_items_model ON order_line_items(shop_id, model_id);

-- Seed 2 toko (isi partner_id/partner_key/shop_id/token via update setelah OAuth)
INSERT INTO shops (code, name, shop_id, partner_id, partner_key)
VALUES
    ('diansari_plastik', 'Diansari Plastik', 0, 0, 'GANTI_DENGAN_PARTNER_KEY'),
    ('mitra_diansari', 'Mitra Diansari', 0, 0, 'GANTI_DENGAN_PARTNER_KEY')
ON CONFLICT (code) DO NOTHING;
