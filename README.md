# Shopee Sales Dashboard — Versi Vercel (publik, siapa saja bisa akses)

## Arsitektur

```
[cron-job.org] --tiap 15 menit--> [Vercel: /api/cron/pull] --> [Shopee Open API]
                                          |
                                          v
                                   [Neon Postgres]
                                          ^
                                          |
[Siapa saja] <--- [Vercel: dashboard + /api/report, /api/hpp] ---+
```

Tidak pakai n8n atau Docker lagi — semuanya jalan di Vercel Functions (serverless) + Neon
(Postgres serverless, gratis). Penjadwalan 15 menit dipindah ke **cron eksternal gratis**
karena cron bawaan Vercel di paket gratis (Hobby) cuma bisa 1x/hari.

## Langkah deploy

### 1. Buat database di Neon
1. Daftar gratis di https://neon.tech, buat project baru.
2. Salin **connection string** yang ada tulisan `-pooler` di host-nya (penting, itu versi yang
   aman dipakai serverless).
3. Jalankan isi `db/schema.sql` lewat SQL Editor di dashboard Neon (atau `psql "<connection string>" -f db/schema.sql`).
4. Update baris toko di `shops` (isi `shop_id`, `partner_id`, `partner_key` yang benar) —
   atau cukup lewat environment variable saja (lihat langkah 3), karena `api/cron/pull.js`
   membaca kredensial dari env, bukan dari tabel `shops`. Kolom di tabel `shops` untuk
   partner_id/key/token boleh dikosongkan.

### 2. Deploy ke Vercel
```bash
npm i -g vercel   # kalau belum ada
cd shopee-dashboard-vercel
vercel deploy --prod
```
Atau lewat vercel.com: **Add New Project** → import folder ini (bisa lewat GitHub repo atau
drag-drop via CLI).

### 3. Set Environment Variables (Vercel > Project > Settings > Environment Variables)

| Key | Contoh | Keterangan |
|---|---|---|
| `DATABASE_URL` | `postgresql://...-pooler.../neondb?sslmode=require` | connection string Neon (pooled) |
| `CRON_SECRET` | string acak panjang | token utk lindungi `/api/cron/pull` |
| `ADMIN_SECRET` | string acak lain | token utk lindungi tulis-HPP (dashboard tetap publik utk **lihat**) |
| `SHOPEE_PARTNER_ID` | dari open.shopee.com | |
| `SHOPEE_PARTNER_KEY` | dari open.shopee.com | |
| `SHOP_DIANSARI_PLASTIK_SHOP_ID` | hasil OAuth authorize | |
| `SHOP_DIANSARI_PLASTIK_ACCESS_TOKEN` | hasil OAuth authorize | **berlaku 4 jam**, lihat catatan di bawah |
| `SHOP_MITRA_DIANSARI_SHOP_ID` | | |
| `SHOP_MITRA_DIANSARI_ACCESS_TOKEN` | | |

Redeploy setelah isi env vars.

### 4. Setup OAuth sekali per toko (authorize + ambil token pertama)

Token akses Shopee **tidak bisa didapat otomatis** untuk pertama kali — wajib ada 1x proses
klik-authorize manual di browser oleh pemilik toko. Setelah itu, sistem sudah bisa
memperbarui token itu sendiri otomatis selamanya (lihat langkah 5).

1. Minta link authorize (ganti `NAMA-PROJECT` & isi `redirect_url` bebas, mis. domain Vercel Anda):
   ```bash
   curl -H "x-admin-secret: ISI_ADMIN_SECRET" \
     "https://NAMA-PROJECT.vercel.app/api/admin/auth-url?redirect_url=https://NAMA-PROJECT.vercel.app"
   ```
   Buka `auth_url` yang dikembalikan di browser (login sbg pemilik/admin toko Shopee), pilih
   toko yang mau di-authorize (**Diansari Plastik** dulu), setujui.
2. Setelah disetujui, Anda diarahkan ke `redirect_url` dengan tambahan `?code=...&shop_id=...`
   di URL-nya. Salin kedua nilai itu.
3. Tukar `code` jadi token pertama:
   ```bash
   curl -X POST -H "x-admin-secret: ISI_ADMIN_SECRET" -H "Content-Type: application/json" \
     -d '{"shop":"diansari_plastik","code":"CODE_DARI_URL","shop_id":"SHOP_ID_DARI_URL"}' \
     "https://NAMA-PROJECT.vercel.app/api/admin/exchange-code"
   ```
4. Ulangi langkah 1–3 untuk toko **Mitra Diansari** (`"shop":"mitra_diansari"`).

Token otomatis tersimpan ke tabel `shops` di Neon — tidak perlu isi manual di Environment Variables lagi.

### 5. Pasang 2 scheduler (gratis, via cron-job.org)

**a) Tarik data — tiap 15 menit:**
```
https://NAMA-PROJECT.vercel.app/api/cron/pull?token=ISI_CRON_SECRET
```

**b) Refresh token — tiap 3 jam** (access_token Shopee cuma tahan 4 jam, refresh_token 30 hari):
```
https://NAMA-PROJECT.vercel.app/api/cron/refresh-token?token=ISI_CRON_SECRET
```

Kalau refresh-token gagal terus-menerus lebih dari 30 hari (refresh_token ikut expired),
tandanya harus ulang proses authorize di langkah 4.

Dashboard publik ada di `https://NAMA-PROJECT-ANDA.vercel.app` — bisa dibuka siapa saja tanpa
login (sesuai yang Anda mau). Countdown di dashboard akan otomatis sinkron ke kelipatan 15
menit berikutnya.

## Tombol "Tarik Sekarang" (refresh manual)

Selain jadwal otomatis tiap 15 menit, ada tombol **↻ Tarik Sekarang** di dashboard (sebelah
countdown) untuk narik data Shopee kapan saja tanpa menunggu. Tombol ini dilindungi
`ADMIN_SECRET` yang sama dengan input HPP (browser akan minta token sekali, lalu diingat).
Jadwal 15 menit otomatis tetap jalan seperti biasa, tidak terganggu oleh refresh manual ini.

## Soal keamanan (baca ini)

Karena Anda pilih dashboard boleh dilihat siapa saja:
- **Melihat data** (omset, profit, dst) → publik, tidak perlu login. Siapa pun yang tahu URL-nya bisa lihat.
- **Mengubah data** (input HPP) → tetap saya kunci pakai `ADMIN_SECRET`, supaya orang iseng
  yang kebetulan buka link tidak bisa mengacak-acak HPP toko Anda. Dashboard akan minta token
  ini sekali (disimpan di browser Anda) saat pertama kali menyimpan/menghapus HPP.
- Endpoint `/api/cron/pull` juga dikunci `CRON_SECRET` supaya tidak sembarang orang bisa
  memicu tarikan data (yang akan menghabiskan kuota API Shopee Anda).

Kalau nanti berubah pikiran dan mau dashboard-nya juga perlu login utk **lihat**, tinggal
bilang — saya bisa tambahkan lapisan password sederhana (Vercel Middleware + cookie) tanpa
perlu ubah banyak.

## Yang masih perlu dilengkapi

Sama seperti versi sebelumnya, di `api/cron/pull.js` ada 2 TODO yang sengaja saya tandai
(bukan saya karang) karena field/endpoint-nya perlu dicek ke dokumentasi resmi Shopee terbaru:
1. `total_dicairkan` (dari `get_escrow_detail`) — saat ini masih 0.
2. `ads_spend` (dari Ads/Marketing API) — saat ini masih 0.

Refresh `access_token` otomatis **sudah selesai** — lihat `api/cron/refresh-token.js` +
langkah 5 di atas.

## Struktur folder

```
shopee-dashboard-vercel/
├── vercel.json
├── package.json
├── db/schema.sql
├── lib/
│   ├── db.js              # koneksi Neon
│   ├── shopeeSign.js       # signature HMAC-SHA256 (shop-level & auth-level)
│   └── shops.js            # baca config 2 toko dari DB (bukan env lagi)
├── api/
│   ├── report.js           # GET data harian + summary bulanan
│   ├── shops.js            # GET daftar toko
│   ├── hpp.js               # GET publik, POST/DELETE pakai ADMIN_SECRET
│   ├── next-refresh.js      # GET utk countdown
│   ├── admin/
│   │   ├── auth-url.js      # generate link authorize (setup awal)
│   │   └── exchange-code.js # tukar code -> access_token pertama
│   └── cron/
│       ├── pull.js          # dipanggil scheduler tiap 15 menit
│       └── refresh-token.js # dipanggil scheduler tiap 3 jam
└── public/index.html        # dashboard
```
