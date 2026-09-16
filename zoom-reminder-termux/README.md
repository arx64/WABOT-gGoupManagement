# Zoom Reminder Termux/Android

Versi ini disiapkan untuk menjalankan bot `zoom-reminder` di Termux/Android.

Folder ini tidak membawa file privat dari project utama:

- `.env`
- `creds.json`
- `auth_info_baileys`
- `node_modules`
- `reminders.db`
- `leaderboard.db`
- `logs`

File tersebut dibuat ulang di Android saat setup atau saat bot berjalan.

## Isi Folder

- `index.js` menjalankan bot WhatsApp utama.
- `package.json` berisi dependency yang sudah disesuaikan untuk Termux.
- `setup-termux.sh` menginstall paket Termux dan dependency Node.
- `start-termux.sh` menjalankan bot dengan env Android.
- `.env.termux.example` template config Android.
- `README_TERMUX.md` catatan teknis Termux tambahan.

## Syarat

- Android dengan Termux dari F-Droid.
- Koneksi internet stabil.
- Ruang kosong cukup untuk dependency Node native.
- WhatsApp aktif untuk scan QR login Baileys.

## Install Di Termux

1. Install Termux dari F-Droid.
2. Buka Termux.
3. Beri akses storage jika folder disalin lewat storage Android:

   ```bash
   termux-setup-storage
   ```

4. Salin folder `zoom-reminder-termux` ke HP.
5. Masuk folder project:

   ```bash
   cd ~/zoom-reminder-termux
   ```

6. Jalankan setup:

   ```bash
   bash setup-termux.sh
   ```

7. Edit config:

   ```bash
   nano .env
   ```

8. Jalankan bot:

   ```bash
   npm run start:termux
   ```

9. Scan QR WhatsApp dari terminal. Jika dashboard aktif, buka URL lokal yang muncul, biasanya:

   ```text
   http://127.0.0.1:3000
   ```

## Config Penting

Edit `.env` sebelum dipakai:

```env
TZ=Asia/Jakarta
PORT=3000
PYTHON_BIN=python
KHS_ENABLED=false
OWNER_NUMBER=628xxxxxxxxxx
OPENAI_API_KEY=
EDLINK_BEARER=
EDLINK_NOTIFY_JID=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost
GOOGLE_REFRESH_TOKEN=
GOOGLE_DRIVE_FOLDER_ID=
DRIVE_PUBLIC=0
AUTO_VIEW_ONCE_JIDS=
AUTO_VIEW_STORY_JIDS=
DELETED_MESSAGE_DETECTION=true
WOLVESVILLE_API_KEY=
```

`OWNER_NUMBER` wajib diisi untuk perintah owner.

## Jalankan Agar Tidak Mati

Android sering mematikan aplikasi background. Pakai opsi ini:

```bash
termux-wake-lock
pkg install -y tmux
tmux new -s zoom-reminder
npm run start:termux
```

Keluar dari session tanpa mematikan bot:

```text
Ctrl+b lalu d
```

Masuk lagi:

```bash
tmux attach -t zoom-reminder
```

Matikan battery optimization untuk Termux lewat Settings Android agar proses lebih stabil.

## Fitur Yang Jalan Di Termux

- Bot WhatsApp via Baileys.
- Reminder Zoom.
- Scheduler reminder.
- Notes.
- Game lokal berbasis JSON.
- Leaderboard SQLite via `better-sqlite3`.
- Auto view-once/story jika WhatsApp Web dan Baileys masih mendukung.
- Edlink scheduler jika token valid.
- Google Drive upload jika OAuth sudah disiapkan.
- OpenAI/GPT jika `OPENAI_API_KEY` diisi.

## Fitur Terbatas Di Android/Termux

- `app.py` KRS/KHS memakai Selenium + Chrome headless. Di Termux tidak stabil, jadi default mati lewat `KHS_ENABLED=false`.
- `hash_file_verifier_gui.py` dan `stego_gui.py` memakai `tkinter`. Termux standar tidak punya GUI desktop.
- File PHP seperti `edlink.php`, `nilai.php`, `tes.php`, `test.php` tidak dipakai bot utama. Bisa dicoba jika install `php`, tapi versi Node lebih disarankan.
- Uptime 24 jam di HP tidak seandal VPS karena battery killer, jaringan tidur, dan thermal throttling.

## Opsi Pengganti Fitur Terbatas

- KRS/KHS Selenium: jalankan di laptop/VPS, atau ubah scraper menjadi request API tanpa Chrome.
- GUI Python: ubah menjadi CLI, atau jalankan di desktop.
- Uptime stabil: deploy ke VPS Linux kecil, lalu pakai `pm2` atau `systemd`.

## Troubleshooting

Jika `npm install` gagal saat compile native module:

```bash
pkg install -y nodejs-lts python make clang pkg-config sqlite openssl libjpeg-turbo libpng
npm install --build-from-source
```

Jika QR tidak muncul:

```bash
rm -rf auth_info_baileys
npm run start:termux
```

Jika bot mati saat layar terkunci:

```bash
termux-wake-lock
```

Lalu matikan battery optimization untuk Termux.

Jika port dipakai:

```bash
PORT=3001 npm run start:termux
```

Jika database error, hapus database lokal dan start ulang:

```bash
rm -f reminders.db leaderboard.db
npm run start:termux
```

## Catatan Keamanan

Jangan upload file ini ke GitHub publik:

- `.env`
- `creds.json`
- `auth_info_baileys`
- `reminders.db`
- `leaderboard.db`

File tersebut berisi token, session WhatsApp, atau data pribadi.