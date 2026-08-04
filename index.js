import express from 'express';
import fs from 'fs';
import { spawn } from 'node:child_process';

import 'dotenv/config';
import dotenv from 'dotenv';
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
import { startEdlinkScheduler, stopEdlinkScheduler, fetchOpenAssignments, fetchPresenceStatus, fetchAllPresenceStatus } from './edlinkScheduler.js';
import uploadManager from './uploadManager.js';
import { cacheMessage, getCachedMessage, createDeletedMessageNotification } from './utils/deletedMessageHandler.js';

let sock;
let qrDataURL = null;
let BOT_PHONE = ''; // nomor bot (untuk wa.me link), terisi saat koneksi open
const activeGuess = new Map(); // userJid → { word }
const userScores = {}; // userJid → skor
const gameSessions = new Map(); // userJid → { game, jawaban, soal }
const gameScores = {}; // userJid → { name, score }

// Cache for view-once messages: chatJid → Array of { message, timestamp }
const viewOnceCache = new Map();
const MAX_CACHE_SIZE = 100; // Max messages per chat

// ===== DELETED MESSAGE DETECTION CONFIG =====
// Set DELETED_MESSAGE_DETECTION=false di .env untuk menonaktifkan
let DELETED_MESSAGE_DETECTION = process.env.DELETED_MESSAGE_DETECTION !== 'false';

// ===== OWNER CONFIG =====
let OWNER_NUMBER = process.env.OWNER_NUMBER || '';

// ===== AUTO VIEW-ONCE CONFIG =====
// Format: AUTO_VIEW_ONCE_JIDS=6281234567890,6281234567891,6282988223456
// Multiple numbers separated by comma
let VIEW_ONCE_AUTO_SENDERS = (process.env.AUTO_VIEW_ONCE_JIDS || '')
  .split(',')
  .map((jid) => jid.trim())
  .filter(Boolean);

function isAutoViewOnceSender(jid) {
  if (!jid || VIEW_ONCE_AUTO_SENDERS.length === 0) return false;
  
  const normalized = jid.split('@')[0]; // remove domain
  return VIEW_ONCE_AUTO_SENDERS.some((target) => {
    const normTarget = target.split('@')[0];
    return normalized === normTarget;
  });
}

// ===== AUTO VIEW STORY CONFIG =====
// Format: 
//   AUTO_VIEW_STORY_JIDS=*          (auto view ALL stories)
//   AUTO_VIEW_STORY_JIDS=6281234567890,6281234567891  (specific numbers only)
let STORY_AUTO_SENDERS_RAW = (process.env.AUTO_VIEW_STORY_JIDS || '')
  .split(',')
  .map((jid) => jid.trim())
  .filter(Boolean);

let STORY_VIEW_ALL = STORY_AUTO_SENDERS_RAW.includes('*');
let STORY_AUTO_SENDERS = STORY_AUTO_SENDERS_RAW.filter((jid) => jid !== '*');

function isAutoStorySender(jid) {
  if (!jid) return false;
  
  // Jika ada wildcard "*", auto view SEMUA story
  if (STORY_VIEW_ALL) {
    return true;
  }
  
  // Jika tidak ada config sama sekali, return false
  if (STORY_AUTO_SENDERS.length === 0) return false;
  
  // Check specific list
  const normalized = jid.split('@')[0]; // remove domain
  return STORY_AUTO_SENDERS.some((target) => {
    const normTarget = target.split('@')[0];
    return normalized === normTarget;
  });
}

// ===== RELOAD ENV CONFIG =====
function reloadEnvConfig() {
  try {
    const envFile = fs.readFileSync(ENV_PATH, 'utf-8');
    const parsed = dotenv.parse(envFile);
    for (const [key, value] of Object.entries(parsed)) {
      process.env[key] = value;
    }
    DELETED_MESSAGE_DETECTION = process.env.DELETED_MESSAGE_DETECTION !== 'false';
    VIEW_ONCE_AUTO_SENDERS = (process.env.AUTO_VIEW_ONCE_JIDS || '')
      .split(',')
      .map((jid) => jid.trim())
      .filter(Boolean);
    STORY_AUTO_SENDERS_RAW = (process.env.AUTO_VIEW_STORY_JIDS || '')
      .split(',')
      .map((jid) => jid.trim())
      .filter(Boolean);
    STORY_VIEW_ALL = STORY_AUTO_SENDERS_RAW.includes('*');
    STORY_AUTO_SENDERS = STORY_AUTO_SENDERS_RAW.filter((jid) => jid !== '*');
    OWNER_NUMBER = process.env.OWNER_NUMBER || '';
    console.log('🔄 Konfigurasi .env berhasil di-reload');
    return true;
  } catch (e) {
    console.error('Gagal reload .env:', e);
    return false;
  }
}

// ===== MASK SENSITIVE ENV VALUE =====
function maskSensitiveValue(key, value) {
  const sensitiveKeys = ['BEARER', 'SECRET', 'TOKEN', 'PASSWORD', 'KEY', 'CLIENT_ID', 'CLIENT_SECRET'];
  const isSensitive = sensitiveKeys.some(sk => key.includes(sk));
  if (!isSensitive || value.length <= 4) return value;
  return value.slice(0, 4) + '*'.repeat(Math.max(value.length - 8, 3)) + value.slice(-4);
}

// ===== IS OWNER CHECK =====
function isOwner(jid) {
  if (!process.env.OWNER_NUMBER || !jid) return false;
  const number = jid.split('@')[0].split(':')[0].replace(/[^0-9]/g, '');
  const owner = process.env.OWNER_NUMBER.replace(/[^0-9]/g, '');
  return number === owner;
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
const ENV_PATH = path.join(__dirname, '.env');

// persistent auth handled by useMultiFileAuthState; no manual pairing request
let isLoggedIn = false;

// ===== SIAKAD KHS SCRAPPING (dari "Scrapping KHS") =====
const KHS_MAX_RUNNING = 2;
const KHS_MAX_QUEUE = 10;
const KHS_PYTHON_BIN = process.env.PYTHON_BIN || 'python';
const khsRunningJobs = new Map();
const khsQueuedJobs = [];
let khsRunningCount = 0;

function parseKhsCredentials(text) {
  const username = text.match(/^\s*Username\s*:\s*(.+?)\s*$/im)?.[1]?.trim();
  const password = text.match(/^\s*Password\s*:\s*(.+?)\s*$/im)?.[1]?.trim();

  if (!username || !password) return null;
  if (!/^\S+@\S+\.\S+$/.test(username)) return null;

  return { username, password };
}

async function khsSafeSend(sock, jid, content) {
  try {
    await sock.sendMessage(jid, content);
  } catch (error) {
    console.error('sendMessage failed:', error?.message || error);
  }
}

function splitKhsMessage(text, maxLength = 3500) {
  const chunks = [];
  let remaining = text;

  while (remaining.length > maxLength) {
    let index = remaining.lastIndexOf('\n', maxLength);
    if (index < 1) index = maxLength;
    chunks.push(remaining.slice(0, index));
    remaining = remaining.slice(index).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function createKhsLogStreamer(sock, jid) {
  let buffer = '';
  let timer = null;

  async function flush() {
    if (!buffer.trim()) return;
    const text = buffer.trimEnd();
    buffer = '';

    for (const chunk of splitKhsMessage(text)) {
      await khsSafeSend(sock, jid, { text: '```' + chunk + '```' });
    }
  }

  function push(data) {
    buffer += data.toString('utf8');
    if (buffer.length >= 3000) {
      clearTimeout(timer);
      timer = null;
      void flush();
      return;
    }

    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        void flush();
      }, 1500);
    }
  }

  return { push, flush };
}

function enqueueKhsJob(sock, jid, credentials) {
  if (khsRunningJobs.has(jid) || khsQueuedJobs.some((job) => job.jid === jid)) {
    void khsSafeSend(sock, jid, {
      text: 'Proses kamu masih berjalan/antre. Tunggu selesai, jangan kirim ulang.',
    });
    return;
  }

  if (khsRunningCount >= KHS_MAX_RUNNING && khsQueuedJobs.length >= KHS_MAX_QUEUE) {
    void khsSafeSend(sock, jid, { text: 'Antrean penuh. Coba lagi nanti.' });
    return;
  }

  const job = { sock, jid, credentials, createdAt: Date.now() };

  if (khsRunningCount < KHS_MAX_RUNNING) {
    startKhsJob(job);
    return;
  }

  khsQueuedJobs.push(job);
  void khsSafeSend(sock, jid, {
    text: `Masuk antrean. Posisi: ${khsQueuedJobs.length}. Maks proses bersamaan: ${KHS_MAX_RUNNING}.`,
  });
}

function pumpKhsQueue() {
  while (khsRunningCount < KHS_MAX_RUNNING && khsQueuedJobs.length > 0) {
    startKhsJob(khsQueuedJobs.shift());
  }
}

function startKhsJob(job) {
  khsRunningCount += 1;
  khsRunningJobs.set(job.jid, job);

  const { sock, username, password } = { ...job, ...job.credentials };
  const streamer = createKhsLogStreamer(sock, job.jid);
  let outputZip = '';

  void khsSafeSend(sock, job.jid, {
    text: 'Proses dimulai. Jangan kirim ulang sampai selesai.',
  });

  const child = spawn(KHS_PYTHON_BIN, ['app.py', '--email', username, '--password', password], {
    cwd: __dirname,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
    },
    windowsHide: true,
  });

  child.stdout.on('data', (data) => {
    const text = data.toString('utf8');
    const match = text.match(/OUTPUT_ZIP:(.+)/);
    if (match) outputZip = match[1].trim();
    streamer.push(text);
  });

  child.stderr.on('data', (data) => streamer.push(data));

  child.on('error', async (error) => {
    await streamer.flush();
    await khsSafeSend(sock, job.jid, { text: `Gagal menjalankan Python: ${error.message}` });
  });

  child.on('close', async (code) => {
    await streamer.flush();

    if (code === 0) {
      await khsSafeSend(sock, job.jid, { text: 'Proses selesai.' });

      if (outputZip && fs.existsSync(outputZip)) {
        await khsSafeSend(sock, job.jid, {
          document: fs.readFileSync(outputZip),
          mimetype: 'application/zip',
          fileName: path.basename(outputZip),
        });
      } else {
        await khsSafeSend(sock, job.jid, { text: 'ZIP output tidak ditemukan. Cek log CMD.' });
      }
    } else {
      await khsSafeSend(sock, job.jid, { text: `Proses gagal. Exit code: ${code}` });
    }

    khsRunningJobs.delete(job.jid);
    khsRunningCount -= 1;
    pumpKhsQueue();
  });
}

function handleKhsMessage(sock, chatMessage, remoteJid) {
  if (chatMessage.startsWith('/khs')) {
    const args = chatMessage.slice(4).trim();
    if (!args) {
      void khsSafeSend(sock, remoteJid, {
        text: '📄 *Scrap KRS/KHS/Transkrip/KTM SIAKAD*\n\nKirim pesan berisi kredensial SIAKAD:\n\nUsername: email@domain.com\nPassword: password_siakad\n\nSetelah selesai, bot mengirim ZIP berisi PDF KRS, KHS, Transkrip & KTM.',
      });
      return true;
    }
  }

  const credentials = parseKhsCredentials(chatMessage);
  if (credentials) {
    enqueueKhsJob(sock, remoteJid, credentials);
    return true;
  }

  return false;
}

// ===== CLEANUP OUTPUT KHS (hapus otomatis setelah 3 hari) =====
const KHS_OUTPUT_TTL_MS = 3 * 24 * 60 * 60 * 1000;

function cleanupKhsOutput() {
  try {
    const now = Date.now();
    const entries = fs.readdirSync(__dirname, { withFileTypes: true });

    for (const entry of entries) {
      const name = entry.name;
      if (!name.startsWith('KRS-KHS_')) continue;
      if (!(entry.isDirectory() || name.endsWith('.zip'))) continue;

      const fullPath = path.join(__dirname, name);
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > KHS_OUTPUT_TTL_MS) {
        fs.rmSync(fullPath, { recursive: true, force: true });
        console.log(`🧹 Output KHS dihapus (umur >3 hari): ${name}`);
      }
    }
  } catch (e) {
    console.error('Gagal cleanup output KHS:', e);
  }
}

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
      { cmd: '/jadwal', desc: 'Lihat jadwal mingguan dari EdLink' },
      { cmd: '/absen', desc: 'Cek absen dari EdLink' },
      { cmd: '/khs', desc: 'Scrap KRS/KHS/Transkrip/KTM SIAKAD (kirim Username & Password)' }
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
  owner: {
    emoji: '🔐',
    title: 'OWNER ONLY',
    commands: [
      { cmd: '/rahasia', desc: 'Lihat/edit konfigurasi .env via WhatsApp' },
      { cmd: '/rahasia set KEY=VALUE', desc: 'Ubah nilai konfigurasi (langsung aktif)' },
      { cmd: '/rahasia get KEY', desc: 'Lihat nilai konfigurasi tertentu' }
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
      { cmd: '/ww', desc: 'Wolvesville (Werewolf)' },
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

// port: gunakan PORT dari env (Railway, Fly.io, Northflank, Render, dll semua set PORT)
const PORT = Number(process.env.PORT) || 3000;
// public host: cek berbagai env umum biar URL QR viewer bener di mana pun di-deploy
const PUBLIC_HOST =
  process.env.PUBLIC_URL ||
  process.env.APP_URL ||
  process.env.RAILWAY_PUBLIC_DOMAIN ||
  process.env.NORTHFLANK_DOMAIN ||
  process.env.RENDER_EXTERNAL_URL ||
  process.env.FLY_APP_NAME &&
    process.env.FLY_REGION &&
    `https://${process.env.FLY_APP_NAME}.fly.dev` ||
  `localhost:${PORT}`;
app.listen(PORT, '0.0.0.0', () => console.log(`🌐 QR viewer: http://${PUBLIC_HOST}/qr`));

async function connectToWhatsApp() {
  // ===== LOG AUTO VIEW-ONCE & AUTO VIEW STORY CONFIG =====
  console.log('\n' + '═'.repeat(60));
  console.log('📱 AUTO VIEW CONFIGURATION:');
  console.log('─'.repeat(60));
  
  if (process.env.AUTO_VIEW_ONCE_JIDS) {
    console.log(`✅ AUTO VIEW-ONCE: ${VIEW_ONCE_AUTO_SENDERS.join(', ')}`);
  } else {
    console.log(`⏸️  AUTO VIEW-ONCE: disabled (set AUTO_VIEW_ONCE_JIDS in .env)`);
  }
  
  if (STORY_VIEW_ALL) {
    console.log(`✅ AUTO VIEW STORY: * (semua story)`);
  } else if (process.env.AUTO_VIEW_STORY_JIDS && STORY_AUTO_SENDERS.length > 0) {
    console.log(`✅ AUTO VIEW STORY: ${STORY_AUTO_SENDERS.join(', ')}`);
  } else {
    console.log(`⏸️  AUTO VIEW STORY: disabled (set AUTO_VIEW_STORY_JIDS in .env)`);
  }
  
  console.log(`📝 DELETED MESSAGE: ${DELETED_MESSAGE_DETECTION ? '✅ Aktif' : '⏸️  Nonaktif'}`);
  console.log(`🔐 OWNER NUMBER: ${OWNER_NUMBER ? `✅ ${OWNER_NUMBER}` : '⏸️  Tidak diset'}`);
  
  console.log('═'.repeat(60) + '\n');
  // ========================================

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

      // Tangkap nomor bot untuk wa.me link
      try {
        const uid = sock?.user?.id || sock?.user?.jid || '';
        if (uid) {
          BOT_PHONE = uid.split(':')[0].split('@')[0].replace(/[^0-9]/g, '');
          console.log(`📱 Bot phone: ${BOT_PHONE}`);
        }
      } catch (e) {
        console.error('Gagal tangkap nomor bot:', e);
      }

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

// Bersihkan output KHS yang berumur >3 hari saat start, lalu tiap 6 jam
cleanupKhsOutput();
setInterval(cleanupKhsOutput, 6 * 60 * 60 * 1000);
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

  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    const isFromMe = msg.key.fromMe;

    const message = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption || msg.message?.documentMessage?.caption || '';

    const isCommand = message.startsWith('/');

    // ❗ Skip hanya jika pesan dari bot DAN BUKAN command
    if (isFromMe && !isCommand) return;

    // Auto view story detection for status broadcast messages
    const isStatusBroadcast = msg.key.remoteJid === 'status@broadcast';
    if (!isFromMe && isStatusBroadcast) {
      const senderJid = msg.key.participant;
      if (isAutoStorySender(senderJid)) {
        try {
          console.log('🔄 Auto-viewing story from', senderJid);
          await sock.readMessages([msg.key]);
          console.log('✅ Auto-viewed story from', senderJid);
        } catch (e) {
          console.error('Error auto-viewing story:', e);
        }
      }
    }

    // Cache view-once messages for /see command (outside try block to avoid hoisting issues)
    const msgContent = msg.message;
    if (msgContent && Object.keys(msgContent).length > 0 && !isFromMe) {
      console.log('📨 msg.message keys:', Object.keys(msgContent));
    }
    const remoteJidCache = msg.key.remoteJid;
    if (msgContent && (msgContent.viewOnceMessage || msgContent.viewOnceMessageV2)) {
      console.log('🔍 View-once detected:', JSON.stringify({
        msgContentKeys: Object.keys(msgContent),
        remoteJid: remoteJidCache,
        remoteJidAlt: msg.key.remoteJidAlt,
        participant: msg.key.participant,
        participantAlt: msg.key.participantAlt,
        isFromMe,
        configuredSenders: AUTO_VIEW_ONCE_SENDERS
      }));
      addToViewOnceCache(remoteJidCache, msgContent);

      const senderJid = msg.key.participant || remoteJidCache;
      const senderJidAlt = msg.key.participantAlt || (remoteJidCache.endsWith('@g.us') ? undefined : msg.key.remoteJidAlt);
      console.log('🔍 Auto-send check:', JSON.stringify({
        senderJid: senderJid?.split('@')[0],
        senderJidAlt: senderJidAlt?.split('@')[0],
        isAutoViewOnceSender_primary: senderJid ? isAutoViewOnceSender(senderJid) : false,
        isAutoViewOnceSender_alt: senderJidAlt ? isAutoViewOnceSender(senderJidAlt) : false,
        remoteJidCache
      }));
      if (!isFromMe && (isAutoViewOnceSender(senderJid) || (senderJidAlt && isAutoViewOnceSender(senderJidAlt)))) {
        try {
          console.log('🔄 Auto-send view-once triggered for', senderJid, 'in', remoteJidCache);
          await autoSendViewOnceAsFile(sock, remoteJidCache, msg);
        } catch (e) {
          console.error('Error auto-sending view-once:', e);
        }
        // continue processing if desired; we can still handle commands if message also has text
      }
    }

    // ===== CACHE ALL MESSAGES FOR DELETED MESSAGE DETECTION =====
    if (DELETED_MESSAGE_DETECTION && !isFromMe && msg.key.id) {
      cacheMessage(remoteJidCache, msg.key.id, msg);
    }

    try {
      const pushName = m.messages[0].pushName;
      const msgKey = m.messages[0].key;

      // const message = m.messages[0].message;
      // const msg = m.messages[0];
      const messageArr = m.messages[0];
      const remoteJid = m.messages[0].key.remoteJid;
      const isGroup = remoteJid.endsWith('@g.us');
      const numberUser = isGroup
        ? (msgKey.participant || m.messages[0].participant || msgKey.remoteJid)
        : (msgKey.participant || msgKey.remoteJid || m.messages[0].key.remoteJidAlt || '');
      const chatId = isGroup ? remoteJid : numberUser;
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

      // === SIAKAD KHS SCRAPPING (KRS/KHS/Transkrip/KTM) ===
      if (handleKhsMessage(sock, chatMessage, remoteJid)) return;

      const sessionID = remoteJid;

      if (chatMessage.startsWith('/menu')) {
        const displayName = remoteJid.endsWith('@g.us') ? numberUser.split('@')[0] : pushName;
        const menuText = generateMenu(displayName, remoteJid.endsWith('@g.us'));

        const payload = { text: menuText };
        if (remoteJid.endsWith('@g.us')) payload.mentions = [numberUser];
        await sock.sendMessage(remoteJid, payload, { quoted: m.messages[0] });
      }

      // === /rahasia command (owner only, private chat only) ===
      if (chatMessage.startsWith('/rahasia')) {
        if (remoteJid.endsWith('@g.us')) {
          await sock.sendMessage(remoteJid, { text: '❌ Perintah /rahasia hanya bisa digunakan di chat pribadi dengan bot, bukan di grup.' }, { quoted: m.messages[0] });
          return;
        }
        // Di private chat, remoteJid = pengirim (bisa LID atau PN).
        // Coba semua alternatif JID (LID vs PN) untuk owner check.
        try {
          const raw = fs.readFileSync(ENV_PATH, 'utf-8');
          const parsed = dotenv.parse(raw);
          const fileOwner = (parsed.OWNER_NUMBER || '').replace(/[^0-9]/g, '');

          const jidCandidates = [
            remoteJid,
            m.messages[0].key.remoteJidAlt,
            m.messages[0].key.participant,
            m.messages[0].key.participantAlt,
          ].filter(Boolean);

          const senderNums = [...new Set(jidCandidates.map(j =>
            j.split('@')[0].split(':')[0].replace(/[^0-9]/g, '')
          ))];

          console.log(`🔐 /rahasia cek: sender=${senderNums.join('|')}, OWNER_NUMBER(file)=${fileOwner || '(kosong)'}, remoteJid=${remoteJid}, alt=${m.messages[0].key.remoteJidAlt || '-'}`);

          const isMatch = fileOwner && senderNums.some(n => n === fileOwner);
          if (!isMatch) {
            await sock.sendMessage(remoteJid, { text: '❌ Perintah ini hanya untuk pemilik bot.' }, { quoted: m.messages[0] });
            return;
          }
          // Sync ke runtime
          reloadEnvConfig();
        } catch (e) {
          await sock.sendMessage(remoteJid, { text: '❌ Gagal membaca konfigurasi.' }, { quoted: m.messages[0] });
          console.error('Gagal baca .env untuk /rahasia:', e);
          return;
        }

        const args = chatMessage.slice(9).trim();

        // /rahasia — show all .env content
        if (!args) {
          try {
            const envFile = fs.readFileSync(ENV_PATH, 'utf-8');
            const lines = envFile.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
            let msgText = '🔐 *Konfigurasi .env:*\n\n';
            for (const line of lines) {
              const eqIdx = line.indexOf('=');
              if (eqIdx === -1) {
                msgText += `${line}\n`;
                continue;
              }
              const key = line.slice(0, eqIdx);
              const val = line.slice(eqIdx + 1);
              const masked = maskSensitiveValue(key, val);
              msgText += `• ${key}=${masked}\n`;
            }
            await sock.sendMessage(remoteJid, { text: msgText }, { quoted: m.messages[0] });
          } catch (e) {
            await sock.sendMessage(remoteJid, { text: `❌ Gagal membaca .env: ${e.message}` }, { quoted: m.messages[0] });
          }
          return;
        }

        // /rahasia set KEY=VALUE
        if (args.startsWith('set ')) {
          const setArg = args.slice(4).trim();
          const eqIdx = setArg.indexOf('=');
          if (eqIdx === -1) {
            await sock.sendMessage(remoteJid, { text: '❌ Format: /rahasia set KEY=VALUE' }, { quoted: m.messages[0] });
            return;
          }
          const key = setArg.slice(0, eqIdx).trim().toUpperCase();
          const value = setArg.slice(eqIdx + 1).trim();
          if (!key) {
            await sock.sendMessage(remoteJid, { text: '❌ KEY tidak boleh kosong' }, { quoted: m.messages[0] });
            return;
          }

          try {
            let envFile = fs.readFileSync(ENV_PATH, 'utf-8');
            const regex = new RegExp(`^${key}=.*$`, 'm');
            if (regex.test(envFile)) {
              envFile = envFile.replace(regex, `${key}=${value}`);
            } else {
              envFile += `\n${key}=${value}`;
            }
            fs.writeFileSync(ENV_PATH, envFile, 'utf-8');

            if (reloadEnvConfig()) {
              await sock.sendMessage(remoteJid, { text: `✅ *${key}* berhasil diubah menjadi:\n\`\`\`${maskSensitiveValue(key, value)}\`\`\`\n\n🔄 Konfigurasi sudah langsung aktif tanpa restart.` }, { quoted: m.messages[0] });
            } else {
              await sock.sendMessage(remoteJid, { text: `⚠️ File .env sudah diupdate, tapi gagal me-reload konfigurasi. Restart bot diperlukan.` }, { quoted: m.messages[0] });
            }
          } catch (e) {
            await sock.sendMessage(remoteJid, { text: `❌ Gagal mengupdate .env: ${e.message}` }, { quoted: m.messages[0] });
          }
          return;
        }

        // /rahasia get KEY
        if (args.startsWith('get ')) {
          const key = args.slice(4).trim().toUpperCase();
          if (!key) {
            await sock.sendMessage(remoteJid, { text: '❌ Format: /rahasia get KEY' }, { quoted: m.messages[0] });
            return;
          }
          const val = process.env[key];
          if (val === undefined) {
            await sock.sendMessage(remoteJid, { text: `❌ *${key}* tidak ditemukan di .env` }, { quoted: m.messages[0] });
          } else {
            await sock.sendMessage(remoteJid, { text: `🔑 *${key}*=\`\`\`${maskSensitiveValue(key, val)}\`\`\`` }, { quoted: m.messages[0] });
          }
          return;
        }

        // Unknown subcommand
        await sock.sendMessage(remoteJid, { text: '🔐 *Perintah /rahasia:*\n\n/rahasia — Lihat semua konfigurasi\n/rahasia get KEY — Lihat nilai KEY\n/rahasia set KEY=VALUE — Ubah nilai KEY\n\n💡 Perubahan langsung aktif tanpa restart.' }, { quoted: m.messages[0] });
        return;
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

      if (chatMessage.startsWith('/absen')) {
        try {
          const bearer = process.env.EDLINK_BEARER;
          const data = await fetchAllPresenceStatus({ bearer });

          if (!data || data.length === 0) {
            await sock.sendMessage(remoteJid, { text: 'Tidak ada data absen yang ditemukan.' }, { quoted: m.messages[0] });
            return;
          }

          const progressBar = (current, total) => {
            const size = 10;

            if (!total || total <= 0) {
              return '░'.repeat(size);
            }

            const filled = Math.round((current / total) * size);

            return '▓'.repeat(filled) + '░'.repeat(size - filled);
          };

          const lines = data.map((item, index) => {
            const groupId = item.groupId || item.group?.id || item.group?.groupId || '';

            const classUrl = groupId ? `https://edlink.id/panel/classes/${groupId}/` : 'https://edlink.id/panel/classes/';

            const presenceTotal = item.presenceTotal ?? item.presenceCount ?? 0;

            const finishedSection = item.finishedSection ?? item.finishedCount ?? 0;

            const totalSection = item.totalSection ?? item.total ?? 0;

            const name = item.name || 'Unknown';

            const progress = progressBar(finishedSection, totalSection);

            const percentage = totalSection > 0 ? Math.round((finishedSection / totalSection) * 100) : 0;

            const status = percentage >= 100 ? '✅ Lengkap' : percentage >= 75 ? '🟡 Hampir Selesai' : '🔴 Masih Banyak';

            return `📚 *${index + 1}. ${name}*\n` + `┣ ${progress} ${percentage}%\n` + `┣ 📖 ${finishedSection}/${totalSection} Pertemuan\n` + `┣ 👥 Kehadiran: ${presenceTotal}\n` + `┣ 📌 ${status}\n` + `┗ 🔗 ${classUrl}`;
          });

          const out = `📝 *STATUS ABSEN EDLINK*\n` + `━━━━━━━━━━━━━━━\n\n` + lines.join('\n\n') + `\n\n━━━━━━━━━━━━━━━\n` + `📅 Update: ${new Date().toLocaleString('id-ID')}`;

          await sock.sendMessage(remoteJid, { text: out }, { quoted: m.messages[0] });
        } catch (err) {
          console.error('Error fetching absen:', err);

          await sock.sendMessage(remoteJid, { text: 'Gagal mengambil data absen dari EdLink.' }, { quoted: m.messages[0] });
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
          const sess = gameSessions.get(sessionKey);
          if (sess && sess.type === 'wolvesville' && sess.timers) {
            Object.values(sess.timers).forEach((t) => t && clearTimeout(t));
          }
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
        if (session.type === 'wolvesville') return;
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

      // ===== WOLVESVILLE / WW =====
      if (chatMessage === '/ww' || chatMessage.startsWith('/ww ')) {
        const wv = gameHandlers.wolvesville;
        const subRaw = chatMessage === '/ww' ? '' : chatMessage.slice(4).trim();
        const subParts = subRaw.split(/\s+/);
        const sub = (subParts[0] || '').toLowerCase();
        const arg1 = subParts[1];
        const arg2 = subParts[2];

        const WV_CFG = wv.getConfig();
        const WV_NIGHT_MS = WV_CFG.nightSeconds * 1000;
        const WV_DISCUSS_MS = WV_CFG.dayDiscussSeconds * 1000;
        const WV_VOTE_MS = WV_CFG.voteSeconds * 1000;

        const helpText =
          `🐺 *WOLVESVILLE — Werewolf Text*\n\n` +
          `Perintah (semua diawali /ww):\n` +
          `  /ww help        — Bantuan ini\n` +
          `  /ww roles       — Lihat daftar role\n` +
          `  /ww join        — Gabung lobby\n` +
          `  /ww leave       — Keluar lobby\n` +
          `  /ww list        — Lihat pemain lobby\n` +
          `  /ww start       — Mulai game (host)\n` +
          `  /ww status      — Status game\n` +
          `  /ww role        — Lihat role kamu (PM)\n` +
          `  /ww vote <no>   — Vote siang hari\n` +
          `  /ww unvote      — Batal vote\n` +
          `  /ww kill <no>   — Serigala membunuh\n` +
          `  /ww seer <no>   — Dukun menyelidiki\n` +
          `  /ww protect <no>— Bodyguard melindungi\n` +
          `  /ww shoot <no>  — Pemburu menembak\n` +
          `  /ww day         — Paksa lanjut ke siang (host, lewati timer)\n` +
          `  /ww night       — Paksa lanjut ke malam (host, lewati timer)\n` +
          `  /ww end         — Akhiri paksa (host)\n` +
          `  /exit           — Keluar & hapus sesi WW\n\n` +
          `⏱️ Timer: malam ${WV_CFG.nightSeconds}s, diskusi ${WV_CFG.dayDiscussSeconds}s, voting ${WV_CFG.voteSeconds}s (atur di database/wolvesville.json).`;


        function clearWvTimers(session) {
          if (session && session.timers) {
            Object.values(session.timers).forEach((t) => t && clearTimeout(t));
            session.timers = {};
          }
        }

        // Build wa.me link dengan nomor bot & url-encoded text.
        // Contoh: https://wa.me/628xxx?text=%2Fww%20vote%203
        function waLink(text) {
          const phone = BOT_PHONE || '';
          const encoded = encodeURIComponent(text);
          return phone
            ? `https://wa.me/${phone}?text=${encoded}`
            : `https://wa.me/?text=${encoded}`;
        }

        // Buat baris link per pemain untuk fase tertentu
        function playerActionLinks(session, action, excludeIdx = -1) {
          return session.players
            .map((p, i) => {
              if (!p.alive || i === excludeIdx) return null;
              const status = p.alive ? '🟢' : '💀';
              return `${status} [#${i + 1} ${p.name}](${waLink(`/ww ${action} ${i + 1}`)})`;
            })
            .filter(Boolean)
            .join('\n');
        }

        // Find the wolvesville session: prefer current chat, else search across all chats
        // by player membership. Wolvesville PM commands (e.g. /ww kill in private chat
        // setelah bot kirim role) harus bisa target sesi group game player tersebut.
        function findWvSession() {
          const cur = gameSessions.get(sessionKey);
          if (cur && cur.type === 'wolvesville') {
            return { session: cur, key: sessionKey };
          }
          for (const [key, sess] of gameSessions.entries()) {
            if (sess && sess.type === 'wolvesville' && wv.isInSession(sess, numberUser)) {
              return { session: sess, key };
            }
          }
          return null;
        }

        // Find any active wolvesville session regardless of chat (used by timer callbacks)
        function findWvAnySession(phase) {
          for (const [key, sess] of gameSessions.entries()) {
            if (sess && sess.type === 'wolvesville' && (!phase || sess.phase === phase)) {
              return { session: sess, key };
            }
          }
          return null;
        }

        async function wvSendTo(targetJid, text, mentions) {
          const isTargetGroup = targetJid.endsWith('@g.us');
          const payload = { text };
          if (isTargetGroup && mentions && mentions.length) payload.mentions = mentions;
          await sock.sendMessage(targetJid, payload);
        }

        async function wvSend(text, mentions) {
          await wvSendTo(remoteJid, text, mentions);
        }

        async function wvRunNightEnd() {
          const found = findWvAnySession(wv.PHASES.NIGHT);
          if (!found) return;
          const cur = found.session;
          const curKey = found.key;
          clearWvTimers(cur);
          const r = wv.resolveNight(cur);
          let text = `☀️ *HARI ${cur.day}*\n\n`;
          if (r.killed) {
            const roleName = wv.getRoleInfo(cur.players[r.killed.idx].role)?.name || '?';
            text += `💀 Malam ini, *${r.killed.name}* (${roleName}) ditemukan mati!\n`;
          } else if (r.saved) {
            text += `🛡️ Seseorang diserang tapi berhasil dilindungi!\n`;
          } else {
            text += `🤔 Tidak ada yang mati malam ini.\n`;
          }
          text += `\n📜 *Pemain Hidup:*\n${wv.getPlayerListText(cur, { mention: curKey.endsWith('@g.us') })}\n\n`;
          text += `💬 *Diskusi dibuka!* Voting akan dibuka otomatis dalam ${WV_DISCUSS_MS / 1000}s.\n`;
          text += `Saat voting dibuka, link vote akan muncul otomatis.`;

          const win = wv.checkWin(cur);
          if (win.ended) {
            text = `☀️ *HARI ${cur.day}*\n\n` +
              (r.killed ? `💀 ${r.killed.name} mati.\n` : '') +
              `\n🏆 Pemenang: *${win.winner}*\n${win.reason}\n\n${wv.getRoleRevealText(cur)}`;
            await wvSendTo(curKey, text);
            clearWvTimers(cur);
            wv.endGame(cur, win.winner, win.reason);
            gameSessions.delete(curKey);
            return;
          }

          await wvSendTo(curKey, text, curKey.endsWith('@g.us') ? wv.getPlayerMentions(cur) : undefined);

          if (cur.pendingHunter !== null && cur.pendingHunter !== undefined) {
            const hIdx = cur.pendingHunter;
            await wvSendTo(
              curKey,
              `🏹 *${cur.players[hIdx].name} (Pemburu) punya hak tembak!* Ketik /ww shoot <no> sebelum hari berakhir.`,
              curKey.endsWith('@g.us') ? [cur.players[hIdx].jid] : undefined,
            );
            try {
              await sock.sendMessage(cur.players[hIdx].jid, { text: `🏹 Kamu mati! Gunakan /ww shoot <no> sebelum hari berakhir.` });
            } catch (e) {}
          }

          cur.timers.discussTimer = setTimeout(wvOpenVoting, WV_DISCUSS_MS);
        }

        // Kirim PM ke peran malam (werewolf, seer, bodyguard) dengan daftar pemain hidup
        async function wvNotifyNightRoles(cur) {
          const wolves = cur.players
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => p.alive && p.role === 'werewolf');
          const seers = cur.players
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => p.alive && p.role === 'seer');
          const bgs = cur.players
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => p.alive && p.role === 'bodyguard');

          // Werewolves
          for (const { p: wolf } of wolves) {
            const mates = wolves.map(({ p, i }) => `  ${i + 1}. ${p.name}`).join('\n');
            const killLinks = wv.getAliveIdxList(cur)
              .filter((i) => i !== cur.players.indexOf(wolf))
              .map((i) => `  [#${i + 1} ${cur.players[i].name}](${waLink(`/ww kill ${i + 1}`)})`)
              .join('\n');
            try {
              await sock.sendMessage(wolf.jid, {
                text:
                  `🌙 *MALAM ${cur.day} — Serigala*\n\n` +
                  `👥 *Daftar Pemain (klik untuk kill):*\n${killLinks}\n\n` +
                  `🐺 *Rekan Serigala:*\n${mates || '(kamu sendiri)'}\n\n` +
                  `⏳ Aksi malam berakhir dalam ${WV_NIGHT_MS / 1000}s.`,
              });
            } catch (e) {
              console.error('Gagal PM wolf:', e);
            }
          }

          // Seers
          for (const { p: seer } of seers) {
            const sIdx = cur.players.indexOf(seer);
            const seerLinks = wv.getAliveIdxList(cur)
              .filter((i) => i !== sIdx)
              .map((i) => `  [#${i + 1} ${cur.players[i].name}](${waLink(`/ww seer ${i + 1}`)})`)
              .join('\n');
            try {
              await sock.sendMessage(seer.jid, {
                text:
                  `🌙 *MALAM ${cur.day} — Dukun*\n\n` +
                  `👥 *Daftar Pemain (klik untuk investigasi):*\n${seerLinks}\n\n` +
                  `🔮 Hasil hanya dilihat oleh kamu.\n\n` +
                  `⏳ Aksi malam berakhir dalam ${WV_NIGHT_MS / 1000}s.`,
              });
            } catch (e) {
              console.error('Gagal PM seer:', e);
            }
          }

          // Bodyguards
          for (const { p: bg } of bgs) {
            const bgIdx = cur.players.indexOf(bg);
            const bgLinks = wv.getAliveIdxList(cur)
              .filter((i) => i !== bg.lastProtectedIdx)
              .map((i) => `  [#${i + 1} ${cur.players[i].name}](${waLink(`/ww protect ${i + 1}`)})`)
              .join('\n');
            try {
              await sock.sendMessage(bg.jid, {
                text:
                  `🌙 *MALAM ${cur.day} — Bodyguard*\n\n` +
                  `👥 *Daftar Pemain (klik untuk lindungi):*\n${bgLinks}\n\n` +
                  `🛡️ Tidak boleh melindungi orang yang sama dua malam berturut-turut.\n\n` +
                  `⏳ Aksi malam berakhir dalam ${WV_NIGHT_MS / 1000}s.`,
              });
            } catch (e) {
              console.error('Gagal PM bodyguard:', e);
            }
          }
        }

        async function wvOpenVoting() {
          const found = findWvAnySession(wv.PHASES.DAY);
          if (!found) return;
          const cur = found.session;
          const curKey = found.key;
          if (cur.votingOpen) return;
          clearWvTimers(cur);
          wv.openVoting(cur);

          let text = `🗳️ *VOTING DIBUKA!*\n\n`;
          text += `Silakan pilih target dengan klik link berikut:\n\n`;
          text += `${playerActionLinks(cur, 'vote')}\n\n`;
          text += `⏳ Voting otomatis selesai dalam ${WV_VOTE_MS / 1000}s.`;

          await wvSendTo(curKey, text);
          cur.timers.voteTimer = setTimeout(wvRunDayEnd, WV_VOTE_MS);
        }

        async function wvRunDayEnd() {
          const found = findWvAnySession(wv.PHASES.DAY);
          if (!found) return;
          const cur = found.session;
          const curKey = found.key;
          clearWvTimers(cur);
          const r = wv.resolveVote(cur);
          let text = `🌙 *MALAM ${cur.day + 1}*\n\n`;
          if (r.lynched) {
            const roleName = wv.getRoleInfo(cur.players[r.lynched.idx].role)?.name || '?';
            text += `⚖️ Siang ini, *${r.lynched.name}* (${roleName}) digantung!\n`;
          } else {
            text += `${r.reason}\n`;
          }
          cur.phase = wv.PHASES.NIGHT;
          cur.day += 1;
          cur.nightActions = { kills: {}, seerChecks: {}, protects: {} };
          cur.votingOpen = false;
          text += `\nSilakan peran malam menjalankan aksi:\n• /ww kill <no>\n• /ww seer <no>\n• /ww protect <no>`;

          if (r.hunterTrigger) {
            text += `\n\n🏹 *${r.hunterTrigger.name} (Pemburu) punya hak tembak malam ini!*`;
            try {
              await sock.sendMessage(cur.players[r.hunterTrigger.idx].jid, { text: `🏹 Kamu mati digantung! Gunakan /ww shoot <no> malam ini juga.` });
            } catch (e) {}
            cur.pendingHunter = r.hunterTrigger.idx;
          }

          const win = wv.checkWin(cur);
          if (win.ended) {
            text += `\n\n🏆 Pemenang: *${win.winner}*\n${win.reason}\n\n${wv.getRoleRevealText(cur)}`;
            await wvSendTo(curKey, text);
            clearWvTimers(cur);
            wv.endGame(cur, win.winner, win.reason);
            gameSessions.delete(curKey);
            return;
          }

          text += `\n\n⏳ Malam otomatis lanjut ke hari dalam ${WV_NIGHT_MS / 1000}s.`;
          await wvSendTo(curKey, text);

          // PM peran malam (werewolf, seer, bodyguard) dengan list pemain + link aksi
          await wvNotifyNightRoles(cur);

          cur.timers.nightTimer = setTimeout(wvRunNightEnd, WV_NIGHT_MS);
        }

        if (sub === 'help' || sub === '') {
          await sock.sendMessage(remoteJid, { text: helpText }, { quoted: msg });
          return;
        }

        if (sub === 'roles') {
          await sock.sendMessage(remoteJid, { text: wv.getRoleListText() }, { quoted: msg });
          return;
        }

        // ---- status (works in any phase) ----
        if (sub === 'status' || sub === 'list') {
          const found = findWvSession();
          if (!found) {
            await sock.sendMessage(
              remoteJid,
              { text: '⚠️ Belum ada sesi Wolvesville. Ketik /ww untuk mulai.' },
              { quoted: msg },
            );
            return;
          }
          const existing = found.session;
          if (sub === 'list') {
            let listText = wv.getPlayerListText(existing, { mention: isGroup });
            if (existing.phase === wv.PHASES.DAY && existing.votingOpen) {
              const voterIdx = wv.getPlayerIdx(existing, numberUser);
              const canVote = voterIdx !== -1 && existing.players[voterIdx].alive;
              if (canVote) {
                listText += `\n\n🗳️ *Vote (klik link):*\n${playerActionLinks(existing, 'vote', voterIdx)}`;
              } else {
                listText += `\n\n🗳️ *Vote (klik link):*\n${playerActionLinks(existing, 'vote')}`;
              }
            } else if (existing.phase === wv.PHASES.NIGHT) {
              listText += `\n\n🌙 *Aksi Malam (klik link):*\n${playerActionLinks(existing, 'kill')}`;
            } else if (existing.phase === wv.PHASES.DAY) {
              listText += `\n\n💬 *Masa diskusi — voting belum dibuka.*`;
            }
            const payload = { text: listText };
            if (isGroup) payload.mentions = wv.getPlayerMentions(existing);
            await sock.sendMessage(remoteJid, payload, { quoted: msg });
            return;
          }
          let text = wv.getStatusText(existing);
          if (existing.phase === wv.PHASES.DAY) {
            if (existing.votingOpen) {
              const tally = wv.getVoteTally(existing);
              const tallyLines = Object.entries(tally)
                .map(([idx, c]) => `  ${Number(idx) + 1}. ${existing.players[idx].name} — ${c} suara`)
                .sort((a, b) => Number(b.split(' — ')[1].split(' ')[0]) - Number(a.split(' — ')[1].split(' ')[0]));
              text += `\n\n📊 *Vote Sementara:*\n${tallyLines.length ? tallyLines.join('\n') : '  (belum ada)'}`;
              const voterIdx = wv.getPlayerIdx(existing, numberUser);
              const canVote = voterIdx !== -1 && existing.players[voterIdx].alive;
              if (canVote) {
                text += `\n\n🗳️ *Klik untuk vote:*\n${playerActionLinks(existing, 'vote', voterIdx)}`;
              } else {
                text += `\n\n🗳️ *Klik untuk vote:*\n${playerActionLinks(existing, 'vote')}`;
              }
            } else {
              text += `\n\n💬 *Masa diskusi — voting akan dibuka otomatis.*`;
            }
          }
          await sock.sendMessage(remoteJid, { text }, { quoted: msg });
          return;
        }

        // ---- join ----
        if (sub === 'join') {
          const found = findWvSession();
          if (!found) {
            const lobby = wv.createLobby(numberUser, pushName);
            gameSessions.set(sessionKey, lobby);
            const lobbyMentions = isGroup ? [numberUser, ...wv.getPlayerMentions(lobby)] : undefined;
            await sock.sendMessage(
              remoteJid,
              {
                text:
                  `🐺 *WOLVESVILLE — Lobby Dibuat*\nHost: @${numberUser.split('@')[0]}\n\n` +
                  `${wv.getPlayerListText(lobby, { mention: isGroup })}\n\n` +
                  `Minimal ${wv.getConfig().minPlayers} pemain. Ketik /ww join untuk gabung, /ww start untuk mulai.`,
                mentions: lobbyMentions,
              },
              { quoted: msg },
            );
            return;
          }
          const existing = found.session;
          const currentKey = found.key;
          // Kalau sesi ditemukan di chat LAIN, player sudah di game lain
          if (currentKey !== sessionKey) {
            await sock.sendMessage(
              remoteJid,
              { text: '⚠️ Kamu sudah ada di sesi Wolvesville lain. Keluar dulu dengan /ww leave (di chat game tersebut).' },
              { quoted: msg },
            );
            return;
          }
          if (!wv.isLobby(existing)) {
            await sock.sendMessage(remoteJid, { text: '⚠️ Game sudah berjalan, tidak bisa join.' }, { quoted: msg });
            return;
          }
          const r = wv.joinLobby(existing, numberUser, pushName);
          if (!r.ok) {
            await sock.sendMessage(remoteJid, { text: `❌ ${r.reason}` }, { quoted: msg });
            return;
          }
          await sock.sendMessage(
            remoteJid,
            {
              text: `✅ @${numberUser.split('@')[0]} bergabung!\n\n${wv.getPlayerListText(existing, { mention: isGroup })}`,
              mentions: isGroup ? wv.getPlayerMentions(existing) : undefined,
            },
            { quoted: msg },
          );
          return;
        }

        // ---- leave ----
        if (sub === 'leave') {
          const found = findWvSession();
          if (!found || !wv.isLobby(found.session)) {
            await sock.sendMessage(remoteJid, { text: '⚠️ Tidak ada lobby untuk ditinggalkan.' }, { quoted: msg });
            return;
          }
          const existing = found.session;
          const r = wv.leaveLobby(existing, numberUser);
          if (!r.ok) {
            await sock.sendMessage(remoteJid, { text: `❌ ${r.reason}` }, { quoted: msg });
            return;
          }
          await sock.sendMessage(
            remoteJid,
            {
              text: `🚪 @${numberUser.split('@')[0]} keluar dari lobby.\n\n${wv.getPlayerListText(existing, { mention: isGroup })}`,
              mentions: isGroup ? wv.getPlayerMentions(existing) : undefined,
            },
            { quoted: msg },
          );
          return;
        }

        // ---- start ----
        if (sub === 'start') {
          const existing = gameSessions.get(sessionKey);
          if (!existing || existing.type !== 'wolvesville' || !wv.isLobby(existing)) {
            await sock.sendMessage(remoteJid, { text: '⚠️ Tidak ada lobby untuk dimulai.' }, { quoted: msg });
            return;
          }
          if (existing.hostJid !== numberUser) {
            await sock.sendMessage(remoteJid, { text: '❌ Hanya host yang bisa /ww start.' }, { quoted: msg });
            return;
          }
          const r = wv.startGame(existing);
          if (!r.ok) {
            await sock.sendMessage(remoteJid, { text: `❌ ${r.reason}` }, { quoted: msg });
            return;
          }
          const aliveList = wv.getPlayerListText(existing, { mention: isGroup });
          const mentions = existing.players.map((p) => p.jid);
          await sock.sendMessage(
            remoteJid,
            {
              text:
                `🎬 *WOLVESVILLE DIMULAI!*\n\n${aliveList}\n\n` +
                `🌙 *Malam 1* — Semua peran, cek PM bot untuk role kamu.\n` +
                `• Serigala: /ww kill <no>\n` +
                `• Dukun: /ww seer <no>\n` +
                `• Bodyguard: /ww protect <no>`,
              mentions: isGroup ? mentions : undefined,
            },
            { quoted: msg },
          );
          for (const p of existing.players) {
            const info = wv.getPlayerRolePM(existing, p.jid);
            if (!info) continue;
            let pmText =
              `🎭 *Role Kamu*\n\n` +
              `${info.emoji} *${info.roleName}*\n` +
              `${info.desc}\n\n` +
              `Tim: ${info.team === 'werewolf' ? '🐺 Serigala' : '🏘️ Warga'}\n`;
            if (info.role === 'werewolf') {
              const mates = wv.getWerewolfTeamPM(existing, p.jid) || [];
              pmText += `\n👥 *Rekan Serigala:*\n${mates.map((m) => `  ${m.idx + 1}. ${m.name} ${m.alive ? '🟢' : '💀'}`).join('\n')}\n`;
              pmText += `\n🐺 *Klik untuk kill target:*\n${playerActionLinks(existing, 'kill', p.idx)}`;
            } else if (info.role === 'seer') {
              pmText += `\n🔮 *Klik untuk menyelidiki:*\n${playerActionLinks(existing, 'seer', p.idx)}`;
            } else if (info.role === 'bodyguard') {
              pmText += `\n🛡️ *Klik untuk lindungi:*\n${playerActionLinks(existing, 'protect', p.idx)}`;
            } else if (info.role === 'hunter') {
              pmText += `\n🏹 Saat kamu mati, ketik /ww shoot <no> untuk menembak satu pemain.`;
            } else {
              pmText += `\n[Lihat daftar pemain](${waLink('/ww list')})`;
            }
            try {
              await sock.sendMessage(p.jid, { text: pmText });
            } catch (e) {
              console.error('Gagal kirim PM role:', e);
            }
          }
          existing.timers = {};
          existing.timers.nightTimer = setTimeout(wvRunNightEnd, WV_NIGHT_MS);
          return;
        }

        // ---- end / cancel ----
        if (sub === 'end' || sub === 'cancel') {
          const found = findWvSession();
          if (!found) {
            await sock.sendMessage(remoteJid, { text: '⚠️ Tidak ada sesi Wolvesville.' }, { quoted: msg });
            return;
          }
          const existing = found.session;
          const currentKey = found.key;
          if (existing.hostJid !== numberUser) {
            await sock.sendMessage(remoteJid, { text: '❌ Hanya host yang bisa /ww end.' }, { quoted: msg });
            return;
          }
          if (existing.timers) {
            Object.values(existing.timers).forEach((t) => t && clearTimeout(t));
          }
          wv.cancelLobby(existing);
          await sock.sendMessage(
            remoteJid,
            { text: `🛑 Sesi Wolvesville diakhiri oleh host.` },
            { quoted: msg },
          );
          gameSessions.delete(currentKey);
          return;
        }

        // ---- role (PM info) ----
        if (sub === 'role') {
          const found = findWvSession();
          if (!found) {
            await sock.sendMessage(remoteJid, { text: '⚠️ Belum ada sesi Wolvesville.' }, { quoted: msg });
            return;
          }
          const existing = found.session;
          const info = wv.getPlayerRolePM(existing, numberUser);
          if (!info) {
            await sock.sendMessage(remoteJid, { text: '❌ Kamu bukan pemain di sesi ini.' }, { quoted: msg });
            return;
          }
          await sock.sendMessage(remoteJid, { text: `🎭 Role kamu: ${info.emoji} *${info.roleName}*\n${info.desc}` }, { quoted: msg });
          return;
        }

        // ---- in-game actions ----
        const found = findWvSession();
        if (!found) {
          await sock.sendMessage(remoteJid, { text: '⚠️ Belum ada sesi Wolvesville. Ketik /ww untuk mulai.' }, { quoted: msg });
          return;
        }
        const existing = found.session;
        const playerIdx = wv.getPlayerIdx(existing, numberUser);
        if (playerIdx === -1) {
          await sock.sendMessage(remoteJid, { text: '❌ Kamu bukan pemain di sesi ini.' }, { quoted: msg });
          return;
        }
        const me = existing.players[playerIdx];

        const parseTarget = (a) => {
          if (!a) return null;
          const n = parseInt(a, 10);
          if (Number.isNaN(n) || n < 1 || n > existing.players.length) return null;
          return n - 1;
        };

        // ---- werewolf kill ----
        if (sub === 'kill') {
          if (existing.phase !== wv.PHASES.NIGHT) {
            await sock.sendMessage(remoteJid, { text: '❌ /ww kill hanya bisa dipakai saat malam.' }, { quoted: msg });
            return;
          }
          if (me.role !== 'werewolf' || !me.alive) {
            await sock.sendMessage(remoteJid, { text: '❌ Kamu bukan Serigala hidup.' }, { quoted: msg });
            return;
          }
          const target = parseTarget(arg1);
          if (target === null) {
            await sock.sendMessage(remoteJid, { text: '❌ Target tidak valid. Contoh: /ww kill 2' }, { quoted: msg });
            return;
          }
          const r = wv.processWerewolfKill(existing, playerIdx, target);
          if (!r.ok) {
            await sock.sendMessage(remoteJid, { text: `❌ ${r.reason}` }, { quoted: msg });
            return;
          }
          const tally = existing.nightActions.kills;
          const votes = Object.values(tally);
          const totalWolves = existing.players.filter((p) => p.alive && p.role === 'werewolf').length;
          await sock.sendMessage(
            remoteJid,
            {
              text:
                `🐺 Kill dicatat: target #${target + 1} (${existing.players[target].name})\n` +
                `Vote Serigala masuk: ${votes.length}/${totalWolves}`,
            },
            { quoted: msg },
          );
          return;
        }

        // ---- seer check ----
        if (sub === 'seer') {
          if (existing.phase !== wv.PHASES.NIGHT) {
            await sock.sendMessage(remoteJid, { text: '❌ /ww seer hanya bisa dipakai saat malam.' }, { quoted: msg });
            return;
          }
          if (me.role !== 'seer' || !me.alive) {
            await sock.sendMessage(remoteJid, { text: '❌ Kamu bukan Dukun hidup.' }, { quoted: msg });
            return;
          }
          const target = parseTarget(arg1);
          if (target === null) {
            await sock.sendMessage(remoteJid, { text: '❌ Target tidak valid. Contoh: /ww seer 3' }, { quoted: msg });
            return;
          }
          const r = wv.processSeerCheck(existing, playerIdx, target);
          if (!r.ok) {
            await sock.sendMessage(remoteJid, { text: `❌ ${r.reason}` }, { quoted: msg });
            return;
          }
          await sock.sendMessage(
            remoteJid,
            { text: `🔮 Hasil investigasi #${target + 1} (${r.targetName}): *${r.result}*` },
            { quoted: msg },
          );
          return;
        }

        // ---- bodyguard protect ----
        if (sub === 'protect') {
          if (existing.phase !== wv.PHASES.NIGHT) {
            await sock.sendMessage(remoteJid, { text: '❌ /ww protect hanya bisa dipakai saat malam.' }, { quoted: msg });
            return;
          }
          if (me.role !== 'bodyguard' || !me.alive) {
            await sock.sendMessage(remoteJid, { text: '❌ Kamu bukan Bodyguard hidup.' }, { quoted: msg });
            return;
          }
          const target = parseTarget(arg1);
          if (target === null) {
            await sock.sendMessage(remoteJid, { text: '❌ Target tidak valid. Contoh: /ww protect 4' }, { quoted: msg });
            return;
          }
          const r = wv.processBodyguardProtect(existing, playerIdx, target);
          if (!r.ok) {
            await sock.sendMessage(remoteJid, { text: `❌ ${r.reason}` }, { quoted: msg });
            return;
          }
          await sock.sendMessage(
            remoteJid,
            { text: `🛡️ Kamu melindungi #${target + 1} (${existing.players[target].name}) malam ini.` },
            { quoted: msg },
          );
          return;
        }

        // ---- vote / unvote ----
        if (sub === 'vote' || sub === 'unvote') {
          if (existing.phase !== wv.PHASES.DAY) {
            await sock.sendMessage(remoteJid, { text: '❌ Voting hanya saat siang hari.' }, { quoted: msg });
            return;
          }
          if (!me.alive) {
            await sock.sendMessage(remoteJid, { text: '💀 Pemain mati tidak bisa vote.' }, { quoted: msg });
            return;
          }
          if (sub === 'unvote') {
            wv.processVote(existing, playerIdx, -1);
            await sock.sendMessage(remoteJid, { text: '↩️ Vote dibatalkan.' }, { quoted: msg });
            return;
          }
          const target = parseTarget(arg1);
          if (target === null) {
            await sock.sendMessage(remoteJid, { text: '❌ Target tidak valid. Contoh: /ww vote 2' }, { quoted: msg });
            return;
          }
          const r = wv.processVote(existing, playerIdx, target);
          if (!r.ok) {
            await sock.sendMessage(remoteJid, { text: `❌ ${r.reason}` }, { quoted: msg });
            return;
          }
          const tally = wv.getVoteTally(existing);
          const aliveVoters = existing.players.filter((p) => p.alive).length;
          const voted = Object.keys(existing.dayVotes).filter((i) => existing.players[i].alive).length;
          await sock.sendMessage(
            remoteJid,
            {
              text:
                `🗳️ Vote ke #${target + 1} (${existing.players[target].name}) dicatat.\n` +
                `Progres: ${voted}/${aliveVoters} sudah vote.\n` +
                `Tally saat ini: ${Object.entries(tally).map(([i, c]) => `#${Number(i) + 1}=${c}`).join(', ') || '-'}`,
            },
            { quoted: msg },
          );
          return;
        }

        // ---- hunter shoot ----
        if (sub === 'shoot') {
          if (existing.pendingHunter !== playerIdx) {
            await sock.sendMessage(remoteJid, { text: '❌ Kamu tidak punya hak menembak saat ini.' }, { quoted: msg });
            return;
          }
          const target = parseTarget(arg1);
          if (target === null) {
            await sock.sendMessage(remoteJid, { text: '❌ Target tidak valid. Contoh: /ww shoot 3' }, { quoted: msg });
            return;
          }
          const r = wv.processHunterShoot(existing, playerIdx, target);
          if (!r.ok) {
            await sock.sendMessage(remoteJid, { text: `❌ ${r.reason}` }, { quoted: msg });
            return;
          }
          const mentions = isGroup ? [existing.players[target.idx].jid] : undefined;
          await sock.sendMessage(
            remoteJid,
            {
              text: `🏹 *${me.name} menembak #${target + 1} (${r.target.name})!* — ${r.target.name} mati.`,
              mentions,
            },
            { quoted: msg },
          );
          const win = wv.checkWin(existing);
          if (win.ended) {
            wv.endGame(existing, win.winner, win.reason);
            if (existing.timers) {
              Object.values(existing.timers).forEach((t) => t && clearTimeout(t));
              existing.timers = {};
            }
            // Kirim ke chat sesi (group/PM) — kalau player shoot dari PM, kirim ke chat game
            const gameChat = found.key;
            await sock.sendMessage(
              gameChat,
              {
                text:
                  `🏁 *GAME BERAKHIR*\n\n${wv.getRoleRevealText(existing)}\n\n` +
                  `🏆 Pemenang: *${win.winner}*\n📝 ${win.reason}`,
              },
            );
            gameSessions.delete(found.key);
          }
          return;
        }

        // ---- host: manual phase transition ----
        if (sub === 'day' || sub === 'night') {
          if (existing.hostJid !== numberUser) {
            await sock.sendMessage(remoteJid, { text: '❌ Hanya host yang bisa pindah fase manual.' }, { quoted: msg });
            return;
          }
          if (sub === 'day' && existing.phase === wv.PHASES.NIGHT) {
            await wvRunNightEnd();
            return;
          }
          if (sub === 'night' && existing.phase === wv.PHASES.DAY) {
            await wvRunDayEnd();
            return;
          }
          await sock.sendMessage(remoteJid, { text: `⚠️ Tidak bisa pindah ke fase ${sub} dari fase ${existing.phase}.` }, { quoted: msg });
          return;
        }

        await sock.sendMessage(remoteJid, { text: `❓ Sub-perintah tidak dikenal: *${sub}*\n\n${helpText}` }, { quoted: msg });
        return;
      }
    } catch (error) {
      console.error('Error handling incoming message:', error);
    }
  });

  // ===== HANDLE DELETED/REVOKED MESSAGES =====
  sock.ev.on('messages.update', async (m) => {
    if (!DELETED_MESSAGE_DETECTION) return;
    try {
      for (const { key, update } of m) {
        // Deteksi apakah pesan direvoke (dihapus)
        // Dalam Baileys, revoked message ditunjukkan dengan:
        // 1. update.message === null (pesan field menjadi null)
        // 2. update.messageStubType === 21 atau 22 (message stub types for delete)
        // 3. update.messageStubArguments mengindikasikan penghapusan
        
        const isDeletedByUser = update.message === null || 
                                update.messageStubType === 21 || 
                                update.messageStubType === 22 ||
                                (update.messageStubType && update.messageStubArguments);
        
        if (isDeletedByUser) {
          try {
            const { remoteJid, id: messageId } = key;
            const isFromMe = key.fromMe;
            
            // Hanya proses pesan dari orang lain (bukan bot)
            if (isFromMe) continue;
            
            // Ambil data pesan dari cache
            const cachedData = getCachedMessage(remoteJid, messageId);
            
            if (cachedData) {
              // Kirim notifikasi pesan dihapus ke nomor owner (OWNER_NUMBER),
              // baik untuk grup maupun private chat
              if (OWNER_NUMBER) {
                const ownerJid = OWNER_NUMBER.endsWith('@s.whatsapp.net')
                  ? OWNER_NUMBER
                  : `${OWNER_NUMBER}@s.whatsapp.net`;
                const notification = createDeletedMessageNotification(cachedData, remoteJid);
                
                const isGroup = remoteJid.endsWith('@g.us');
                const chatSource = isGroup
                  ? `📍 *Lokasi:* Group (${remoteJid.split('@')[0]})`
                  : `📍 *Lokasi:* Private Chat (${remoteJid.split('@')[0]})`;
                
                // Kirim ke owner
                await sock.sendMessage(ownerJid, {
                  text: `${notification}\n\n${chatSource}`
                });
                
                console.log(`✅ Pesan dihapus terdeteksi di ${remoteJid} dan dilaporkan ke owner ${OWNER_NUMBER}`);
              } else {
                console.log(`⚠️ OWNER_NUMBER tidak diset, pesan dihapus di ${remoteJid} tidak dilaporkan`);
              }
            } else {
              console.log(`⚠️ Pesan dihapus terdeteksi (${messageId}) tapi data tidak ditemukan di cache`);
            }
          } catch (err) {
            console.error('Error processing revoked message:', err);
          }
        }
      }
    } catch (error) {
      console.error('Error in messages.update handler:', error);
    }
  });
}

connectToWhatsApp();
