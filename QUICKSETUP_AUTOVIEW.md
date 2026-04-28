# ⚡ Quick Setup - Auto View Features

## 30 Second Setup

### Step 1: Open `.env` file
```bash
# Windows: Open with any text editor
# Or use: code .env
```

### Step 2: Add One of These Config

#### Option A: Auto View-Once Only (RECOMMENDED)
```env
AUTO_VIEW_ONCE_JIDS=6281234567890,6281234567891,6282988223456
```

#### Option B: Auto View-Once + View All Stories
```env
AUTO_VIEW_ONCE_JIDS=6281234567890,6281234567891,6282988223456
AUTO_VIEW_STORY_JIDS=*
```

#### Option C: Auto View All Stories Only
```env
AUTO_VIEW_STORY_JIDS=*
```

### Step 3: Save & Restart Bot
```bash
# Stop bot (Ctrl+C)
# Start bot again
node index.js
```

### Step 4: Verify Configuration
Console akan menampilkan:
```
════════════════════════════════════════════════════════════
📱 AUTO VIEW CONFIGURATION:
────────────────────────────────────────────────────────────
✅ AUTO VIEW-ONCE: 6281234567890, 6281234567891, 6282988223456
✅ AUTO VIEW STORY: * (semua story)
════════════════════════════════════════════════════════════
```

---

## Format Nomor

```
✅ Valid:
   6281234567890     (with country code)
   081234567890      (without country code)
   +6281234567890    (with +)

❌ Invalid:
   6281234567890@s.whatsapp.net  (don't add @)
   0281234567890                 (leading 0, use 62xxx)
```

---

## Multiple Numbers

```env
# Comma separated, no spaces (spaces OK, will auto-trim)
AUTO_VIEW_ONCE_JIDS=6281234567890,6281234567891,6282988223456

# With spaces (will be trimmed)
AUTO_VIEW_ONCE_JIDS=62812345678 90, 6281234567891, 6282988223456

# Single number
AUTO_VIEW_ONCE_JIDS=6281234567890
```

---

## Wildcard Support

```env
# ONLY for AUTO_VIEW_STORY_JIDS:
AUTO_VIEW_STORY_JIDS=*    # Auto view semua story dari semua orang

# NOT for AUTO_VIEW_ONCE_JIDS:
AUTO_VIEW_ONCE_JIDS=*     # ❌ Tidak support, gunakan nomor spesifik
```

---

## What Happens

### Auto View-Once
1. Someone dari nomor di config mengirim view-once message (foto/video sekali lihat)
2. Bot deteksi & download media
3. Bot convert & send sebagai file biasa
4. Bot kirim notification

### Auto View Story
1. Someone dari nomor di config post story
2. Bot otomatis mark as read (view story)
3. Penerima bisa lihat kalau sudah di-view
4. Tidak ada pesan notification

---

## Disabled/Empty Config

```env
# Disabled dengan leaving empty:
AUTO_VIEW_ONCE_JIDS=

# Or comment it out:
# AUTO_VIEW_ONCE_JIDS=6281234567890
```

---

## Troubleshoot

### Config not working?
1. Check `.env` file (spelling correct?)
2. Restart bot (config load saat startup)
3. Check console log untuk error messages
4. Verify nomor format (62xxxxx tanpa @)

### Need help?
Read: **AUTO_VIEW_CONFIG.md** (dokumentasi lengkap)

---

## Done! ✨

That's it! Config sekarang aktif dan siap digunakan.
