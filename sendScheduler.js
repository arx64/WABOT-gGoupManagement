import db from './db.js';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(customParseFormat);
dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || 'Asia/Jakarta';

const sessions = new Map(); // key: `${chatId}|${user}` -> { chatId, user, targetNumber, messageText }

function sessionKey(chatId, user) {
  return `${chatId}|${user}`;
}

async function ensureTable() {
  const exists = await db.schema.hasTable('scheduled_messages');
  if (!exists) {
    await db.schema.createTable('scheduled_messages', (t) => {
      t.increments('id');
      t.string('target_number');
      t.text('message_text');
      t.string('send_at'); // YYYY-MM-DD HH:mm:ss (timezone TZ)
      t.string('status').defaultTo('pending'); // pending / sent / failed / cancelled
      t.text('error');
      t.string('created_by');
      t.timestamp('created_at').defaultTo(db.fn.now());
    });
  }
}

function normalizeNumber(input) {
  let n = String(input || '').replace(/[^0-9]/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  return n;
}

function parseWhen(text) {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;

  if (t === 'now' || t === 'sekarang') return dayjs().tz(TZ);

  const rel = t.match(/^(\d+)\s*(detik|menit|jam|hari)\s*(lagi)?$/);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const unitMap = { detik: 'second', menit: 'minute', jam: 'hour', hari: 'day' };
    return dayjs().tz(TZ).add(n, unitMap[rel[2]]);
  }

  const d1 = dayjs(t, 'DD-MM-YYYY HH:mm:ss', true);
  if (d1.isValid()) return d1.tz(TZ, true);

  const d2 = dayjs(t, 'DD-MM-YYYY HH:mm', true);
  if (d2.isValid()) return d2.tz(TZ, true);

  const d3 = dayjs(t, 'DD-MM-YYYY', true);
  if (d3.isValid()) return d3.tz(TZ, true).hour(23).minute(59).second(59);

  return null;
}

export async function startSendSession(sock, chatId, user, rawNumber) {
  const num = normalizeNumber(rawNumber);
  if (!/^\d{8,15}$/.test(num)) {
    await sock.sendMessage(chatId, {
      text: '❌ Nomor tidak valid. Gunakan format internasional tanpa tanda +, contoh: /send 6281234567890',
    });
    return;
  }
  const key = sessionKey(chatId, user);
  sessions.set(key, { chatId, user, targetNumber: num, messageText: null });
  await sock.sendMessage(chatId, {
    text: `📨 *Kirim Pesan Terjadwal*\n\n📲 Nomor tujuan: *${num}*\n\nSekarang kirim *teks pesan* yang mau dikirim.\n\nKetik /batal untuk membatalkan.`,
  });
}

export async function handleSendInput(sock, chatId, user, text) {
  const key = sessionKey(chatId, user);
  const s = sessions.get(key);
  if (!s) return false;

  // Step 1: belum ada teks pesan
  if (!s.messageText) {
    const msg = String(text || '').trim();
    if (!msg) {
      await sock.sendMessage(chatId, { text: '⚠️ Pesan tidak boleh kosong. Kirim teks pesannya.' });
      return true;
    }
    s.messageText = msg;
    await sock.sendMessage(chatId, {
      text:
        `📝 Pesan diterima:\n\n"${msg}"\n\n` +
        `⏰ Sekarang kirim *waktu pengiriman*.\n\n` +
        `Format: *DD-MM-YYYY HH:mm:ss*\nContoh: *06-08-2026 15:30:00*\n\n` +
        `Bisa juga ketik:\n• *now* → kirim sekarang\n• *5 menit lagi* / *2 jam lagi* → relatif`,
    });
    return true;
  }

  // Step 2: parse waktu
  const when = parseWhen(text);
  if (!when) {
    await sock.sendMessage(chatId, {
      text:
        '❌ Waktu tidak dikenali.\n\n' +
        'Gunakan format *DD-MM-YYYY HH:mm:ss*\nContoh: *06-08-2026 15:30:00*\n\n' +
        'Atau ketik *now*, *5 menit lagi*, *1 jam lagi*.',
    });
    return true;
  }

  await ensureTable();
  const sendAtStr = when.format('YYYY-MM-DD HH:mm:ss');
  const ids = await db('scheduled_messages').insert({
    target_number: s.targetNumber,
    message_text: s.messageText,
    send_at: sendAtStr,
    status: 'pending',
    created_by: user,
  });
  const id = Array.isArray(ids) ? ids[0] : null;
  sessions.delete(key);

  await sock.sendMessage(chatId, {
    text:
      `✅ *Pesan Terjadwal!*\n\n` +
      `🆔 ID: ${id}\n` +
      `📲 Ke: ${s.targetNumber}\n` +
      `📝 Pesan: "${s.messageText}"\n` +
      `⏰ Kirim: ${when.format('DD-MM-YYYY HH:mm:ss')}\n\n` +
      `Ketik */sendlist* untuk lihat daftar.\nKetik */sendcancel <id>* untuk membatalkan.`,
  });
  return true;
}

export async function cancelSendSession(sock, chatId, user) {
  const key = sessionKey(chatId, user);
  if (!sessions.has(key)) return false;
  sessions.delete(key);
  await sock.sendMessage(chatId, {
    text: '❌ Proses dibatalkan. Ketik /send <nomor> untuk mulai lagi.',
  });
  return true;
}

export async function listSends(user) {
  await ensureTable();
  const rows = await db('scheduled_messages')
    .select('*')
    .where('created_by', user)
    .orderBy('id', 'desc')
    .limit(20);

  if (!rows.length) {
    return '📭 Belum ada pesan terjadwal.\n\nGunakan /send <nomor> untuk membuat jadwal.';
  }

  let msg = '📨 *Daftar Pesan Terjadwal:*\n\n';
  rows.forEach((r, i) => {
    const statusText =
      r.status === 'pending'
        ? '⏳ Menunggu'
        : r.status === 'sent'
          ? '✅ Terkirim'
          : r.status === 'cancelled'
            ? '❌ Dibatalkan'
            : '❌ Gagal';
    const snippet = r.message_text.length > 60 ? r.message_text.slice(0, 60) + '...' : r.message_text;
    msg += `${i + 1}. ID ${r.id} — ${statusText}\n`;
    msg += `   📲 ${r.target_number}\n`;
    msg += `   ⏰ ${r.send_at}\n`;
    msg += `   📝 ${snippet}\n\n`;
  });
  msg += 'Ketik /sendcancel <id> untuk membatalkan yang masih menunggu.';
  return msg;
}

export async function cancelSend(id, user) {
  await ensureTable();
  const row = await db('scheduled_messages').where({ id }).where('created_by', user).first();
  if (!row) return '❌ Pesan terjadwal tidak ditemukan.';
  if (row.status !== 'pending') return `❌ Pesan ID ${id} sudah ${row.status}, tidak bisa dibatalkan.`;
  await db('scheduled_messages').where({ id }).update({ status: 'cancelled' });
  return `✅ Pesan ID ${id} dibatalkan.`;
}

let intervalId = null;

export async function startSendScheduler(sock) {
  await ensureTable();
  if (intervalId) clearInterval(intervalId);

  intervalId = setInterval(async () => {
    try {
      const nowStr = dayjs().tz(TZ).format('YYYY-MM-DD HH:mm:ss');
      const rows = await db('scheduled_messages')
        .select('*')
        .where('status', 'pending')
        .where('send_at', '<=', nowStr);

      for (const r of rows) {
        try {
          const jid = `${r.target_number}@s.whatsapp.net`;
          await sock.sendMessage(jid, { text: r.message_text });
          await db('scheduled_messages').where('id', r.id).update({ status: 'sent' });
          console.log(`Sent scheduled message id=${r.id} to ${r.target_number}`);
          try {
            await sock.sendMessage(r.created_by, {
              text: `✅ Pesan terjadwal terkirim ke *${r.target_number}*.\n📝 "${r.message_text}"`,
            });
          } catch (e) {
            /* ignore */
          }
        } catch (err) {
          console.error('Failed scheduled send id=', r.id, err);
          await db('scheduled_messages').where('id', r.id).update({ status: 'failed', error: err.message || 'error' });
        }
      }
    } catch (err) {
      console.error('Send scheduler error:', err);
    }
  }, 10000);
}

export function stopSendScheduler() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}

export default { startSendSession, handleSendInput, cancelSendSession, listSends, cancelSend, startSendScheduler, stopSendScheduler };
