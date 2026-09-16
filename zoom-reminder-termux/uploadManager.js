/**
 * Upload Manager - WhatsApp Baileys
 * 
 * Upload files to Google Drive using OAuth2 (User Account)
 * with automatic fallback to local storage
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import stream from 'stream';
import db from './db.js';
import { getDriveClient } from './utils/driveClient.js';

const sessions = new Map(); // key: `${chatId}|${user}` -> { chatId, user, files: [] }
const driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || null;

async function ensureTable() {
  const exists = await db.schema.hasTable('uploads');
  if (!exists) {
    await db.schema.createTable('uploads', (t) => {
      t.increments('id');
      t.string('chat_id');
      t.string('uploader');
      t.string('filename');
      t.string('path');
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }
}

function sessionKey(chatId, user) { return `${chatId}|${user}`; }

/**
 * Upload file buffer to Google Drive using OAuth2
 * @param {Buffer} buffer - File buffer
 * @param {string} filename - File name
 * @param {string} mimeType - MIME type
 * @returns {Promise<Object>} { id, name, webViewLink? }
 */
async function uploadToDrive(buffer, filename, mimeType = 'application/octet-stream') {
  const drive = getDriveClient();
  const passthrough = new stream.PassThrough();
  passthrough.end(buffer);

  const resource = { name: filename };
  if (driveFolderId) resource.parents = [driveFolderId];

  const res = await drive.files.create({
    requestBody: resource,
    media: {
      mimeType,
      body: passthrough,
    },
    fields: 'id, name, mimeType'
  });

  const fileId = res.data.id;
  const out = { id: fileId, name: res.data.name };

  // Optionally make file publicly readable if requested
  if (process.env.DRIVE_PUBLIC === '1') {
    try {
      await drive.permissions.create({ 
        fileId, 
        requestBody: { role: 'reader', type: 'anyone' }
      });
      const meta = await drive.files.get({ 
        fileId, 
        fields: 'webViewLink, webContentLink'
      });
      out.webViewLink = meta.data.webViewLink;
      out.webContentLink = meta.data.webContentLink;
    } catch (e) {
      console.warn('[UploadManager] Failed to make Drive file public:', e.message || e);
    }
  }

  return out;
}

async function startSession(sock, chatId, user) {
  const key = sessionKey(chatId, user);
  if (sessions.has(key)) {
    await sock.sendMessage(chatId, { text: '⚠️ Sesi upload sudah aktif. Kirim file Anda atau ketik /end untuk selesai.' });
    return false;
  }
  sessions.set(key, { chatId, user, files: [] });
  await sock.sendMessage(chatId, { text: '📤 *Mode Upload Aktif*\n\nSilakan kirim file yang ingin Anda simpan:\n• Dokumen\n• Gambar\n• Video\n• Audio\n\nFile akan diupload ke Google Drive (My Drive 15GB).\n\nKetik /end jika sudah selesai.' });
  return true;
}

async function endSession(sock, chatId, user) {
  const key = sessionKey(chatId, user);
  const s = sessions.get(key);
  if (!s) {
    await sock.sendMessage(chatId, { text: '⚠️ Tidak ada sesi upload aktif.' });
    return false;
  }
  sessions.delete(key);
  
  if (s.files.length === 0) {
    await sock.sendMessage(chatId, { text: '❌ Sesi upload diakhiri. Tidak ada file yang berhasil disimpan.\n\n💡 Pastikan Anda mengirim file (dokumen/gambar/video) setelah ketik /upload' });
  } else {
    const fileList = s.files.map((f, i) => `${i + 1}. ${f.filename}`).join('\n');
    await sock.sendMessage(chatId, { text: `✅ Sesi upload selesai. *${s.files.length} file* berhasil disimpan:\n\n${fileList}\n\nKetik /upload show untuk melihat semua file Anda.` });
  }
  return true;
}

async function showFiles(sock, chatId, user) {
  await ensureTable();
  const rows = await db('uploads').select('*').where({ chat_id: chatId, uploader: user }).orderBy('created_at', 'desc');
  if (!rows.length) {
    await sock.sendMessage(chatId, { text: 'Belum ada file yang diupload oleh Anda di chat ini.' });
    return;
  }
  const lines = rows.map(r => `• ${r.filename} — ${r.path} — ${r.created_at}`);
  await sock.sendMessage(chatId, { text: `📁 *Daftar File Anda:*\n\n${lines.join('\n')}` });
}

async function saveBufferToFile(destPath, buffer) {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  await fs.promises.writeFile(destPath, buffer);
}

function unwrapMessage(message) {
  if (!message) return message;
  if (message.ephemeralMessage) return unwrapMessage(message.ephemeralMessage.message);
  if (message.viewOnceMessage) return unwrapMessage(message.viewOnceMessage.message);
  if (message.viewOnceMessageV2) return unwrapMessage(message.viewOnceMessageV2.message);
  if (message.documentWithCaptionMessage) return unwrapMessage(message.documentWithCaptionMessage.message);
  return message;
}

/**
 * Check if error is OAuth2 related
 */
function isOAuthError(error) {
  const msg = error.message || '';
  return msg.includes('invalid_grant') ||
         msg.includes('token expired') ||
         msg.includes('invalid_token') ||
         msg.includes('refresh_token') ||
         msg.includes('unauthorized_client');
}

/**
 * Get user-friendly error message
 */
function getOAuthErrorMessage(error) {
  const msg = error.message || '';
  
  if (msg.includes('invalid_grant')) {
    return '🔑 *Refresh token tidak valid atau sudah expired.*\n\n' +
           'Solusi:\n' +
           '1. Hapus akses aplikasi di https://myaccount.google.com/permissions\n' +
           '2. Jalankan ulang: node auth/generateToken.js\n' +
           '3. Update GOOGLE_REFRESH_TOKEN di .env';
  }
  
  if (msg.includes('insufficientPermissions') || msg.includes('insufficient permissions')) {
    return '🔒 *Izin akses Google Drive tidak cukup.*\n\n' +
           'Pastikan saat generate token, Anda memberikan izin untuk Google Drive.';
  }
  
  if (msg.includes('refresh_token') || msg.includes('token expired')) {
    return '⏰ *Access token expired dan tidak dapat di-refresh.*\n\n' +
           'Jalankan ulang: node auth/generateToken.js';
  }
  
  return `🔧 Error Google Drive: ${msg}\n\n` +
         'Jika error berlanjut, coba generate ulang token.';
}

async function handleIncomingMessage(messageObj, sock, { chatId, numberUser, pushName }) {
  const key = sessionKey(chatId, numberUser);
  const s = sessions.get(key);
  
  if (!s) {
    return false;
  }
  
  let message = messageObj.message || messageObj;
  message = unwrapMessage(message);
  
  const mediaTypes = ['documentMessage','imageMessage','videoMessage','audioMessage','stickerMessage'];
  const found = mediaTypes.find(t => !!message[t]);
  
  if (!found) {
    return false;
  }
  
  await ensureTable();

  try {
    const media = message[found];
    let filename = (media.fileName || media.caption || media.mimetype || '').toString();
    const extFromMime = (media.mimetype && media.mimetype.split('/').pop()) || '';
    if (!filename || filename.length > 200) {
      const id = messageObj.key?.id || Date.now();
      filename = `${id}.${extFromMime || 'bin'}`;
    }

    // Download content with retry
    let buffer = null;
    let lastError = null;
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`[UploadManager] Downloading ${found}, attempt ${attempt}/${maxRetries}...`);
        const streamIter = await downloadContentFromMessage(media, found.replace('Message',''));
        const chunks = [];
        for await (const chunk of streamIter) chunks.push(chunk);
        buffer = Buffer.concat(chunks);
        console.log(`[UploadManager] Downloaded ${buffer.length} bytes`);
        break;
      } catch (downloadErr) {
        lastError = downloadErr;
        console.error(`[UploadManager] Download attempt ${attempt} failed:`, downloadErr.message);
        if (attempt < maxRetries) await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    if (!buffer) {
      throw new Error(`Gagal mendownload file: ${lastError?.message}`);
    }

    // Upload to Google Drive
    let driveInfo = null;
    
    try {
      console.log(`[UploadManager] Uploading to Google Drive...`);
      driveInfo = await uploadToDrive(buffer, filename, media.mimetype || 'application/octet-stream');
      console.log(`[UploadManager] Uploaded to Drive, fileId: ${driveInfo.id}`);
    } catch (err) {
      console.error('[UploadManager] Drive upload error:', err.message);
      
      // Check if it's OAuth error - don't fallback, show proper error
      if (isOAuthError(err)) {
        throw err;
      }
      
      // Fallback to local save for other errors (network, etc.)
      console.log('[UploadManager] Falling back to local save...');
      try {
        const uploadsDir = path.join(process.cwd(), 'uploads', chatId.replace(/@/g,'_'));
        const dest = path.join(uploadsDir, `${Date.now()}_${filename}`);
        await saveBufferToFile(dest, buffer);
        await db('uploads').insert({ chat_id: chatId, uploader: numberUser, filename, path: dest });
        s.files.push({ filename, path: dest });
        
        await sock.sendMessage(chatId, { 
          text: `✅ File *${filename}* tersimpan *LOKAL*.\n\n📁 ${dest}\n\n⚠️ Google Drive error: ${err.message}\nKirim file lain atau ketik /end.` 
        });
        return true;
      } catch (localErr) {
        throw new Error(`Gagal ke Drive (${err.message}) dan lokal (${localErr.message})`);
      }
    }

    // Save to database
    const storedPath = driveInfo.webViewLink || `https://drive.google.com/file/d/${driveInfo.id}/view`;
    await db('uploads').insert({ chat_id: chatId, uploader: numberUser, filename, path: storedPath });
    s.files.push({ filename, path: storedPath });

    await sock.sendMessage(chatId, { 
      text: `✅ File *${filename}* tersimpan di Google Drive!\n\n📎 ${storedPath}\nKirim file lain atau ketik /end.` 
    });
    return true;
    
  } catch (err) {
    console.error('[UploadManager] Error:', err);
    
    let errorMsg;
    if (isOAuthError(err)) {
      errorMsg = getOAuthErrorMessage(err);
    } else if (err.message?.includes('ETIMEDOUT') || err.message?.includes('fetch failed')) {
      errorMsg = '⏱️ *Koneksi timeout.*\n💡 Pastikan internet stabil dan coba lagi.';
    } else {
      errorMsg = `❌ Error: ${err.message}`;
    }
    
    await sock.sendMessage(chatId, { text: errorMsg });
    return true;
  }
}

export default { startSession, endSession, showFiles, handleIncomingMessage };
