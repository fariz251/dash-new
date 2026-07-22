-- ============================================================
-- Shopee Sales Dashboard - Database Schema (PostgreSQL)
-- ============================================================

CREATE TABLE IF NOT EXISTS shops (
    id              SERIAL PRIMARY KEY,
    code            TEXT UNIQUE NOT NULL,        -- 'diansari_plastik' / 'mitra_diansari'
    name            TEXT NOT NULL,               -- 'Diansari Plastik' / 'Mitra Diansari'
    partner_id      BIGINT,                      -- App/Partner ID Shopee milik toko ini (tiap toko App beda)
    partner_key     TEXT,                        -- App/Partner Key Shopee milik toko ini
    shop_id         BIGINT,                      -- diisi otomatis oleh /api/admin/exchange-code
    access_token    TEXT,                        -- diisi & diperbarui otomatis (cron refresh-token)
    refresh_token   TEXT,
    token_expires_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
-- partner_id/partner_key diisi lewat POST /api/admin/set-partner (lihat README),
-- BUKAN lewat Environment Variables, karena tiap toko App-nya beda.

-- Data agregat per hari, per toko (ini yang jadi baris tabel utama)
-- Migrasi idempotent, aman dijalankan ulang - utk yg sudah pernah bikin tabel shops versi lama
ALTER TABLE shops ADD COLUMN IF NOT EXISTS partner_id BIGINT;
ALTER TABLE shops ADD COLUMN IF NOT EXISTS partner_key TEXT;

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
-- Header order per order_sn (dipakai utk hitung ulang daily_metrics scr idempotent - aman
-- kalau order yg sama ditarik berkali-kali oleh cron/backfill, tidak dobel hitung)
CREATE TABLE IF NOT EXISTS order_headers (
    id           SERIAL PRIMARY KEY,
    shop_id      INT NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
    order_sn     TEXT NOT NULL,
    order_status TEXT,
    total_amount NUMERIC(16,2) DEFAULT 0,
    order_date   DATE NOT NULL,
    escrow_amount   NUMERIC(16,2),      -- diisi oleh sync-escrow, NULL = belum disync
    escrow_settled  BOOLEAN DEFAULT false,
    updated_at   TIMESTAMPTZ DEFAULT now(),
    UNIQUE(shop_id, order_sn)
);
ALTER TABLE order_headers ADD COLUMN IF NOT EXISTS escrow_amount NUMERIC(16,2);
ALTER TABLE order_headers ADD COLUMN IF NOT EXISTS escrow_settled BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_order_headers_shop_date ON order_headers(shop_id, order_date);

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

-- Seed 2 toko (shop_id/token diisi otomatis lewat /api/admin/exchange-code setelah OAuth)
INSERT INTO shops (code, name)
VALUES
    ('diansari_plastik', 'Diansari Plastik'),
    ('mitra_diansari', 'Mitra Diansari')
ON CONFLICT (code) DO NOTHING;
