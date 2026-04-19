import express from 'express';
import fs from 'fs';

import 'dotenv/config';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { responAI } from './gpt.js';
import { fetchData } from './jadwalKelas.js';
import { tagAll } from './tagAllFunc.js';
import { addReminder } from './addReminder.js';
import { deleteReminder } from './deleteReminder.js';
import { listReminders } from './listReminder.js';
import { createGroupWithFile } from './createGroupWithFile.js';
import handleAddCommand from './addMember.js';
import handleKickCommand from './kickMember.js';
import { getAllMember } from './getAllMember.js';
import { addScore, getTopUsers } from './db/leaderboard.js';
import gameHandlers from './games/gameHandlers.js';
import { createNote, getNoteById, listNotes, deleteNote } from './notes.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { startEdlinkScheduler, stopEdlinkScheduler, fetchOpenAssignments } from './edlinkScheduler.js';
import uploadManager from './uploadManager.js';

let sock;
let qrDataURL = null;
const activeGuess = new Map(); // userJid → { word }
const userScores = {}; // userJid → skor
const gameSessions = new Map(); // userJid → { game, jawaban, soal }
const gameScores = {}; // userJid → { name, score }

// Cache for view-once messages: chatJid → Array of { message, timestamp }
const viewOnceCache = new Map();
const MAX_CACHE_SIZE = 100; // Max messages per chat

// define target sender(s) for auto-detect auto-convert view-once
const VIEW_ONCE_AUTO_SENDERS = (process.env.AUTO_VIEW_ONCE_JIDS || '').split(',').map((jid) => jid.trim()).filter(Boolean);

function isAutoViewOnceSender(jid) {
  if (!jid) return false;
  const normalized = jid.split('@')[0]; // remove domain
  return VIEW_ONCE_AUTO_SENDERS.some((target) => {
    const normTarget = target.split('@')[0];
    return normalized === normTarget;
  });
}

// define target sender(s) for auto-view story
const STORY_AUTO_SENDERS = (process.env.AUTO_VIEW_STORY_JIDS || process.env.AUTO_VIEW_ONCE_JIDS || '').split(',').map((jid) => jid.trim()).filter(Boolean);

function isAutoStorySender(jid) {
  if (!jid) return false;
  const normalized = jid.split('@')[0]; // remove domain
  return STORY_AUTO_SENDERS.some((target) => {
    const normTarget = target.split('@')[0];
    return normalized === normTarget;
  });
}

// Helper to add view-once message to cache
function addToViewOnceCache(chatJid, message) {
  if (!viewOnceCache.has(chatJid)) {
    viewOnceCache.set(chatJid, []);
  }
  const cache = viewOnceCache.get(chatJid);
  cache.push({
    message: message,
    timestamp: Date.now()
  });
  // Keep only recent messages
  if (cache.length > MAX_CACHE_SIZE) {
    cache.shift();
  }
}

// Helper to find recent view-once message in cache
function findRecentViewOnce(chatJid) {
  const cache = viewOnceCache.get(chatJid);
  if (!cache || cache.length === 0) return null;
  // Return the most recent one
  return cache[cache.length - 1].message;
}

async function autoSendViewOnceAsFile(sock, remoteJid, msg) {
  try {
    console.log('🔄 Auto-send view-once triggered for', remoteJid);
    const msgContent = msg.message;
    if (!msgContent || !(msgContent.viewOnceMessage || msgContent.viewOnceMessageV2)) {
      console.log('❌ No view-once message found');
      return false;
    }

    let unwrapped = null;
    if (msgContent.viewOnceMessage) unwrapped = msgContent.viewOnceMessage.message;
    else if (msgContent.viewOnceMessageV2) unwrapped = msgContent.viewOnceMessageV2.message;

    if (!unwrapped) {
      console.log('❌ Failed to unwrap view-once message');
      return false;
    }

    let mediaMessage = null;
    let mediaType = null;
    let fileName = null;
    let mimeType = null;
    let caption = null;

    if (unwrapped.imageMessage) {
      mediaMessage = unwrapped.imageMessage;
      mediaType = 'image';
      mimeType = mediaMessage.mimetype || 'image/jpeg';
      caption = mediaMessage.caption;
    } else if (unwrapped.videoMessage) {
      mediaMessage = unwrapped.videoMessage;
      mediaType = 'video';
      mimeType = mediaMessage.mimetype || 'video/mp4';
      caption = mediaMessage.caption;
    } else if (unwrapped.documentMessage) {
      mediaMessage = unwrapped.documentMessage;
      mediaType = 'document';
      fileName = mediaMessage.filename || 'file';
      mimeType = mediaMessage.mimetype || 'application/octet-stream';
    } else if (unwrapped.audioMessage) {
      mediaMessage = unwrapped.audioMessage;
      mediaType = 'audio';
      mimeType = mediaMessage.mimetype || 'audio/mpeg';
      fileName = 'audio.mp3';
    } else if (unwrapped.stickerMessage) {
      mediaMessage = unwrapped.stickerMessage;
      mediaType = 'sticker';
      mimeType = 'image/webp';
    } else {
      console.log('❌ Unsupported media type in view-once');
      return false;
    }

    const messageForDownload = { message: {} };
    messageForDownload.message[`${mediaType}Message`] = mediaMessage;

    let buffer;
    try {
      buffer = await downloadMediaMessage(messageForDownload, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
    } catch (e) {
      console.log('Download attempt 1 failed:', e.message);
      try {
        buffer = await downloadMediaMessage(messageForDownload, 'buffer');
      } catch (e2) {
        console.log('Download attempt 2 failed:', e2.message);
        try {
          buffer = await downloadMediaMessage(unwrapped, 'buffer');
        } catch (e3) {
          console.log('Download attempt 3 failed:', e3.message);
          throw new Error('Tidak dapat mengunduh media: ' + e3.message);
        }
      }
    }

    const payload = {};
    if (mediaType === 'image') {
      payload.image = buffer;
      if (caption) payload.caption = caption;
    } else if (mediaType === 'video') {
      payload.video = buffer;
      if (caption) payload.caption = caption;
    } else if (mediaType === 'document') {
      payload.document = buffer;
      payload.filename = fileName;
      payload.mimetype = mimeType;
    } else if (mediaType === 'audio') {
      payload.audio = buffer;
      payload.mimetype = mimeType;
      payload.ptt = mediaMessage.ptt || false;
    } else if (mediaType === 'sticker') {
      payload.sticker = buffer;
    }

    await sock.sendMessage(remoteJid, payload, { quoted: msg });
    await sock.sendMessage(remoteJid, { text: '✅ Auto-convert: view-once dikirim sebagai file biasa.' }, { quoted: msg });
    console.log('✅ Auto-send view-once completed');
    return true;
  } catch (e) {
    console.error('autoSendViewOnceAsFile error:', e);
    await sock.sendMessage(remoteJid, { text: `❌ Gagal auto-convert view-once: ${e.message}` }, { quoted: msg });
    return false;
  }
}

// Fix ESM dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// persistent auth handled by useMultiFileAuthState; no manual pairing request
let isLoggedIn = false;

// ===== MENU CONFIGURATION =====
const MENU_CATEGORIES = {
  ai: {
    emoji: '🤖',
    title: 'AI & CHAT',
    commands: [
      { cmd: '/ai [Pesan]', desc: 'Chat dengan AI' }
    ]
  },
  edlink: {
    emoji: '📚',
    title: 'AKADEMIK',
    commands: [
      { cmd: '/tugas', desc: 'Cek tugas/quiz terbuka dari EdLink' },
      { cmd: '/jadwal', desc: 'Lihat jadwal mingguan dari EdLink' }
    ]
  },
  reminder: {
    emoji: '⏰',
    title: 'REMINDER',
    commands: [
      { cmd: '/list', desc: 'Lihat semua jadwal reminder' },
      { cmd: '/addList "Nama Kuliah" <Link> <Jam> <Hari>', desc: 'Tambah jadwal ke database' },
      { cmd: '/delete <ID>', desc: 'Hapus reminder' }
    ]
  },
  group: {
    emoji: '👥',
    title: 'GRUP MANAGEMENT',
    commands: [
      { cmd: '/add', desc: 'Tambah member ke grup' },
      { cmd: '/kick', desc: 'Keluarkan member dari grup' },
      { cmd: '/tagall', desc: 'Tag semua member (hanya grup!)' },
      { cmd: '/new "Nama Grup"', desc: 'Buat grup baru dari file txt' },
      { cmd: '/getAllMember', desc: 'Export member grup ke txt' }
    ]
  },
  notes: {
    emoji: '📝',
    title: 'NOTES',
    commands: [
      { cmd: '/notes <teks>', desc: 'Buat note baru' },
      { cmd: '/notes <ID>', desc: 'Lihat note tertentu' },
      { cmd: '/notes show', desc: 'Lihat semua notes' },
      { cmd: '/notes delete <ID>', desc: 'Hapus note' }
    ]
  },
  media: {
    emoji: '📎',
    title: 'MEDIA & FILE',
    commands: [
      { cmd: '/see', desc: 'Kirim file sekali dilihat sebagai file biasa (reply pesan)' },
      { cmd: 'Auto View-Once', desc: 'Otomatis convert view-once dari nomor tertentu' },
      { cmd: 'Auto View Story', desc: 'Otomatis view story dari nomor tertentu' }
    ]
  },
  games: {
    emoji: '🎮',
    title: 'PERMAINAN',
    commands: [
      { cmd: '/asahotak', desc: 'Asah Otak' },
      { cmd: '/caklontong', desc: 'Cak Lontong' },
      { cmd: '/family100', desc: 'Family 100' },
      { cmd: '/siapakahaku', desc: 'Siapakah Aku' },
      { cmd: '/susunkata', desc: 'Susun Kata' },
      { cmd: '/tebakbendera', desc: 'Tebak Bendera' },
      { cmd: '/tebakbendera2', desc: 'Tebak Bendera 2' },
      { cmd: '/tebakgambar', desc: 'Tebak Gambar' },
      { cmd: '/tebakkalimat', desc: 'Tebak Kalimat' },
      { cmd: '/tebakkata', desc: 'Tebak Kata' },
      { cmd: '/tebakkimia', desc: 'Tebak Kimia' },
      { cmd: '/tebaklirik', desc: 'Tebak Lirik' },
      { cmd: '/tebaktebakan', desc: 'Tebak-Tebakan' },
      { cmd: '/tekateki', desc: 'Teka-Teki' },
      { cmd: '/leaderboard', desc: 'Lihat leaderboard' },
      { cmd: '/skip', desc: 'Lewati soal saat ini' },
      { cmd: '/exit', desc: 'Keluar dari permainan' }
    ]
  }
};

function generateMenu(userName, isGroup) {
  let menu = `╔═══════════════════════════════════╗\n`;
  menu += `║  👋 Halo ${isGroup ? `@${userName}` : userName}!\n`;
  menu += `║  Berikut adalah menu yang tersedia:\n`;
  menu += `╚═══════════════════════════════════╝\n\n`;

  Object.values(MENU_CATEGORIES).forEach(category => {
    menu += `${category.emoji} *${category.title}*\n`;
    menu += `${'─'.repeat(35)}\n`;
    category.commands.forEach(cmd => {
      menu += `  ${cmd.cmd}\n    └─ ${cmd.desc}\n`;
    });
    menu += `\n`;
  });

  menu += `═══════════════════════════════════\n`;
  menu += `💡 *Tips:* Ketik perintah untuk memulai!\n`;

  return menu;
}

const app = express();
app.use(express.static(__dirname));

// halaman viewer QR — auto refresh
app.get('/qr', (req, res) => {
  if (isLoggedIn) {
    return res.send('<h2>Bot sudah login.</h2>');
  }

  res.send(`
    <html>
      <head>
        <meta http-equiv="refresh" content="3">
      </head>
      <body style="display:flex;align-items:center;justify-content:center;height:100vh;background:#111;">
        <div style="text-align:center;color:white;">
          <h2>Scan QR WhatsApp</h2>
          ${qrDataURL ? `<img src="${qrDataURL}" style="max-width:300px;" />` : `<p>Menunggu QR dari server...</p>`}
          <p style="color:gray;">Auto refresh setiap 3 detik</p>
        </div>
      </body>
    </html>
  `);
});

// port Railway: gunakan PORT dari env
app.listen(process.env.PORT || 3000, () => console.log('🌐 QR viewer: /qr'));

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  // sock = makeWASocket({
  //   auth: state,
  // });
  // fetch latest WhatsApp version
  // const { version: waVersion } = await fetchLatestBaileysVersion();
  const { version, isLatest } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({
    auth: state,
    version: version,
    browser: ['Ipinn', 'Windows', '110.0.5481.177'], // simulate real browser
    connectTimeoutMs: 60_000,
    patchMessageBeforeSending: (msg) => msg,
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    console.log('📶 Status koneksi:', connection);

    if (update.qr && !isLoggedIn) {
      console.log('🔳 QR diterima — generate base64');

      QRCode.toDataURL(update.qr, (err, url) => {
        if (err) {
          console.error('Gagal generate QR:', err);
          return;
        }

        qrDataURL = url;
        console.log('✅ QR updated (base64)');
      });
    }

    if (lastDisconnect?.error) {
      console.error('🔴 Error:', lastDisconnect.error?.output?.payload?.message || lastDisconnect.error.message);
    }
    if (connection === 'open') {
      isLoggedIn = true;
      qrDataURL = null; // reset QR

      console.log('✅ Terhubung ke WhatsApp!');
      // start scheduler when connection opens
      try {
        startScheduler(sock).catch((err) => console.error('startScheduler failed:', err));
        // start edlink scheduler if configured (EDLINK_BEARER and EDLINK_NOTIFY_JID)
        startEdlinkScheduler(sock).catch((err) => console.error('startEdlinkScheduler failed:', err));
      } catch (e) {
        console.error('Failed to start scheduler:', e);
      }
    }
    if (connection === 'close') {
      qrDataURL = null; // reset QR
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log('❌ Koneksi tertutup. Alasan:', reason);
      if (reason !== DisconnectReason.loggedOut) {
        console.log('🔁 Mencoba reconnect dalam 5 detik...');
        setTimeout(() => {
          connectToWhatsApp();
        }, 5000);
        // stop scheduler while disconnected
        try {
          stopScheduler();
        } catch (e) {
          /* ignore */
        }
        try {
          stopEdlinkScheduler();
        } catch (e) {
          /* ignore */
        }
      } else {
        console.log('🔒 Telah logout dari WhatsApp. Harap login ulang secara manual.');
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Auto view story for specified senders
  sock.ev.on('status.upsert', async (statuses) => {
    for (const status of statuses) {
      try {
        const senderJid = status.key.participant || status.key.remoteJid;
        if (isAutoStorySender(senderJid)) {
          console.log('🔄 Auto-viewing story from', senderJid);
          // Mark status as read/viewed
          await sock.readMessages([{
            remoteJid: status.key.remoteJid,
            id: status.key.id,
            participant: status.key.participant
          }]);
          console.log('✅ Auto-viewed story from', senderJid);
        }
      } catch (e) {
        console.error('Error auto-viewing story:', e);
      }
    }
  });

  sock.ev.on('messages.upsert', async (m) => {
    // if (m.messages[0].key.fromMe) return;
    const msg = m.messages[0];
    const isFromMe = msg.key.fromMe;

    const message = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.documentMessage?.caption || '';

    const isCommand = message.startsWith('/');

    // ❗ Skip hanya jika pesan dari bot DAN BUKAN command
    if (isFromMe && !isCommand) return;

    // Cache view-once messages for /see command (outside try block to avoid hoisting issues)
    const msgContent = msg.message;
    const remoteJidCache = msg.key.remoteJid;
    if (msgContent && (msgContent.viewOnceMessage || msgContent.viewOnceMessageV2)) {
      addToViewOnceCache(remoteJidCache, msgContent);

      const senderJid = msg.key.participant || remoteJidCache;
      if (!isFromMe && isAutoViewOnceSender(senderJid)) {
        await autoSendViewOnceAsFile(sock, remoteJidCache, msg);
        // continue processing if desired; we can still handle commands if message also has text
      }
    }

    try {
      const pushName = m.messages[0].pushName;
      const numberUser = m.messages[0].key.participant || m.messages[0].key.remoteJid || m.messages[0].key.remoteJidAlt;

      // const message = m.messages[0].message;
      // const msg = m.messages[0];
      const messageArr = m.messages[0];
      const remoteJid = m.messages[0].key.remoteJid;
      const chatId = remoteJid.endsWith('@g.us') ? remoteJid : numberUser;
      const isGroup = remoteJid.endsWith('@g.us');
      const sessionKey = isGroup ? remoteJid : numberUser;

      // let chatMessage;

      // switch (true) {
      //   case !!message.conversation:
      //     chatMessage = message.conversation;
      //     break;
      //   case !!(message.extendedTextMessage && message.extendedTextMessage.text):
      //     chatMessage = message.extendedTextMessage.text;
      //     break;
      //   case !!(message.imageMessage && message.imageMessage.caption):
      //     chatMessage = message.imageMessage.caption;
      //     break;
      //   case !!(message.videoMessage && message.videoMessage.caption):
      //     chatMessage = message.videoMessage.caption;
      //     break;
      // }

      // msg already declared in outer scope (line 273)
      // const msg = m.messages?.[0];

      // message already declared in outer scope (line 276)
      // const message = msg.message;
      if (!msg.message) return;

      // Extract text/caption from message (could be empty for pure media messages)
      const chatMessage = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || msg.message.videoMessage?.caption || msg.message.documentMessage?.caption || '';

      // IMPORTANT: Check upload session FIRST before returning on empty chatMessage
      // because media files without caption will have empty chatMessage
      try {
        const handled = await uploadManager.handleIncomingMessage(msg, sock, { chatId, numberUser, pushName });
        if (handled) return;
      } catch (e) {
        console.error('uploadManager error:', e);
      }

      // Now safe to return if no text message and not handled by uploadManager
      if (!chatMessage) return;

      const sessionID = remoteJid;

      if (chatMessage.startsWith('/menu')) {
        const displayName = remoteJid.endsWith('@g.us') ? numberUser.split('@')[0] : pushName;
        const menuText = generateMenu(displayName, remoteJid.endsWith('@g.us'));

        const payload = { text: menuText };
        if (remoteJid.endsWith('@g.us')) payload.mentions = [numberUser];
        await sock.sendMessage(remoteJid, payload, { quoted: m.messages[0] });
      }

      // === Upload feature ===
      if (chatMessage === '/upload') {
        await uploadManager.startSession(sock, chatId, numberUser);
        return;
      }

      if (chatMessage.startsWith('/upload') && chatMessage.includes('show')) {
        await uploadManager.showFiles(sock, chatId, numberUser);
        return;
      }

      if (chatMessage === '/end') {
        await uploadManager.endSession(sock, chatId, numberUser);
        return;
      }

      // === Handle /see command for view-once files ===
      if (chatMessage === '/see') {
        let unwrappedMessage = null;
        let originalQuotedMessage = null;
        let targetMessage = null;

        // Check if the message is a reply
        const isReply = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

        if (isReply) {
          // Mode 1: Using reply
          originalQuotedMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage;
          targetMessage = originalQuotedMessage;

          // Unwrap view-once messages to detect type
          if (originalQuotedMessage.viewOnceMessage) {
            unwrappedMessage = originalQuotedMessage.viewOnceMessage.message;
          } else if (originalQuotedMessage.viewOnceMessageV2) {
            unwrappedMessage = originalQuotedMessage.viewOnceMessageV2.message;
          } else {
            unwrappedMessage = originalQuotedMessage;
          }
        } else {
          // Mode 2: Auto-search recent view-once messages from cache
          targetMessage = findRecentViewOnce(remoteJid);

          if (!targetMessage) {
            await sock.sendMessage(remoteJid, { text: '⚠️ Tidak ditemukan media view-once di cache.\n\n💡 Tips: Reply langsung ke pesan view-once lalu ketik /see' }, { quoted: msg });
            return;
          }

          // Unwrap view-once message
          if (targetMessage.viewOnceMessage) {
            unwrappedMessage = targetMessage.viewOnceMessage.message;
          } else if (targetMessage.viewOnceMessageV2) {
            unwrappedMessage = targetMessage.viewOnceMessageV2.message;
          } else {
            unwrappedMessage = targetMessage;
          }
        }

        if (!unwrappedMessage) {
          await sock.sendMessage(remoteJid, { text: '❌ Gagal membaca pesan. Silakan coba lagi.' }, { quoted: msg });
          return;
        }

        // Check if quoted message has media (image, video, document, audio, etc.)
        let mediaMessage = null;
        let mediaType = null;
        let fileName = null;
        let mimeType = null;
        let caption = null;

        if (unwrappedMessage.imageMessage) {
          mediaMessage = unwrappedMessage.imageMessage;
          mediaType = 'image';
          mimeType = mediaMessage.mimetype || 'image/jpeg';
          caption = mediaMessage.caption;
        } else if (unwrappedMessage.videoMessage) {
          mediaMessage = unwrappedMessage.videoMessage;
          mediaType = 'video';
          mimeType = mediaMessage.mimetype || 'video/mp4';
          caption = mediaMessage.caption;
        } else if (unwrappedMessage.audioMessage) {
          mediaMessage = unwrappedMessage.audioMessage;
          mediaType = 'audio';
          mimeType = mediaMessage.mimetype || 'audio/mpeg';
          fileName = 'audio.mp3';
        } else if (unwrappedMessage.documentMessage) {
          mediaMessage = unwrappedMessage.documentMessage;
          mediaType = 'document';
          fileName = mediaMessage.filename || 'file';
          mimeType = mediaMessage.mimetype || 'application/octet-stream';
        } else if (unwrappedMessage.stickerMessage) {
          mediaMessage = unwrappedMessage.stickerMessage;
          mediaType = 'sticker';
          mimeType = 'image/webp';
        } else {
          await sock.sendMessage(remoteJid, { text: '❌ Pesan yang di-reply bukan file media. Silakan reply file yang ingin dilihat.' }, { quoted: msg });
          return;
        }

        try {
          // Build proper message structure for downloadMediaMessage
          const messageForDownload = {
            message: {
              [mediaType === 'image'
                ? 'imageMessage'
                : mediaType === 'video'
                  ? 'videoMessage'
                  : mediaType === 'audio'
                    ? 'audioMessage'
                    : mediaType === 'document'
                      ? 'documentMessage'
                      : mediaType === 'sticker'
                        ? 'stickerMessage'
                        : 'imageMessage']: mediaMessage,
            },
          };

          let buffer;
          try {
            buffer = await downloadMediaMessage(messageForDownload, 'buffer', {}, { reuploadRequest: sock.updateMediaMessage });
          } catch (e) {
            console.log('Download attempt 1 failed:', e.message);
            // Fallback: try dengan message structure berbeda
            try {
              buffer = await downloadMediaMessage(messageForDownload, 'buffer');
            } catch (e2) {
              console.log('Download attempt 2 failed:', e2.message);
              // Last resort: coba download dari unwrappedMessage langsung
              try {
                buffer = await downloadMediaMessage(unwrappedMessage, 'buffer');
              } catch (e3) {
                console.log('Download attempt 3 failed:', e3.message);
                throw new Error('Tidak dapat mengunduh media: ' + e3.message);
              }
            }
          }

          // Send back as regular file (non-view-once)
          const messagePayload = {};

          if (mediaType === 'image') {
            messagePayload.image = buffer;
            if (caption) {
              messagePayload.caption = caption;
            }
          } else if (mediaType === 'video') {
            messagePayload.video = buffer;
            if (caption) {
              messagePayload.caption = caption;
            }
          } else if (mediaType === 'audio') {
            messagePayload.audio = buffer;
            messagePayload.mimetype = mimeType;
            messagePayload.ptt = mediaMessage.ptt || false;
          } else if (mediaType === 'document') {
            messagePayload.document = buffer;
            messagePayload.filename = fileName;
            messagePayload.mimetype = mimeType;
          } else if (mediaType === 'sticker') {
            messagePayload.sticker = buffer;
          }

          await sock.sendMessage(remoteJid, messagePayload, { quoted: msg });
          await sock.sendMessage(remoteJid, { text: '✅ File telah dikirim sebagai file biasa (tidak sekali dilihat lagi).' }, { quoted: msg });
        } catch (error) {
          console.error('Error downloading/sending view-once media:', error);
          await sock.sendMessage(remoteJid, { text: `❌ Gagal mengunduh media: ${error.message}` }, { quoted: msg });
        }
        return;
      }

      if (chatMessage.startsWith('/jadwal')) {
        const jadwalKelas = await fetchData();
        await sock.sendMessage(remoteJid, { text: jadwalKelas }, { quoted: m.messages[0] });
      }

      if (chatMessage.startsWith('/tugas')) {
        try {
          const bearer = process.env.EDLINK_BEARER;
          const items = await fetchOpenAssignments({ bearer });
          if (!items || items.length === 0) {
            await sock.sendMessage(remoteJid, { text: '✅ Tidak ada tugas/quiz terbuka saat ini.' }, { quoted: m.messages[0] });
            return;
          }

          // helper to parse various timestamp formats
          const parseMaybeDate = (v) => {
            if (!v) return null;
            if (typeof v === 'number') {
              if (v < 1e12) v = v * 1000; // seconds -> ms
              return new Date(v);
            }
            const p = Date.parse(v);
            if (isNaN(p)) return null;
            return new Date(p);
          };

          const lines = items.map((it) => {
            const due = parseMaybeDate(it.dueAt || it.publishedAtTimestamp || it.section?.endedAtTimestamp);
            const dueStr = due ? due.toLocaleString('id-ID') : '—';
            // console.log(it.group);
            const className = it.group?.className || '';
            const kelas = it.group?.name || it.group?.className || '';
            const link = (it.group?.description && (it.group.description.match(/https?:\/\/(\S+)/) || [])[0]) || '';
            return `• ${it.title || 'Tugas/Quiz'}\nKelas: ${kelas} (${className})\nWaktu: ${dueStr}\n${link}`;
          });

          const out = `📚 *Daftar Tugas / Quiz Terbuka:*
\n${lines.join('\n\n')}`;
          await sock.sendMessage(remoteJid, { text: out }, { quoted: m.messages[0] });
        } catch (err) {
          console.error('Error fetching tugas:', err);
          await sock.sendMessage(remoteJid, { text: 'Gagal mengambil data tugas dari EdLink.' }, { quoted: m.messages[0] });
        }
      }

      if (remoteJid.endsWith('@g.us') && chatMessage.startsWith('/ai')) {
        const messageUser = chatMessage.slice(4).trim();
        const jawabanAI = await responAI(messageUser, sessionID);
        console.log(`Jawaban AI: ${jawabanAI}`);

        await sock.sendMessage(remoteJid, { text: jawabanAI }, { quoted: m.messages[0] });
      }

      if (chatMessage.startsWith('/list')) {
        const listJadwal = await listReminders(numberUser);
        await sock.sendMessage(remoteJid, { text: listJadwal }, { quoted: m.messages[0] });
      }

      if (chatMessage.startsWith('/new')) {
        await createGroupWithFile(sock, messageArr, chatMessage, numberUser);
      }

      if (chatMessage.startsWith('/getAllMember')) {
        const groupJid = remoteJid.endsWith('@g.us') ? remoteJid : null;
        if (!groupJid) {
          await sock.sendMessage(remoteJid, { text: 'Perintah ini hanya bisa digunakan di grup.' }, { quoted: m.messages[0] });
          return;
        }
        await getAllMember(sock, messageArr, groupJid);
        return;
      }

      if (/^\/addList\b/.test(chatMessage)) {
        const regex = /\/addList\s+"([^"]+)"\s+(https:\/\/[^\s]+)\s+([0-9]{2}[.:][0-9]{2})\s+(.+)/;
        const match = chatMessage.match(regex);
        if (match) {
          const [_, courseName, zoomLink, reminderTime, days] = match;
          await addReminder(courseName, zoomLink, reminderTime, days, numberUser);
          console.log(`NumberUSer ${numberUser}`);

          await sock.sendMessage(
            remoteJid,
            {
              text: `Jadwal berhasil ditambahkan:\nMata Kuliah: ${courseName}\nLink: ${zoomLink}\nJam: ${reminderTime}\nHari: ${days}`,
            },
            { quoted: m.messages[0] },
          );
        } else {
          await sock.sendMessage(remoteJid, { text: 'Format salah! Gunakan: /addList "Mata Kuliah" <Zoom Link> <Jam> <Hari>' }, { quoted: m.messages[0] });
        }
      }

      // === /notes command ===
      if (chatMessage.startsWith('/notes')) {
        const args = chatMessage.slice(6).trim(); // remove '/notes'

        // /notes show -> list notes
        if (args === 'show') {
          const rows = await listNotes();
          if (!rows.length) {
            await sock.sendMessage(remoteJid, { text: 'Belum ada notes.' }, { quoted: m.messages[0] });
            return;
          }
          const summary = rows.map((r) => `ID: ${r.id} — ${r.author} — ${r.created_at}\n\n${r.content.slice(0, 200)}${r.content.length > 200 ? '...' : ''}`).join('\n\n');
          await sock.sendMessage(remoteJid, { text: `Daftar notes:\n\n${summary}` }, { quoted: m.messages[0] });
          return;
        }

        // /notes delete <id>
        if (args.startsWith('delete ')) {
          const id = parseInt(args.split(' ')[1], 10);
          if (Number.isNaN(id)) {
            await sock.sendMessage(remoteJid, { text: 'ID tidak valid.' }, { quoted: m.messages[0] });
            return;
          }
          const ok = await deleteNote(id);
          await sock.sendMessage(remoteJid, { text: ok ? `Note ${id} dihapus.` : `Note ${id} tidak ditemukan.` }, { quoted: m.messages[0] });
          return;
        }

        // /notes <id> -> show note
        if (/^\d+$/.test(args)) {
          const id = parseInt(args, 10);
          const row = await getNoteById(id);
          if (!row) {
            await sock.sendMessage(remoteJid, { text: `Note dengan ID ${id} tidak ditemukan.` }, { quoted: m.messages[0] });
            return;
          }
          await sock.sendMessage(remoteJid, { text: `ID: ${row.id}\nAuthor: ${row.author}\nCreated: ${row.created_at}\n\n${row.content}` }, { quoted: m.messages[0] });
          return;
        }

        // Otherwise create a new note with the args as content
        if (args.length > 0) {
          const id = await createNote(numberUser, args);
          await sock.sendMessage(remoteJid, { text: `Note disimpan dengan ID ${id}.` }, { quoted: m.messages[0] });
          return;
        }

        // fallback: show help for notes
        await sock.sendMessage(remoteJid, { text: 'Format /notes:\n/notes <teks> — buat note\n/notes <id> — lihat note\n/notes show — list semua note\n/notes delete <id> — hapus note' }, { quoted: m.messages[0] });
      }

      if (/^\/add\b/.test(chatMessage)) {
        const groupJid = remoteJid.endsWith('@g.us') ? remoteJid : null;
        if (!groupJid) {
          await sock.sendMessage(remoteJid, { text: 'Perintah ini hanya bisa digunakan di grup.' }, { quoted: m.messages[0] });
          return;
        }
        await handleAddCommand(sock, m, groupJid);
        return;
      }

      if (chatMessage.startsWith('/kick') || message.extendedTextMessage?.text === '/kick') {
        const groupJid = remoteJid.endsWith('@g.us') ? remoteJid : null;
        await handleKickCommand(sock, m, groupJid);
      }

      if (chatMessage.startsWith('/delete')) {
        const id = chatMessage.split(' ')[1];
        if (!id) {
          await sock.sendMessage(remoteJid, { text: 'Mohon sertakan ID jadwal yang ingin dihapus.' }, { quoted: m.messages[0] });
          return;
        }
        const result = await deleteReminder(id, numberUser);
        await sock.sendMessage(remoteJid, { text: result });
        const listJadwal = await listReminders(numberUser);
        await sock.sendMessage(remoteJid, { text: listJadwal }, { quoted: m.messages[0] });
      }

      if (chatMessage.startsWith('/tagall')) {
        await tagAll(sock, remoteJid, chatMessage);
      }

      // === HANDLE /exit ===
      if (chatMessage === '/exit') {
        if (gameSessions.has(sessionKey)) {
          gameSessions.delete(sessionKey);
          await sock.sendMessage(
            remoteJid,
            {
              text: '🚪 Permainan telah dihentikan.',
            },
            { quoted: msg },
          );
        } else {
          await sock.sendMessage(
            remoteJid,
            {
              text: '❌ Tidak ada permainan aktif saat ini.',
            },
            { quoted: msg },
          );
        }
        return;
      }

      if (chatMessage === '/skip') {
        if (!gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, { text: '⚠️ Tidak ada game aktif untuk dilewati.' }, { quoted: msg });
          return;
        }

        const session = gameSessions.get(sessionKey);
        const nextSoal = gameHandlers[session.game].getRandom();

        gameSessions.set(sessionKey, {
          game: session.game,
          jawaban: nextSoal.jawaban.toLowerCase(),
          soal: nextSoal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: '⏭️ Soal dilewati. Berikut soal selanjutnya:',
          },
          { quoted: msg },
        );

        // Kirim soal baru sesuai jenisnya
        if (nextSoal.soal && !nextSoal.img) {
          await sock.sendMessage(
            remoteJid,
            {
              text: `🧠 ${nextSoal.soal}`,
            },
            { quoted: msg },
          );
        } else if (session.game === 'tebakgambar' && nextSoal.img) {
          await sock.sendMessage(
            remoteJid,
            {
              image: { url: nextSoal.img },
              caption: `🖼️ *Clue:*\n${nextSoal.deskripsi || 'Tidak ada'}`,
            },
            { quoted: msg },
          );
        } else if (nextSoal.img) {
          await sock.sendMessage(
            remoteJid,
            {
              image: { url: nextSoal.img },
              caption: '🖼️ Soal Berikutnya!',
            },
            { quoted: msg },
          );
        }

        return;
      }

      if (gameSessions.has(sessionKey) && !chatMessage.startsWith('/')) {
        const session = gameSessions.get(sessionKey);
        const jawabanUser = chatMessage.toLowerCase();

        // FAMILY100
        if (session.game === 'family100') {
          const isValid = gameHandlers.family100.isCorrectAnswer(session, chatMessage);
          if (isValid) {
            gameHandlers.family100.markAnswer(session, chatMessage);
            await addScore(chatId, numberUser, pushName);

            const sisa = session.jawaban.length - session.terjawab.length;

            if (gameHandlers.family100.isComplete(session)) {
              const next = gameHandlers.family100.getRandom();
              gameSessions.set(sessionKey, {
                game: 'family100',
                soal: next.soal,
                jawaban: next.jawaban,
                terjawab: [],
              });

              await sock.sendMessage(
                remoteJid,
                {
                  text: `✅ Semua jawaban benar!`,
                },
                { quoted: msg },
              );

              await sock.sendMessage(
                remoteJid,
                {
                  text: `💯 *FAMILY 100*\n${next.soal}`,
                },
                { quoted: msg },
              );
            } else {
              await sock.sendMessage(
                remoteJid,
                {
                  text: `✅ Benar! Masih ${sisa} jawaban lagi.`,
                },
                { quoted: msg },
              );
            }
          } else {
            await sock.sendMessage(
              remoteJid,
              {
                text: `❌ Salah atau sudah dijawab.`,
              },
              { quoted: msg },
            );
          }
          return;
        }

        // GAME BIASA
        const jawabanBenar = session.jawaban.toLowerCase();
        if (jawabanUser === jawabanBenar) {
          await addScore(chatId, numberUser, pushName);

          const nextSoal = gameHandlers[session.game].getRandom();
          gameSessions.set(sessionKey, {
            game: session.game,
            jawaban: nextSoal.jawaban.toLowerCase(),
            soal: nextSoal,
          });

          const deskripsi = session.soal?.deskripsi && ['caklontong', 'tebakgambar'].includes(session.game) ? `\n📝 *Penjelasan:* ${session.soal.deskripsi}` : '';

          // 1. Kirim feedback jawaban benar dulu
          await sock.sendMessage(
            remoteJid,
            {
              text: `✅ Benar! Point +10\n\n${deskripsi}`,
            },
            { quoted: msg },
          );

          await new Promise((resolve) => setTimeout(resolve, 800)); // Delay sebelum soal baru

          // 2. Kirim soal berikutnya (bentuk tergantung jenis game)
          if (session.game === 'susunkata') {
            await sock.sendMessage(
              remoteJid,
              {
                text: `🧩 *Soal Berikutnya:*\nSusun kata berikut: ${nextSoal.soal}\nKategori: ${nextSoal.tipe}`,
              },
              { quoted: msg },
            );
          } else if (nextSoal.soal && !nextSoal.img) {
            await sock.sendMessage(
              remoteJid,
              {
                text: `🧠 *Soal Berikutnya:*\n${nextSoal.soal}`,
              },
              { quoted: msg },
            );
          } else if (session.game === 'tebakgambar' && nextSoal.img) {
            await sock.sendMessage(remoteJid, {
              image: { url: nextSoal.img },
              caption: `🖼️ *Soal Berikutnya!*\n\n🧠 Clue: ${nextSoal.deskripsi || 'Tidak ada'}`,
              quoted: msg,
            });
          } else if (nextSoal.img) {
            await sock.sendMessage(remoteJid, {
              image: { url: nextSoal.img },
              caption: `🖼️ *Soal Berikutnya!*`,
              quoted: msg,
            });
          }

          return;
        }

        // Jawaban salah
        await sock.sendMessage(
          remoteJid,
          {
            text: `❌ Salah. Coba lagi atau ketik /exit untuk keluar.`,
          },
          { quoted: msg },
        );

        // Kirim ulang soal aktif
        const game = session.game;
        const soalAktif = session.soal;

        if (game === 'susunkata') {
          await sock.sendMessage(
            remoteJid,
            {
              text: `🔁 *Soal Ulang:*\nSusun kata berikut: ${soalAktif.soal}\nKategori: ${soalAktif.tipe}`,
            },
            { quoted: msg },
          );
        } else if (game === 'tebakkimia' && soalAktif.soal) {
          // Soal tebakkimia
          await sock.sendMessage(remoteJid, {
            text: `🔁 *Soal Ulang:*\nClue: Unsur dari ${soalAktif.soal} adalah?`,
            quoted: msg,
          });
        } else if (soalAktif.soal && !soalAktif.img) {
          // Soal berbentuk teks biasa
          await sock.sendMessage(remoteJid, {
            text: `🔁 *Soal Ulang:*\n${soalAktif.soal}`,
            quoted: msg,
          });
        } else if (game === 'tebakgambar' && soalAktif.img) {
          await new Promise((resolve) => setTimeout(resolve, 800)); // Delay 800ms
          // Gambar dengan clue
          await sock.sendMessage(remoteJid, {
            image: { url: soalAktif.img },
            caption: `🖼️ *Clue Ulang!*\n\n🧠 ${soalAktif.deskripsi || 'Tidak ada'}`,
            quoted: msg,
          });
        } else if (soalAktif.img) {
          // Gambar tanpa clue (misal tebakbendera)
          await new Promise((resolve) => setTimeout(resolve, 800)); // Delay 800ms
          await sock.sendMessage(remoteJid, {
            image: { url: soalAktif.img },
            caption: `🖼️ *Soal Ulang!*`,
            quoted: msg,
          });
        }

        return;
      }

      if (chatMessage === '/leaderboard') {
        const topUsers = await getTopUsers(remoteJid);
        console.log(`Top USers: ${topUsers}`);

        if (topUsers.length === 0) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '📊 Belum ada pemain di leaderboard untuk chat ini.',
            },
            { quoted: msg },
          );
          return;
        }

        let msgSend = '🏆 *Leaderboard Top 5:*\n';
        topUsers.forEach((user, i) => {
          msgSend += `${i + 1}. ${user.name} - ${user.score} poin\n`;
        });
        await sock.sendMessage(remoteJid, { text: msgSend }, { quoted: msg });
        return;
      }

      if (chatMessage === '/asahotak') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg },
          );
          return;
        }
        // Mulai permainan Asah Otak
        const soal = gameHandlers.asahotak.getRandom();
        gameSessions.set(sessionKey, {
          game: 'asahotak',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });
        await sock.sendMessage(
          remoteJid,
          {
            text: `🧠 *ASAH OTAK*\n${soal.soal}`,
          },
          { quoted: msg },
        );
        return;
      }

      if (chatMessage === '/caklontong') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg },
          );
          return;
        }

        // Mulai permainan Cak Lontong
        const soal = gameHandlers.caklontong.getRandom();
        gameSessions.set(sessionKey, {
          game: 'caklontong',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });
        await sock.sendMessage(
          remoteJid,
          {
            text: `🤣 *CAK LONTONG*\n${soal.soal}`,
          },
          { quoted: msg },
        );
        return;
      }

      if (chatMessage === '/family100') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg },
          );
          return;
        }
        // Mulai permainan Family 100
        const soal = gameHandlers.family100.getRandom();
        gameSessions.set(sessionKey, {
          game: 'family100',
          soal: soal.soal,
          jawaban: soal.jawaban,
          terjawab: [],
        });
        await sock.sendMessage(
          remoteJid,
          {
            text: `💯 *FAMILY 100*\n${soal.soal}\n\nTebak semua ${soal.jawaban.length} jawabannya!`,
          },
          { quoted: msg },
        );
        return;
      }

      if (chatMessage === '/siapakahaku') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg },
          );
          return;
        }
        // Mulai permainan Siapakah Aku
        const soal = gameHandlers.siapakahaku.getRandom();

        gameSessions.set(sessionKey, {
          game: 'siapakahaku',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `👤 *SIAPAKAH AKU*\n${soal.soal}`,
          },
          { quoted: msg },
        );

        return;
      }

      if (chatMessage === '/susunkata') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg },
          );
          return;
        }

        // Mulai permainan Susun Kata
        const soal = gameHandlers.susunkata.getRandom();

        gameSessions.set(sessionKey, {
          game: 'susunkata',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `🔤 *SUSUN KATA*\n${soal.soal}\n*Kategori:* ${soal.tipe}`,
          },
          { quoted: msg },
        );

        return;
      }

      if (chatMessage === '/tebakbendera') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg },
          );
          return;
        }

        const soal = gameHandlers.tebakbendera.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakbendera',
          jawaban: soal.name.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            image: { url: soal.img },
            caption: `🚩 *TEBAK BENDERA*\nNegara apakah ini?`,
          },
          { quoted: msg },
        );

        return;
      }

      if (chatMessage === '/tebakbendera2') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg },
          );
          return;
        }

        const soal = gameHandlers.tebakbendera2.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakbendera2',
          jawaban: soal.name.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            image: { url: soal.img },
            caption: `🚩 *TEBAK BENDERA*\nNegara apakah ini?`,
          },
          { quoted: msg },
        );

        return;
      }

      if (chatMessage === '/tebakgambar') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg },
          );
          return;
        }

        const soal = gameHandlers.tebakgambar.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakgambar',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            image: { url: soal.img },
            caption: `🖼️ *TEBAK GAMBAR*\nApa yang ada di gambar ini?\n\nClue: ${soal.deskripsi}`,
          },
          { quoted: msg },
        );

        return;
      }

      if (chatMessage === '/tebakkabupaten') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg },
          );
          return;
        }

        const soal = gameHandlers.tebakkabupaten.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakkabupaten',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            image: { url: soal.img },
            caption: `🏙️ *TEBAK KABUPATEN*\nApa nama kabupaten ini?`,
          },
          { quoted: msg },
        );

        return;
      }

      if (chatMessage.startsWith('/tebakkalimat')) {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg },
          );
          return;
        }

        const soal = gameHandlers.tebakkalimat.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakkalimat',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `✍️ *TEBAK KALIMAT*\n${soal.soal}`,
          },
          { quoted: msg },
        );

        return;
      }

      if (chatMessage.startsWith('/tebakkata')) {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg },
          );
          return;
        }

        const soal = gameHandlers.tebakkata.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakkata',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `✍️ *TEBAK KATA*\nClue: ${soal.soal}`,
          },
          { quoted: msg },
        );

        return;
      }

      if (chatMessage.startsWith('/tebakkimia')) {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg },
          );
          return;
        }

        const soal = gameHandlers.tebakkimia.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakkimia',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `✍️ *TEBAK KIMIA*\nClue: Unsur dari ${soal.soal} adalah?`,
          },
          { quoted: msg },
        );

        return;
      }

      if (chatMessage.startsWith('/tebaklirik')) {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, { text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.' }, { quoted: msg });
          return;
        }

        const soal = gameHandlers.tebaklirik.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebaklirik',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `🎵 *TEBAK LIRIK*
${soal.soal}`,
          },
          { quoted: msg },
        );
        return;
      }

      if (chatMessage.startsWith('/tebaktebakan')) {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, { text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.' }, { quoted: msg });
          return;
        }

        const soal = gameHandlers.tebaktebakan.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebaktebakan',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `🧩 *TEBAK-TEBAKAN*
${soal.soal}`,
          },
          { quoted: msg },
        );
        return;
      }

      if (chatMessage.startsWith('/tekateki')) {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, { text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.' }, { quoted: msg });
          return;
        }

        const soal = gameHandlers.tekateki.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tekateki',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `❓ *TEKA-TEKI*
${soal.soal}`,
          },
          { quoted: msg },
        );
        return;
      }
    } catch (error) {
      console.error('Error handling incoming message:', error);
    }
  });
}

connectToWhatsApp();
