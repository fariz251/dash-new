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

### 4. Pasang scheduler 15 menit (gratis)
Pakai https://cron-job.org (gratis, bisa tiap 1 menit sekalipun):
1. Buat akun, buat Cronjob baru.
2. URL: `https://NAMA-PROJECT-ANDA.vercel.app/api/cron/pull?token=ISI_CRON_SECRET_DISINI`
3. Interval: tiap 15 menit.
4. Simpan & aktifkan.

Dashboard publik ada di `https://NAMA-PROJECT-ANDA.vercel.app` — bisa dibuka siapa saja tanpa
login (sesuai yang Anda mau). Countdown di dashboard akan otomatis sinkron ke kelipatan 15
menit berikutnya.

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
3. Refresh `access_token` tiap ±3.5 jam (token Shopee cuma 4 jam) — belum ada endpoint
   otomatisnya di versi ini. Untuk sementara, perbarui manual di Environment Variables Vercel
   tiap token expired, atau beri tahu saya kalau mau saya buatkan endpoint refresh + cron
   terpisah utk ini juga.

## Struktur folder

```
shopee-dashboard-vercel/
├── vercel.json
├── package.json
├── db/schema.sql
├── lib/
│   ├── db.js            # koneksi Neon
│   ├── shopeeSign.js     # signature HMAC-SHA256
│   └── shops.js          # config 2 toko dari env var
├── api/
│   ├── report.js         # GET data harian + summary bulanan
│   ├── shops.js          # GET daftar toko
│   ├── hpp.js             # GET publik, POST/DELETE pakai ADMIN_SECRET
│   ├── next-refresh.js    # GET utk countdown
│   └── cron/pull.js       # dipanggil scheduler tiap 15 menit
└── public/index.html      # dashboard
```
