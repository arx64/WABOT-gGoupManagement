# 🎬 Auto View-Once & Auto View Story - Configuration Guide

## Overview
Fitur ini memungkinkan bot secara otomatis:
- **Auto View-Once**: Convert dan kirim media view-once (media sekali lihat) dari nomor tertentu sebagai file biasa
- **Auto View Story**: Otomatis "read" atau "view" story dari nomor tertentu atau semua nomor

## ⚙️ Configuration

### 1. Auto View-Once Setup

**Lokasi**: File `.env`

```env
# Auto convert view-once messages dari nomor-nomor tertentu
AUTO_VIEW_ONCE_JIDS=6281234567890,6281234567891,6282988223456
```

**Format**:
- Nomor WhatsApp tanpa kode negara (atau dengan kode negara 62)
- Separated by comma (`,`)
- Support whitespace (akan di-trim otomatis)

**Contoh Valid**:
```env
# Single number
AUTO_VIEW_ONCE_JIDS=6281234567890

# Multiple numbers
AUTO_VIEW_ONCE_JIDS=6281234567890,6281234567891,6282988223456

# With spaces (akan di-trim)
AUTO_VIEW_ONCE_JIDS=62812345678 90, 6281234567891  , 6282988223456

# Empty / Disabled
AUTO_VIEW_ONCE_JIDS=
# atau tidak ada di .env sama sekali
```

### 2. Auto View Story Setup

**Lokasi**: File `.env`

```env
# Option A: Auto view SEMUA story (wildcard)
AUTO_VIEW_STORY_JIDS=*

# Option B: Auto view story dari nomor-nomor spesifik
AUTO_VIEW_STORY_JIDS=6281234567890,6281234567891,6282988223456

# Option C: Disabled
AUTO_VIEW_STORY_JIDS=
# atau tidak ada di .env sama sekali
```

**Format**:
- `*` = View ALL stories dari semua orang
- Nomor WhatsApp = View hanya dari nomor-nomor tertentu
- Comma separated untuk multiple numbers
- Support whitespace (akan di-trim)

## 🎯 Behavior

### Auto View-Once
Ketika seseorang dari nomor yang terdaftar mengirim **view-once message** (foto/video sekali lihat):

1. Bot **mendeteksi** view-once message
2. Bot **download** media dari view-once
3. Bot **convert** menjadi file biasa (tidak sekali lihat)
4. Bot **kirim** ke chat sebagai media biasa + notification

**Contoh Notifikasi:**
```
✅ Auto-convert: view-once dikirim sebagai file biasa.
```

**Supported Media Types:**
- 📸 Image dengan/tanpa caption
- 🎥 Video dengan/tanpa caption
- 📄 Document
- 🎵 Audio/Voice note
- 🎨 Sticker

### Auto View Story
Ketika diterima **status/story** dari nomor:

1. Bot **mendeteksi** incoming story
2. Bot **otomatis mark as read** (view story)
3. Bot **tidak mengirim notifikasi apapun** (silent)

**Notes:**
- Ini adalah "read receipt" dari WhatsApp
- Penerima akan lihat kalau story sudah di-view
- Tidak ada pesan notification dikirim ke user

## 📋 Examples

### Example 1: Only Auto View-Once (Recommended)
```env
AUTO_VIEW_ONCE_JIDS=6281234567890,6281234567891
AUTO_VIEW_STORY_JIDS=
```

**Result**:
- ✅ Auto convert view-once dari 2 nomor spesifik
- ❌ Tidak auto view story (biarkan manual)

### Example 2: Only Auto View Story (All)
```env
AUTO_VIEW_ONCE_JIDS=
AUTO_VIEW_STORY_JIDS=*
```

**Result**:
- ❌ Tidak auto convert view-once
- ✅ Auto view ALL stories

### Example 3: Both Features with Specific Numbers
```env
AUTO_VIEW_ONCE_JIDS=6281234567890,6281234567891,6282988223456
AUTO_VIEW_STORY_JIDS=6281234567890,6281234567891
```

**Result**:
- ✅ Auto convert view-once dari 3 nomor
- ✅ Auto view story dari 2 nomor
- Note: VIEW_ONCE number bisa lebih banyak dari STORY number

### Example 4: Both Features (All Stories)
```env
AUTO_VIEW_ONCE_JIDS=6281234567890,6281234567891
AUTO_VIEW_STORY_JIDS=*
```

**Result**:
- ✅ Auto convert view-once dari 2 nomor spesifik
- ✅ Auto view ALL stories dari semua orang

## 🔍 Verification

### Check Configuration at Bot Startup
Ketika bot start, akan ditampilkan log config:

```
════════════════════════════════════════════════════════════
📱 AUTO VIEW CONFIGURATION:
──────────────────────────────────────────────────────────── ✅ AUTO VIEW-ONCE: 6281234567890, 6281234567891, 6282988223456
✅ AUTO VIEW STORY: * (semua story)
════════════════════════════════════════════════════════════
```

### Troubleshot at Runtime

**Auto View-Once Activity**:
```
🔄 Auto-send view-once triggered for [chatId]
```

**Auto View Story Activity**:
```
🔄 Auto-viewing story from [numberJid]
✅ Auto-viewed story from [numberJid]
```

## ⚠️ Important Notes

### Auto View-Once
1. **Privacy**: Media masih ter-download oleh bot, jadi nomor yang mengirim tahu kalau media sudah di-view
2. **Storage**: Media di-download ke memory, tidak disimpan ke disk
3. **Timeout**: Default download timeout 30 detik
4. **Supported**: WhatsApp view-once messages (foto/video sekali lihat)

### Auto View Story
1. **Privacy**: Story owner bisa lihat kalau Anda sudah view
2. **Silent**: Tidak ada log/notification yang dikirim ke chat
3. **Instant**: Auto-view terjadi saat story diterima (immediate)
4. **Supported**: Hanya untuk status/story (WhatsApp status feature)

## 🔧 Troubleshooting

### Issue 1: Fitur tidak bekerja sama sekali
**Solusi**:
1. Check `.env` file ada `AUTO_VIEW_ONCE_JIDS` atau `AUTO_VIEW_STORY_JIDS`
2. Check format config (comma-separated, no @)
3. Restart bot
4. Check console log saat startup apakah config muncul
5. Verifikasi dengan kirim view-once dari nomor di config

### Issue 2: Hanya beberapa nomor yang work
**Solusi**:
1. Pastikan nomor benar (gunakan 62 untuk Indonesia)
2. Nomor harus tanpa @ symbol
3. Whitespace akan di-trim otomatis
4. Check exact config di console log

### Issue 3: Auto View-Once Error
**Gejala**: `❌ Gagal auto-convert view-once:`
**Solusi**:
1. Check media type (image/video/audio/document)
2. Check media size (tidak terlalu besar)
3. Check internet connection
4. Check timeout (mungkin server lambat)

### Issue 4: Story tidak ter-view
**Gejala**: Status tidak muncul di viewed list
**Solusi**:
1. Pastikan nomor di config correct
2. Check apakah bot online saat story diterima
3. Check console log untuk error messages
4. Verify Baileys mendapat status update

## 📝 Format Reference

### Valid Number Formats
```
✅ 6281234567890        (with country code)
✅ 081234567890         (without country code - sistem akan adjust)
✅ +6281234567890       (with + prefix - akan di-parse)

❌ 6281234567890@s.whatsapp.net    (don't include @)
❌ 6281234567890 @s.whatsapp.net   (spaces around @)
```

### Valid .env Config
```env
# Single
AUTO_VIEW_ONCE_JIDS=6281234567890

# Multiple
AUTO_VIEW_ONCE_JIDS=6281234567890,6281234567891,6282988223456

# With spaces
AUTO_VIEW_ONCE_JIDS=62812345678 90, 6281234567891, 6282988223456

# Wildcard (only for STORY)
AUTO_VIEW_STORY_JIDS=*

# Empty (disabled)
AUTO_VIEW_ONCE_JIDS=

# Or comment it out
# AUTO_VIEW_ONCE_JIDS=6281234567890
```

## 🚀 Best Practices

1. **Start Simple**: Gunakan auto view-once dulu sebelum auto view story
2. **Monitor**: Watch console log saat pertama kali setup
3. **Test**: Test dengan 1 nomor dulu sebelum multiple
4. **Security**: Jangan share config dengan nomor pribadi Anda
5. **Prefer Specific**: Lebih aman specify nomor daripada use * wildcard

## 📞 Support

Jika ada masalah:
1. Cek console log saat bot start (check config display)
2. Kirim view-once/story dan lihat log
3. Verify .env file format
4. Restart bot setelah change config

---

**Tips**: Wildcard `*` untuk auto view story sangat powerful tapi perlu hati-hati dengan privacy!
