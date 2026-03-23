// createGroupWithFile.js
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createGroupWithFile(sock, msg, chatMessage, senderJid) {
  try {
    /* =========================================================
     * 1. VALIDASI DASAR
     * ========================================================= */
    const ext = msg.message?.extendedTextMessage;
    const contextInfo = ext?.contextInfo;

    if (!contextInfo?.quotedMessage) {
      await sock.sendMessage(
        senderJid,
        {
          text: '❗ Perintah *harus* dikirim dengan *membalas file .txt*.\n\n' + '📌 Contoh:\nBalas file ➜ `/new "Nama Grup"`',
        },
        { quoted: msg }
      );
      return;
    }

    /* =========================================================
     * 2. EKSTRAK DOCUMENT MESSAGE (AMAN & UNIVERSAL)
     * ========================================================= */
    const quoted = contextInfo.quotedMessage;

    let documentMessage = null;

    if (quoted.documentMessage) {
      documentMessage = quoted.documentMessage;
    } else if (quoted.documentWithCaptionMessage?.message?.documentMessage) {
      documentMessage = quoted.documentWithCaptionMessage.message.documentMessage;
    }

    if (!documentMessage) {
      await sock.sendMessage(senderJid, { text: '❗ Pesan yang dibalas *bukan file*.' }, { quoted: msg });
      return;
    }

    if (!documentMessage.mimetype?.includes('text/plain')) {
      await sock.sendMessage(senderJid, { text: '❗ File harus berupa *.txt* berisi nomor telepon.' }, { quoted: msg });
      return;
    }

    /* =========================================================
     * 3. DOWNLOAD FILE (CARA RESMI & STABIL)
     * ========================================================= */
    const buffer = await downloadMediaMessage({ message: { documentMessage } }, 'buffer', {}, { logger: console });

    if (!buffer) {
      await sock.sendMessage(senderJid, { text: '❗ Gagal mengunduh file.' }, { quoted: msg });
      return;
    }

    /* =========================================================
     * 4. BACA & VALIDASI ISI FILE
     * ========================================================= */
    const content = buffer.toString('utf-8').trim();

    if (!content) {
      await sock.sendMessage(senderJid, { text: '❗ File kosong.' }, { quoted: msg });
      return;
    }

    const numbers = content
      .split(/\r?\n/)
      .map((v) => v.trim())
      .filter(Boolean)
      .map((num) => {
        let n = num.replace(/\D/g, '');
        if (n.startsWith('0')) n = '62' + n.slice(1);
        if (!n.startsWith('62')) return null;
        if (n.length < 10 || n.length > 15) return null;
        return n + '@s.whatsapp.net';
      })
      .filter(Boolean);

    // Remove duplicates
    const uniqueNumbers = [...new Set(numbers)];

    if (!uniqueNumbers.length) {
      await sock.sendMessage(senderJid, { text: '❗ Tidak ditemukan nomor valid di file.' }, { quoted: msg });
      return;
    }

    /* =========================================================
     * 5. PARSE NAMA GRUP
     * ========================================================= */
    const groupName = chatMessage
      .replace(/^\/new\s+/i, '')
      .replace(/^["']|["']$/g, '')
      .trim()
      .substring(0, 25); // Limit to 25 chars (WhatsApp limit)

    if (!groupName) {
      await sock.sendMessage(senderJid, { text: '❗ Nama grup tidak boleh kosong.' }, { quoted: msg });
      return;
    }

    /* =========================================================
     * 6. BUAT GRUP
     * ========================================================= */
    const participants = [senderJid, ...uniqueNumbers];
    
    // Ensure valid JIDs
    const validParticipants = participants.filter(p => p.includes('@s.whatsapp.net'));
    
    if (validParticipants.length < 2) {
      await sock.sendMessage(senderJid, { text: '❗ Jumlah peserta minimal 2 orang.' }, { quoted: msg });
      return;
    }

    const group = await sock.groupCreate(groupName, validParticipants);

    await sock.groupParticipantsUpdate(group.id, [senderJid], 'promote');

    /* =========================================================
     * 7. INVITE LINK
     * ========================================================= */
    let invite = null;
    try {
      invite = await sock.groupInviteCode(group.id);
    } catch (_) {}

    const link = invite ? `https://chat.whatsapp.com/${invite}` : 'Link tidak tersedia';

    await sock.sendMessage(
      senderJid,
      {
        text: `✅ *Grup berhasil dibuat!*\n\n` + `📛 Nama: *${groupName}*\n` + `👥 Peserta: *${participants.length}*\n` + `🔗 Link: ${link}`,
      },
      { quoted: msg }
    );
  } catch (err) {
    console.error('createGroupWithFile error:', err);
    await sock.sendMessage(senderJid, { text: '❌ Terjadi kesalahan internal saat membuat grup.' }, { quoted: msg });
  }
}
