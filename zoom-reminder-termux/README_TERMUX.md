# Zoom Reminder Termux/Android

Folder ini versi portabel untuk Termux. Secret, session WhatsApp, database lama, `node_modules`, log, dan cache tidak ikut disalin.

## Cara install di Termux

1. Install Termux dari F-Droid.
2. Buka Termux, lalu beri akses storage jika perlu:

   ```bash
   termux-setup-storage
   ```

3. Salin folder `zoom-reminder-termux` ke HP, misalnya ke `~/zoom-reminder-termux`.
4. Masuk folder proyek:

   ```bash
   cd ~/zoom-reminder-termux
   ```

5. Jalankan setup:

   ```bash
   bash setup-termux.sh
   ```

6. Edit config:

   ```bash
   nano .env
   ```

7. Jalankan bot:

   ```bash
   npm run start:termux
   ```

8. Scan QR WhatsApp dari terminal atau buka dashboard lokal jika app menampilkan URL `http://127.0.0.1:3000`.

## Jalankan terus di Android

Android bisa mematikan proses background. Opsi:

- Pakai `termux-wake-lock` sebelum start bot.
- Matikan battery optimization untuk Termux di Settings Android.
- Pakai `tmux` supaya session tidak hilang saat layar ditutup:

  ```bash
  pkg install -y tmux
  tmux new -s zoom-reminder
  npm run start:termux
  ```

- Masuk lagi ke session:

  ```bash
  tmux attach -t zoom-reminder
  ```

## Fitur yang jalan di Termux

- Bot WhatsApp via Baileys.
- Reminder Zoom dan scheduler.
- Notes.
- Game JSON lokal.
- Leaderboard SQLite memakai `better-sqlite3`.
- Auto view-once/story jika Baileys dan WhatsApp Web masih mendukung.
- Edlink API HTTP jika token valid.
- Google Drive upload jika OAuth token sudah dibuat.

## Fitur terbatas di Android/Termux

- `app.py` KRS/KHS pakai Selenium + Chrome headless. Di Termux ini tidak stabil dan default dimatikan lewat `KHS_ENABLED=false`.
- `hash_file_verifier_gui.py` dan `stego_gui.py` pakai `tkinter`, butuh GUI desktop. Tidak cocok untuk Termux standar.
- File PHP seperti `edlink.php`, `nilai.php`, `tes.php`, `test.php` tidak dipakai oleh bot utama. Bisa jalan jika install `php`, tapi versi Node sudah tersedia.
- Proses 24 jam penuh di HP tidak seandal VPS karena Android battery killer dan jaringan bisa tidur.

## Opsi pengganti fitur terbatas

- Untuk KRS/KHS Selenium: jalankan bot di VPS/laptop, atau buat ulang scraper memakai request API langsung tanpa Chrome.
- Untuk GUI Python: ubah jadi CLI, atau jalankan di laptop/desktop.
- Untuk uptime stabil: deploy folder ini ke VPS Linux kecil, lalu pakai `pm2`/`systemd`.

## Catatan dependency native

`better-sqlite3` compile saat `npm install`. Jika gagal, jalankan ulang:

```bash
pkg install -y nodejs-lts python make clang pkg-config sqlite
npm install --build-from-source
```

Jika Baileys gagal install karena native module gambar, pastikan `libjpeg-turbo` dan `libpng` sudah terpasang.