import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { downloadContentFromMessage } from '@whiskeysockets/baileys';
import { google } from 'googleapis';
import stream from 'stream';
import db from './db.js';

const sessions = new Map(); // key: `${chatId}|${user}` -> { chatId, user, files: [] }

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

// Google Drive client
let driveClient = null;
let driveFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID || null;

async function getDriveClient() {
  if (driveClient) return driveClient;

  // Load credentials either from file path or raw JSON in env
  let credentials = null;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_FILE) {
    const p = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
    credentials = JSON.parse(fs.readFileSync(p, 'utf8'));
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  }

  if (!credentials) {
    throw new Error('Google service account credentials not provided. Set GOOGLE_SERVICE_ACCOUNT_FILE or GOOGLE_SERVICE_ACCOUNT_KEY');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });
  const client = await auth.getClient();
  driveClient = google.drive({ version: 'v3', auth: client });
  return driveClient;
}

async function uploadToDrive(buffer, filename, mimeType = 'application/octet-stream') {
  const drive = await getDriveClient();
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
      await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
      const meta = await drive.files.get({ fileId, fields: 'webViewLink, webContentLink' });
      out.webViewLink = meta.data.webViewLink;
      out.webContentLink = meta.data.webContentLink;
    } catch (e) {
      console.warn('Failed to make Drive file public:', e.message || e);
    }
  }

  return out;
}

async function startSession(sock, chatId, user) {
  const key = sessionKey(chatId, user);
  if (sessions.has(key)) return false;
  sessions.set(key, { chatId, user, files: [] });
  await sock.sendMessage(chatId, { text: 'Silakan kirim file yang ingin Anda simpan. Jika sudah selesai, ketik /end' });
  return true;
}

async function endSession(sock, chatId, user) {
  const key = sessionKey(chatId, user);
  const s = sessions.get(key);
  if (!s) {
    await sock.sendMessage(chatId, { text: 'Tidak ada sesi upload aktif.' });
    return false;
  }
  sessions.delete(key);
  await sock.sendMessage(chatId, { text: `Sesi upload selesai. ${s.files.length} file disimpan.` });
  return true;
}

async function showFiles(sock, chatId, user) {
  await ensureTable();
  // show files uploaded by this user in this chat
  const rows = await db('uploads').select('*').where({ chat_id: chatId, uploader: user }).orderBy('created_at', 'desc');
  if (!rows.length) {
    await sock.sendMessage(chatId, { text: 'Belum ada file yang diupload oleh Anda di chat ini.' });
    return;
  }
  const lines = rows.map(r => `• ${r.filename} — disimpan: ${r.path} — ${r.created_at}`);
  await sock.sendMessage(chatId, { text: `Daftar file Anda:\n\n${lines.join('\n')}` });
}

async function saveBufferToFile(destPath, buffer) {
  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  await fs.promises.writeFile(destPath, buffer);
}

async function handleIncomingMessage(messageObj, sock, { chatId, numberUser, pushName }) {
  // If no active session for this user in this chat, ignore
  const key = sessionKey(chatId, numberUser);
  const s = sessions.get(key);
  if (!s) return false;

  // detect media types
  const message = messageObj.message || messageObj;
  const mediaTypes = ['documentMessage','imageMessage','videoMessage','audioMessage','stickerMessage'];
  const found = mediaTypes.find(t => !!message[t]);
  if (!found) return false;

  await ensureTable();

  try {
    const media = message[found];
    // determine filename and extension
    let filename = (media.fileName || media.caption || media.mimetype || '').toString();
    const extFromMime = (media.mimetype && media.mimetype.split('/').pop()) || '';
    if (!filename || filename.length > 200) {
      const id = messageObj.key && messageObj.key.id ? messageObj.key.id : Date.now();
      filename = `${id}.${extFromMime || 'bin'}`;
    }

    // download content
    const streamIter = await downloadContentFromMessage(message[found], found.replace('Message',''));
    const chunks = [];
    for await (const chunk of streamIter) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);

    // upload to Google Drive
    let driveInfo = null;
    try {
      driveInfo = await uploadToDrive(buffer, filename, media.mimetype || 'application/octet-stream');
    } catch (err) {
      console.error('uploadManager.drive upload error', err);
      // fallback to local save if drive upload fails
      const uploadsDir = path.join(process.cwd(), 'uploads', chatId.replace(/@/g,'_'));
      const dest = path.join(uploadsDir, `${Date.now()}_${filename}`);
      await saveBufferToFile(dest, buffer);
      await db('uploads').insert({ chat_id: chatId, uploader: numberUser, filename, path: dest });
      s.files.push({ filename, path: dest });
      await sock.sendMessage(chatId, { text: `File ${filename} telah berhasil di-save secara lokal di ${dest} (Drive upload gagal)` });
      return true;
    }

    // record in DB with drive link or id
    const storedPath = driveInfo.webViewLink || `drive://${driveInfo.id}`;
    await db('uploads').insert({ chat_id: chatId, uploader: numberUser, filename, path: storedPath });
    s.files.push({ filename, path: storedPath });

    await sock.sendMessage(chatId, { text: `File ${filename} telah berhasil di-save di Google Drive: ${storedPath}` });
    return true;
  } catch (err) {
    console.error('uploadManager error saving file', err);
    await sock.sendMessage(chatId, { text: 'Gagal menyimpan file. Coba lagi.' });
    return true; // handled (we consumed the media for session)
  }
}

export default { startSession, endSession, showFiles, handleIncomingMessage };
