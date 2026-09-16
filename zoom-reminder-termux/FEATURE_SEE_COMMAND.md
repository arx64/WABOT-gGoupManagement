# Fitur `/see` Command - View Once File Handler

## Deskripsi
Fitur ini memungkinkan bot untuk mengirim kembali file "sekali dilihat" (view-once) dari WhatsApp sebagai file biasa yang dapat dilihat berkali-kali.

## Cara Penggunaan

### Langkah-langkah:
1. **Reply pesan yang berisi file sekali dilihat** dengan menuliskan `/see`
2. Bot akan mengunduh file tersebut dan mengirimkannya kembali sebagai file biasa (non-view-once)
3. File dapat dilihat berkali-kali setelah itu

### Contoh:
```
User A mengirim foto sekali dilihat
Anda reply dengan: /see
Bot akan mengirim foto tersebut sebagai file biasa
```

## Jenis File yang Didukung
- 📷 **Gambar** (Image) - JPEG, PNG, dll
- 🎬 **Video** - MP4, dll
- 🎵 **Audio** - MP3, voice note, dll
- 📄 **Dokumen** - PDF, Word, Excel, dll
- 🎨 **Sticker** - Webp sticker

## Fitur
- ✅ Mengunduh file dari pesan sekali dilihat
- ✅ Mengirim kembali sebagai file biasa
- ✅ Mempertahankan metadata file (nama, mime type, caption)
- ✅ Mendukung semua jenis media
- ✅ Error handling jika file bukan media

## Catatan Teknis
- Command hanya bekerja jika Anda **me-reply** pesan yang berisi file
- Pesan harus berisi media (image, video, audio, document, atau sticker)
- Bot menggunakan `downloadMediaMessage` dari Baileys untuk mengunduh file
- File dikirim dengan metadata asli yang dipelihara

## Implementasi di Code
- **File:** `index.js`
- **Lokasi:** Setelah command `/end` (sekitar line 320-400)
- **Menu:** Kategori "MEDIA & FILE" (emoji: 📎)

## Command dalam Menu
```
📎 *MEDIA & FILE*
─────────────────────────────────
  /see
    └─ Kirim file sekali dilihat sebagai file biasa (reply pesan)
```
