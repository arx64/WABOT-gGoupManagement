# 📋 Testing Guide - Deleted Message Detection

## Prerequisites
- Bot Baileys sudah running
- Bot sudah terhubung ke WhatsApp
- Openai API/GPT sudah configured (untuk fitur AI)

## Cara Testing Fitur

### Test 1: Personal Chat - Deleted Text Message
1. Buka chat pribadi dengan nomor yang menjalankan bot
2. Kirim pesan teks apapun, misalnya: "Halo ini pesan tes"
3. **Segera** hapus pesan tersebut dengan swipe (iOS) atau long-press > Delete (Android)
4. **Hasil Expected**: Bot akan mengirim notifikasi:
   ```
   🗑️ *Pesan yang Dihapus*

   👤 Dari: [Nama Anda]
   💬 Halo ini pesan tes
   ```

### Test 2: Personal Chat - Deleted Image with Caption
1. Kirim gambar dengan caption: "Foto aku nih"
2. Segera hapus pesan
3. **Hasil Expected**: Bot akan melaporkan:
   ```
   🗑️ *Pesan yang Dihapus*

   👤 Dari: [Nama Anda]
   💬 📸 Gambar: Foto aku nih
   ```

### Test 3: Group Chat - Deleted Message
1. Pergi ke grup yang berisi bot
2. Kirim pesan teks: "Ini pesan di grup"
3. Segera hapus pesan
4. **Hasil Expected**: Bot akan melaporkan dengan mention:
   ```
   🗑️ *Pesan Dihapus*

   👤 Pengguna: @[Nomor Anda]
   💬 Isi: Ini pesan di grup
   ```

### Test 4: Multiple Deleted Messages
1. Kirim 3-4 pesan berbeda dalam waktu singkat
2. Hapus semuanya dengan cepat
3. **Hasil Expected**: Bot akan mengirim notifikasi untuk setiap pesan yang dihapus

### Test 5: View-Once Message Deletion
1. Kirim pesan View-Once (media sekali lihat)
2. Hapus sebelum dibuka
3. **Hasil Expected**: Bot melaporkan:
   ```
   💬 👁️ Pesan Sekali Lihat (View-Once)
   ```

## Monitoring & Debugging

### Console Logs
Saat fitur berjalan, Anda akan melihat di console:

**Ketika pesan diterima dan dicache:**
```
(Tidak ada log tercetak - caching silent)
```

**Ketika pesan dihapus terdeteksi & dilaporkan:**
```
✅ Pesan dihapus terdeteksi dan dilaporkan di [chatId]
```

**Ketika pesan dihapus tapi cache kosong:**
```
⚠️ Pesan dihapus terdeteksi (messageId) tapi data tidak ditemukan di cache
```

**Cleanup otomatis (setiap 1 jam):**
```
🧹 Membersihkan cache pesan yang sudah lama...
```

### Checking Cache Status
Untuk debug, Anda bisa menambahkan logging di `index.js`:

```javascript
// Tambahkan ini di messages.upsert handler setelah caching:
console.log(`📌 Cached message: ${msg.key.id} from ${messageArr.key.participant || messageArr.key.remoteJid}`);
```

## Edge Cases & Known Issues

### Issue 1: Cache Tidak Tersimpan
**Gejala**: Pesan dihapus tapi tidak ada notifikasi
**Penyebab**: 
- Pesan diterima setelah bot ter-disable caching (jarang terjadi)
- Bot restart sebelum deteksi revocation

**Solusi**: 
- Pastikan koding caching tidak ada kondisi yang skip
- Gunakan database untuk persistent cache (future enhancement)

### Issue 2: Delay Detection
**Gejala**: Ada delay antara penghapusan dan notifikasi
**Penyebab**: WhatsApp timing untuk send update ke client

**Solusi**: Normal behavior, Baileys tergantung server WhatsApp

### Issue 3: Multiple Notifications
**Gejala**: Bot mengirim 2x atau lebih notifikasi untuk 1 pesan delete
**Penyebab**: Baileys mengirim multiple update events

**Solusi**: Tambahkan tracking di cache untuk prevent duplicate:
```javascript
// Di deletedMessageHandler.js - tambahkan flag
export const processedRevokes = new Set();

// Di index.js - sebelum sendMessage:
const revokeKey = `${remoteJid}-${messageId}`;
if (processedRevokes.has(revokeKey)) continue;
processedRevokes.add(revokeKey);

// Cleanup revokes yang lama (tambahkan ke cleanup function)
if (processedRevokes.size > 5000) {
  // reset jika terlalu besar
  processedRevokes.clear();
}
```

## Performance Notes

### Memory Usage
- Default cache: max 1000 messages per chat
- Typical size: ~2-5 MB untuk 10 chats aktif
- Cleanup: otomatis setiap 1 jam

### CPU Impact
- Minimal: hanya proses ketika ada message updates
- Cleanup: 50-100ms setiap 1 jam

## Testing Checklist

- [ ] Test deleted text message (personal)
- [ ] Test deleted image with caption (personal)  
- [ ] Test deleted message in group
- [ ] Test multiple consecutive deletions
- [ ] Test view-once message deletion
- [ ] Verify notification mentions in group
- [ ] Check console logs for errors
- [ ] Monitor memory usage over time
- [ ] Test cache cleanup (wait 1 hour or modify interval)
- [ ] Test after bot restart (cache should be empty at start)

---

**Tips untuk Production:**
1. Monitor console untuk error messages
2. Set up log file untuk tracking deleted messages
3. Pertimbangkan persistent storage jika perlu history
4. Regular test untuk memastikan fitur tetap berfungsi
