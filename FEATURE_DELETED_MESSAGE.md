# 🗑️ Fitur Deleted Message Detection

## Deskripsi
Fitur ini memungkinkan bot untuk menangkap dan melaporkan kembali pesan yang dihapus oleh pengguna. Ketika seseorang mengirim pesan dan kemudian menghapusnya, bot akan secara otomatis mengirim notifikasi ke chat yang sama berisi pesan yang dihapus tersebut.

## Cara Kerja

### 1. **Message Caching** 
- Setiap pesan yang diterima dari orang lain (bukan dari bot sendiri) akan disimpan dalam cache dalam memori
- Cache menyimpan metadata pesan seperti:
  - ID pesan
  - Waktu penerimaan
  - Nama pengirim (pushName)
  - JID pengirim
  - Konten lengkap pesan

### 2. **Revocation Detection**
- Bot memantau event `messages.update` dari Baileys
- Ketika ada pesan yang dihapus/direvoke, Baileys akan mengirim update dengan salah satu indikator:
  - `update.message === null` (field pesan menjadi null)
  - `update.messageStubType === 21` atau `22` (message stub types untuk delete)
  - `update.messageStubArguments` (arguments untuk penghapusan)

### 3. **Notification**
- Bot mengambil data pesan dari cache
- Bot membuat notifikasi yang informatif dengan format:
  - **Untuk Personal Chat**: Menampilkan nama pengirim dan konten pesan
  - **Untuk Group Chat**: Mention pengirim asli + konten pesan
- Bot mengirim notifikasi ke chat terkait

## Format Notifikasi

### Personal Chat
```
🗑️ *Pesan yang Dihapus*

👤 Dari: [Nama Pengirim]
💬 [Konten Pesan]
```

### Group Chat
```
🗑️ *Pesan Dihapus*

👤 Pengguna: @[Nomor Pengirim]
💬 Isi: [Konten Pesan]
```

## Tipe Pesan yang Didukung

Bot dapat mendeteksi dan melaporkan penghapusan dari:
- ✅ Pesan teks biasa
- ✅ Pesan teks extended
- ✅ Gambar dengan caption
- ✅ Video dengan caption
- ✅ Pesan suara/audio
- ✅ File/dokumen
- ✅ Sticker
- ✅ Kontak
- ✅ Lokasi
- ✅ Pesan View-Once (media sekali lihat)

## Konfigurasi

### Cache Settings
File: `utils/deletedMessageHandler.js`

```javascript
const MAX_MESSAGES_PER_CHAT = 1000;      // Max pesan per chat yang dicache
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000;  // Cache dihapus setelah 24 jam
```

### Cleanup
- Bot secara otomatis membersihkan cache yang sudah lama setiap **1 jam**
- Pesan yang sudah lebih dari 24 jam akan dihapus dari cache
- Jika cache per chat kosong, entry chat akan dihapus

## Implementasi Teknis

### Files yang Ditambahkan
1. `utils/deletedMessageHandler.js` - Module untuk handling deleted messages
   - `cacheMessage()` - Simpan pesan ke cache
   - `getCachedMessage()` - Ambil pesan dari cache
   - `removeCachedMessage()` - Hapus pesan dari cache
   - `formatDeletedMessage()` - Format konten pesan
   - `createDeletedMessageNotification()` - Buat notifikasi
   - `cleanupOldMessages()` - Cleanup cache otomatis

### Modifikasi pada `index.js`
1. Import module deletedMessageHandler
2. Tambahan caching di event handler `messages.upsert`
3. Tambahan event handler `messages.update` untuk deteksi revocation

## Limitations & Notes

⚠️ **Catatan Penting:**
- Cache hanya tersimpan **dalam memori** (tidak persistent)
- Jika bot restart, cache akan hilang
- Pesan yang dihapus **sebelum bot online** tidak akan terdeteksi
- Deteksi bergantung pada Baileys mendapat update dari WhatsApp Web
- Terkadang ada delay antara penghapusan pesan dan deteksi

💡 **Tips:**
- Untuk menyimpan log penghapusan secara permanen, tambahkan database logging
- Anda bisa extend module ini untuk menyimpan deleted messages ke file atau database

## Troubleshooting

### Fitur tidak bekerja
1. Pastikan Baileys versi `^7.0.0-rc.6` atau lebih baru
2. Cek console untuk error messages
3. Verifikasi bahwa pesan diterima dengan baik (cached dengan benar)

### Cache terlalu besar
- Kurangi `MAX_MESSAGES_PER_CHAT` di `deletedMessageHandler.js`
- Atau kurangi `MAX_CACHE_AGE_MS` untuk cleanup lebih cepat

### Pesan deleted tidak terdeteksi
- Kemungkinan Baileys belum menerima update dari WhatsApp Web
- Coba hapus pesan lebih lambat (tunggu 1-2 detik setelah mengirim sebelum dihapus)
- Check apakah update.message === null atau update.messageStubType value di console

## Masa Depan Enhancements

Ide untuk pengembangan lebih lanjut:
- [ ] Persistent logging ke database
- [ ] /showdeleted command untuk melihat history deleted messages
- [ ] Konfigurasi per-chat apakah ingin tracking deleted messages
- [ ] Encrypted storage untuk cache
- [ ] Statistics tracking (siapa sering hapus pesan, dll)
