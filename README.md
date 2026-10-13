# Zoom Reminder

Bot WhatsApp berbasis Node.js untuk pengingat jadwal, otomasi akademik, pengelolaan grup, permainan, pencatatan, dan pengiriman pesan terjadwal.

## Fitur utama

- Koneksi WhatsApp menggunakan Baileys.
- QR viewer melalui web pada endpoint `/qr`.
- Reminder jadwal kuliah dan pengiriman pesan terjadwal.
- Integrasi EdLink untuk jadwal, tugas, dan absensi.
- Scraping KRS/KHS, transkrip, dan KTM melalui `app.py`.
- Upload file ke Google Drive.
- Manajemen grup: tambah anggota, keluarkan anggota, tag semua anggota, dan ekspor anggota.
- Notes sederhana berbasis database.
- Permainan WhatsApp dan leaderboard.
- Konversi pesan view-once menjadi file biasa serta deteksi pesan yang dihapus.
- Auto-view story berdasarkan nomor tertentu atau semua nomor.

## Persyaratan

- Node.js dan npm.
- Python 3 untuk fitur scraping SIAKAD.
- Browser Chromium/Google Chrome yang kompatibel dengan Selenium untuk scraping.
- Kredensial dan konfigurasi layanan yang diperlukan di file `.env`.

## Instalasi

```bash
cd D:/zoom-reminder
npm install
```

Salin konfigurasi contoh, lalu isi nilai yang sesuai:

```bash
cp .env.example .env
```

Jangan commit file `.env` atau kredensial apa pun ke repository.

## Menjalankan bot

```bash
npm start
```

Secara default, QR viewer berjalan pada port `2004` dan dapat dibuka di:

```text
http://localhost:2004/qr
```

Server mendengarkan pada `0.0.0.0`, sehingga dapat diakses dari perangkat lain dalam jaringan yang sama menggunakan alamat IP komputer, misalnya:

```text
http://192.168.8.6:2004/qr
```

Jika port perlu diubah, tambahkan pada `.env`:

```env
PORT=2004
```

## Konfigurasi `.env`

Variabel penting yang tersedia di `.env.example` antara lain:

- `PORT` — port QR viewer.
- `NINE_ROUTER_BASE_URL`, `NINE_ROUTER_MODEL`, `NINE_ROUTER_FALLBACK_MODELS`, dan `NINE_ROUTER_API_KEY` — endpoint, model utama, daftar model cadangan (dipisahkan koma), dan autentikasi untuk command `/ai` melalui 9Router lokal. Fallback dicoba otomatis saat error menunjukkan model tidak tersedia.
- `UKT_MONTHS` — daftar bulan pembayaran UKT yang dipantau sesuai jadwal cicilan: `Januari,Maret,April,Mei,Juni,Juli,September,Oktober,November,Desember`; Februari dan Agustus tidak termasuk.
- `UKT_DRIVE_ROOT_FOLDER_ID` — folder induk Google Drive opsional khusus arsip UKT. Di dalamnya bot membuat `UKT Yulia Khairani/Tahun/Bulan`. Jika kosong, fitur menggunakan `GOOGLE_DRIVE_FOLDER_ID` atau root My Drive.
- `OWNER_NUMBER` — nomor pemilik bot tanpa tanda `+`.
- `DELETED_MESSAGE_DETECTION` — aktif/nonaktifkan deteksi pesan yang dihapus.
- `AUTO_VIEW_ONCE_JIDS` — daftar nomor untuk auto-view-once.
- `AUTO_VIEW_STORY_JIDS` — daftar nomor untuk auto-view story; gunakan `*` untuk semua story.
- `SEE_OUTPUT_TARGET` — tujuan output command `/see`, yaitu `chat` atau `owner`.
- `EDLINK_BEARER`, `EDLINK_EMAIL`, dan `EDLINK_PASSWORD` — kredensial EdLink.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, dan `GOOGLE_REFRESH_TOKEN` — konfigurasi Google Drive.
- `GOOGLE_DRIVE_FOLDER_ID` — folder tujuan Google Drive, jika digunakan.
- `DRIVE_PUBLIC` — gunakan `1` jika file Drive ingin dibuat publik.
- `WOLVESVILLE_API_KEY` — opsional, untuk integrasi API Wolvesville.

## Perintah WhatsApp

Ketik `/menu` untuk melihat menu lengkap. Perintah utama meliputi:

### Akademik

- `/tugas` — melihat tugas/kuis EdLink yang terbuka.
- `/jadwal` — melihat jadwal mingguan.
- `/absen` — melihat data absensi.
- `/khs` — menjalankan scraping KRS/KHS/transkrip/KTM.

### Reminder dan pesan terjadwal

- `/list` — melihat semua reminder.
- `/addList "Nama Kuliah" <Link> <Jam> <Hari>` — menambah reminder.
- `/delete <ID>` — menghapus reminder.
- `/send <nomor>` — membuat sesi pengiriman pesan terjadwal.
- `/sendlist` — melihat pesan terjadwal.
- `/sendcancel <ID>` — membatalkan pesan terjadwal.

### Grup

- `/add` — menambah anggota.
- `/kick` — mengeluarkan anggota.
- `/tagall` — menandai semua anggota grup.
- `/new "Nama Grup"` — membuat grup dari file TXT.
- `/getAllMember` — mengekspor anggota grup.

### Notes dan media

- `/notes <teks>` — membuat catatan.
- `/notes show` — melihat semua catatan.
- `/notes <ID>` — melihat catatan tertentu.
- `/notes delete <ID>` — menghapus catatan.
- `/see` — mengirim pesan view-once sebagai file biasa melalui reply.
- `/ukt list` — menampilkan tahun dan bulan yang memiliki bukti UKT.

Kirim gambar dengan caption `/ukt` untuk mengarsipkan bukti pembayaran. Bot membuat folder `UKT Yulia Khairani/Tahun/Bulan` di Google Drive; folder tahun/bulan lama di root tetap dibaca oleh `/ukt list`. Jika upload Drive gagal, gambar disimpan pada `uploads/ukt/Tahun/Bulan` di komputer bot.

### Owner

- `/rahasia` — melihat atau mengelola konfigurasi `.env`.
- `/rahasia set KEY=VALUE` — mengubah konfigurasi.
- `/rahasia get KEY` — melihat nilai konfigurasi tertentu.

## Struktur penting

```text
.
├── index.js                 # Entry point bot dan QR viewer
├── app.py                   # Otomasi/scraping SIAKAD
├── package.json             # Dependensi dan script npm
├── .env.example             # Template konfigurasi
├── auth/                    # Utilitas autentikasi Google
├── auth_info_baileys/       # Sesi autentikasi WhatsApp
├── database/                # Data permainan dan konfigurasi terkait
├── db/                      # Modul database
├── games/                   # Handler permainan
├── migrations/              # Migrasi database
├── utils/                   # Utilitas umum, termasuk view-once dan Drive
└── logs/                    # Log aplikasi
```

Folder `auth_info_baileys` berisi kredensial sesi WhatsApp. Jangan membagikan atau meng-commit folder tersebut.

## Pengujian

Jalankan test yang tersedia dengan:

```bash
npm test
```

Untuk memeriksa sintaks entry point tanpa menjalankan koneksi WhatsApp:

```bash
node --check index.js
```

## Catatan operasional

- Pastikan nomor `OWNER_NUMBER` benar sebelum menggunakan command owner.
- Simpan backup database dan folder sesi sebelum melakukan perubahan besar.
- Jangan membagikan token EdLink, refresh token Google, password, atau file sesi WhatsApp.
- Setelah mengubah `.env`, gunakan mekanisme reload konfigurasi yang tersedia atau restart bot agar perubahan diterapkan.
