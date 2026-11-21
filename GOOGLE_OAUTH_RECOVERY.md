# Auto-recovery OAuth Google untuk `/see`

Fitur ini memakai OAuth 2.0 resmi Google. Jika refresh token ditolak, `/see` menahan upload di memori, mengirim link persetujuan ke WhatsApp owner, lalu melanjutkan upload setelah callback berhasil. Token tidak dikirim melalui WhatsApp.

## Prasyarat wajib

1. Google Drive API sudah aktif pada project Google Cloud yang digunakan bot.
2. Buat OAuth Client ID tipe **Web application**. Client ID tipe Desktop App tidak cocok untuk callback HTTPS publik.
3. Siapkan domain HTTPS publik atau tunnel HTTPS yang diteruskan ke port Node.js bot (default `2004`). Callback harus bisa diakses dari browser HP.
4. Pada Google Cloud Console, masukkan Authorized redirect URI yang persis sama dengan `GOOGLE_REDIRECT_URI`, misalnya `https://domain-kamu.example/oauth/google/callback`.
5. Pastikan `OWNER_NUMBER`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, dan `GOOGLE_REFRESH_TOKEN` tersedia di `.env`.

Contoh `.env` (ganti domain dengan domain HTTPS kamu yang benar-benar aktif):

```env
GOOGLE_CLIENT_ID=client-id-dari-google
GOOGLE_CLIENT_SECRET=client-secret-dari-google
GOOGLE_REDIRECT_URI=https://domain-kamu.example/oauth/google/callback
GOOGLE_REFRESH_TOKEN=refresh-token-lama-yang-ada
OWNER_NUMBER=628xxxxxxxxxx
```

Jangan masukkan nilai rahasia ke Git, jangan kirim token ke WhatsApp, dan jangan bagikan link autentikasi kepada orang lain.

## Cara migrasi dari konfigurasi lama

1. Siapkan OAuth client tipe Web application dan callback HTTPS terlebih dahulu.
2. Perbarui `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, dan `GOOGLE_REDIRECT_URI` di `.env`. Pertahankan refresh token lama untuk memicu pemulihan pertama kali.
3. Restart bot.
4. Reply media view-once dan jalankan `/see`.
5. Jika refresh token lama ditolak, buka link Google yang dikirim ke WhatsApp owner, login ke akun pemilik Drive, lalu setujui akses.
6. Setelah Google mengarahkan kembali ke callback, bot menyimpan refresh token baru ke `.env` dan melanjutkan upload yang tertunda.

## Callback HTTPS

Express di bot menyediakan `GET /oauth/google/callback`. Domain/tunnel/reverse proxy harus meneruskan path ini ke aplikasi Node.js tanpa menghapus query `code` dan `state`. Jangan memakai `http://localhost` untuk alur yang dibuka dari WhatsApp HP: `localhost` pada HP menunjuk ke HP, bukan Redmi 4A.

Jika menggunakan reverse proxy atau tunnel, pastikan HTTPS aktif, URL callback sama persis di Google Cloud Console dan `.env`, dan jangan mengekspos port aplikasi ke internet tanpa perlindungan yang sesuai.

## Batasan dan pencegahan duplikat

- Antrean upload berada di memori. Jangan restart bot ketika callback masih ditunggu; jika proses berhenti, jalankan `/see` lagi.
- Setiap upload memakai metadata `appProperties.seeJobId` untuk memeriksa apakah file untuk pekerjaan itu sudah ada sebelum membuat file baru.
- Jika Google menolak refresh token, auto-renewal tidak bisa dilakukan tanpa persetujuan pengguna baru. Setelah callback sukses, token baru digunakan otomatis.
- Generator lama `node auth/generateToken.js` hanya mendukung callback localhost. Untuk setup ini, ikuti alur pemulihan dari `/see` setelah konfigurasi HTTPS siap.
