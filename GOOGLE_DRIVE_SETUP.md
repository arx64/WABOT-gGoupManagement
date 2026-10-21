# Google Drive OAuth2 Setup Guide

Panduan setup Google Drive menggunakan OAuth2 (User Account) untuk WhatsApp Bot.

## Perubahan dari Service Account ke OAuth2

| Sebelum (Service Account) | Sesudah (OAuth2) |
|---------------------------|------------------|
| Storage terpisah (0GB) | My Drive pribadi (15GB) |
| Butuh Shared Drive | Langsung ke My Drive |
| Service Account JSON | OAuth2 Client ID/Secret |
| `GOOGLE_SERVICE_ACCOUNT_KEY` | `GOOGLE_REFRESH_TOKEN` |

## Langkah Setup

### 1. Buat Project di Google Cloud Console

1. Buka [Google Cloud Console](https://console.cloud.google.com/)
2. Buat project baru atau pilih project existing
3. Enable **Google Drive API**:
   - Menu ≡ → APIs & Services → Library
   - Cari "Google Drive API"
   - Klik "Enable"

### 2. Buat OAuth2 Credentials

1. Menu ≡ → APIs & Services → Credentials
2. Klik "Create Credentials" → "OAuth client ID"
3. Pilih "Desktop app" sebagai Application type
4. Beri nama (contoh: "WhatsApp Bot Desktop")
5. Klik "Create"
6. **Copy Client ID dan Client Secret** (simpan baik-baik!)

### 3. Update Environment Variables

Tambahkan ke file `.env`:

```env
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost
GOOGLE_REFRESH_TOKEN=
```

### 4. Generate Refresh Token

Jalankan script generator:

```bash
node auth/generateToken.js
```

Ikuti instruksi:
1. Buka URL yang muncul di browser
2. Login dengan akun Gmail Anda
3. Berikan izin akses Google Drive
4. Copy authorization code dari URL
5. Paste ke terminal
6. Copy **refresh token** yang dihasilkan

### 5. Finalisasi .env

Tambahkan refresh token ke `.env`:

```env
GOOGLE_REFRESH_TOKEN=your_refresh_token_here
```

### 6. Test Koneksi

```bash
node -e "import('./utils/driveClient.js').then(m => m.testConnection()).then(console.log).catch(console.error)"
```

Jika berhasil, akan muncul info user dan storage quota.

## Troubleshooting

### Error: "Missing required environment variables"

Pastikan semua variabel di `.env` sudah terisi:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_REFRESH_TOKEN`

### Error: "invalid_grant"

`invalid_grant` saat refresh berarti Google menolak refresh token (misalnya token kedaluwarsa/dicabut, dibuat untuk OAuth Client ID yang berbeda, atau ada masalah kebijakan OAuth). Auto-refresh pada `googleapis` hanya dapat memperbarui access token selama refresh token masih valid; refresh token yang ditolak tidak dapat diperbaiki otomatis.

Langkah pemulihan:
1. Pastikan `GOOGLE_CLIENT_ID` dan `GOOGLE_CLIENT_SECRET` di `.env` adalah pasangan OAuth client yang sama dengan yang dipakai ketika token dibuat.
2. Jalankan `node auth/generateToken.js` dari direktori proyek dan selesaikan otorisasi Google dengan akun pemilik Drive yang benar.
3. Ganti nilai `GOOGLE_REFRESH_TOKEN` di `.env` dengan token baru yang ditampilkan oleh generator. Jangan kirim atau commit token tersebut ke siapa pun.
4. Restart bot dan uji upload/fitur `/ukt`.

Jika generator tidak menampilkan refresh token baru, cabut akses aplikasi di https://myaccount.google.com/permissions lalu jalankan generator lagi dengan persetujuan baru (`prompt: 'consent'` sudah diatur di script).

### Error: "insufficient permissions"

Saat generate token, pastikan Anda mencentang izin untuk Google Drive.

### Token Expired

Access token akan otomatis di-refresh menggunakan refresh token selama refresh token tetap valid. Jika log menunjukkan `invalid_grant`, lakukan langkah pemulihan di atas.

## Fitur

- ✅ Upload ke My Drive pribadi (15GB)
- ✅ Auto-refresh access token
- ✅ Support folder spesifik (`GOOGLE_DRIVE_FOLDER_ID`)
- ✅ Support file public permission (`DRIVE_PUBLIC=1`)
- ✅ Fallback ke local storage jika Drive gagal

## Struktur File

```
auth/
  generateToken.js      # Script setup token (run once)
utils/
  driveClient.js        # OAuth2 client & Drive API
uploadManager.js        # Upload logic (refactored)
.env                    # Environment variables
```
