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
| `CRON_SECRET` | string acak panjang | token utk lindungi `/api/cron/pull` & `/api/cron/refresh-token` |
| `ADMIN_SECRET` | string acak lain | token utk lindungi endpoint `/api/admin/*` & tulis-HPP |

Kredensial Shopee (partner_id, partner_key, shop_id, token) **tidak** diisi di sini — itu
diisi per toko lewat endpoint `/api/admin/*` di langkah 4, karena tiap toko punya App
Shopee yang berbeda. Redeploy setelah isi 3 env vars di atas.

### 4. Setup per toko: isi App credentials + authorize (sekali per toko)

**Penting:** karena Diansari Plastik dan Mitra Diansari masing-masing punya App Shopee
sendiri (partner_id & partner_key berbeda), langkah ini diulang **2x**, sekali untuk tiap toko.

**a) Isi partner_id & partner_key toko itu — lewat browser (paling aman, tanpa risiko salah escape tanda kutip):**
```
https://NAMA-PROJECT.vercel.app/api/admin/set-partner?shop=diansari_plastik&partner_id=ANGKA_PARTNER_ID&partner_key=PARTNER_KEY_TOKO_INI&admin_secret=ISI_ADMIN_SECRET
```
Buka di browser, harus muncul `{"ok":true, ...}`. Ambil `partner_id`/`partner_key` dari App yang
bersangkutan di open.shopee.com > My Apps.

**Cek ulang apa yang tersimpan** (kalau nanti dapat error "Wrong sign", cek dulu ke sini):
```
https://NAMA-PROJECT.vercel.app/api/admin/set-partner?shop=diansari_plastik&admin_secret=ISI_ADMIN_SECRET
```
Cocokkan panjang & huruf awal/akhir `partner_key_tersimpan` dengan yang ada di App Shopee Anda.

**b) Minta link authorize untuk toko itu:**
```bash
curl -H "x-admin-secret: ISI_ADMIN_SECRET" \
  "https://NAMA-PROJECT.vercel.app/api/admin/auth-url?shop=diansari_plastik&redirect_url=https://NAMA-PROJECT.vercel.app"
```
Buka `auth_url` yang dikembalikan di browser (login sbg pemilik toko), setujui.

**c) Setelah disetujui**, Anda diarahkan ke `redirect_url` dengan tambahan `?code=...&shop_id=...`
di URL-nya. Salin kedua nilai itu, lalu tukar jadi token pertama:
```bash
curl -X POST -H "x-admin-secret: ISI_ADMIN_SECRET" -H "Content-Type: application/json" \
  -d '{"shop":"diansari_plastik","code":"CODE_DARI_URL","shop_id":"SHOP_ID_DARI_URL"}' \
  "https://NAMA-PROJECT.vercel.app/api/admin/exchange-code"
```

**Ulangi a–c untuk `"shop":"mitra_diansari"`** dengan partner_id/partner_key App toko itu.

Semua tersimpan otomatis ke tabel `shops` di Neon — tidak ada lagi yang perlu diisi manual di
Environment Variables Vercel untuk kredensial Shopee.

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

## Tarik data historis sekali (backfill)

Cron 15-menit hanya menangkap order **baru sejak dijalankan** — order yang sudah lewat
sebelum Anda setup tidak otomatis muncul. Untuk itu, jalankan backfill sekali (aman diulang
berkali-kali, tidak akan dobel hitung) lewat browser:

```
https://NAMA-PROJECT.vercel.app/api/admin/backfill?shop=mitra_diansari&admin_secret=ISI_ADMIN_SECRET
```
Defaultnya menarik dari **awal bulan berjalan** sampai sekarang. Mau rentang lain? Tambah
`&days_back=30` (maks 90 hari ke belakang).

Kalau toko ramai (order banyak) dan backfill kena timeout, panggil beberapa kali dengan
rentang lebih kecil, misal `&days_back=7`, lalu `&days_back=15`, dst — karena proses ini
idempotent, aman dipanggil berulang tanpa takut data dobel.

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
│   │   ├── set-partner.js   # isi partner_id/partner_key per toko (App beda2)
│   │   ├── auth-url.js      # generate link authorize (setup awal, perlu ?shop=)
│   │   ├── exchange-code.js # tukar code -> access_token pertama
│   │   └── backfill.js      # tarik data historis sekali (idempotent)
│   └── cron/
│       ├── pull.js          # dipanggil scheduler tiap 15 menit
│       └── refresh-token.js # dipanggil scheduler tiap 3 jam
└── lib/
    └── shopeePull.js         # logika tarik+simpan bersama (dipakai pull.js & backfill.js)
└── public/index.html        # dashboard
```
