// createGroupWithFile.js
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const fs = require('fs');
const path = require('path');

const createGroupWithFile = async (sock, message, groupNameRaw, senderJid) => {
  // try {
  console.log(`isi dari message: `, JSON.stringify(message));

  // Validasi input
  if (!message || !message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.documentWithCaptionMessage?.message?.documentMessage || !message.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
    console.error('❌ Message tidak valid:', message);
    await sock.sendMessage(senderJid, { text: '❗ Pastikan Anda membalas file .txt berisi nomor, lalu gunakan perintah:\n`/new "Nama Grup"`' });
    return;
  }

  // Ekstrak quoted message
  // const quoted = message.message.extendedTextMessage.contextInfo.quotedMessage ?? message.message.extendedTextMessage?.contextInfo?.quotedMessage?.documentWithCaptionMessage?.message?.documentMessage;
  // const quoted = message.message.extendedTextMessage.contextInfo.quotedMessage ?? message.message?.extendedTextMessage?.contextInfo?.quotedMessage?.documentWithCaptionMessage?.message?.documentMessage;
  const contextInfo = message.message?.extendedTextMessage?.contextInfo;
  const quotedMessage = contextInfo?.quotedMessage;

  let quoted = null;

  if (quotedMessage?.documentMessage) {
    quoted = quotedMessage;
  } else if (quotedMessage?.documentWithCaptionMessage?.message?.documentMessage) {
    quoted = quotedMessage.documentWithCaptionMessage.message;
  }

  // Cek apakah quoted message berisi file teks
  if (!quoted?.documentMessage || !quoted.documentMessage.mimetype.includes('text/plain')) {
    console.error('❌ Quoted message tidak valid:', quoted);
    await sock.sendMessage(senderJid, { text: `❗ Pastikan Anda membalas file .txt berisi nomor.` });
    return;
  }
  
  // if (!quoted || !quoted.documentMessage || !quoted.documentMessage.mimetype.includes('text/plain') || !quoted.documentWithCaptionMessage.message.documentMessage || !!quoted.documentWithCaptionMessage.message.documentMessage.mimetype.includes('text/plain')) {
  //   console.error('❌ Quoted message tidak valid:', quoted);
  //   await sock.sendMessage(senderJid, { text: `❗ Pastikan Anda membalas file .txt berisi nomor.\nError: ${qouted}` });
  //   return;
  // }

  // Download file
  // const buffer = await downloadMediaMessage(message, 'buffer', {}, { logger: console });
  const buffer = await downloadMediaMessage(
    {
      key: {
        ...(message.message.extendedTextMessage.contextInfo.stanzaId && {
          remoteJid: message.key.remoteJid,
          id: message.message.extendedTextMessage.contextInfo.stanzaId,
          fromMe: message.message.extendedTextMessage.contextInfo.participant === senderJid,
          participant: message.message.extendedTextMessage.contextInfo.participant,
        }),
      },
      message: quoted,
    },
    'buffer',
    {},
    { logger: console }
  );
  if (!buffer) {
    console.error('❌ Gagal mengunduh file.');
    await sock.sendMessage(senderJid, { text: '❗ Gagal mengunduh file. Pastikan file yang Anda kirim adalah file .txt.' });
    return;
  }

  // Simpan file sementara
  const tempPath = path.join(__dirname, 'temp.txt');
  fs.writeFileSync(tempPath, buffer);

  // Baca isi file
  const rawData = fs.readFileSync(tempPath, 'utf-8');
  if (!rawData.trim()) {
    console.error('❌ File kosong.');
    await sock.sendMessage(senderJid, { text: '❗ File yang Anda kirim kosong. Harap unggah file dengan daftar nomor telepon.' });
    fs.unlinkSync(tempPath); // Hapus file sementara
    return;
  }

  const lines = rawData
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  // Normalisasi nomor
  const participants = lines
    .map((num) => {
      let normalized = num.replace(/\D/g, '');
      if (normalized.startsWith('0')) normalized = '62' + normalized.slice(1);
      if (!normalized.startsWith('62')) return null;
      return normalized + '@s.whatsapp.net';
    })
    .filter(Boolean);

  if (!participants.length) {
    console.error('❌ Tidak ada nomor valid dalam file.');
    await sock.sendMessage(senderJid, { text: '❗ Tidak ada nomor telepon valid dalam file.' });
    fs.unlinkSync(tempPath); // Hapus file sementara
    return;
  }

  // Tambahkan pengirim sebagai peserta awal
  participants.unshift(senderJid);

  // Ambil nama grup dari command
  const groupName = groupNameRaw.replace(/^\/new\s+/i, '').replace(/^["']|["']$/g, '');
  if (!groupName.trim()) {
    console.error('❌ Nama grup kosong.');
    await sock.sendMessage(senderJid, { text: '❗ Nama grup tidak boleh kosong. Gunakan format:\n`/new "Nama Grup"`' });
    fs.unlinkSync(tempPath); // Hapus file sementara
    return;
  }

  // Buat grup baru
  const groupResult = await sock.groupCreate(groupName, participants);
  console.log(`✅ Grup berhasil dibuat: ${groupResult.id}`);
  console.log(`Info grup:`, groupResult);

  const groupId = groupResult.id;

  // Pastikan pengirim menjadi admin
  await sock.groupParticipantsUpdate(groupId, [senderJid], 'promote');

  // Hapus file temp
  fs.unlinkSync(tempPath);

  // Ambil invite code grup
  let inviteCode;
  try {
    inviteCode = await sock.groupInviteCode(groupId);
  } catch (e) {
    inviteCode = null;
  }

  // Kirim notifikasi sukses
  const link = inviteCode ? `https://chat.whatsapp.com/${inviteCode}` : 'Link undangan tidak tersedia.';
  await sock.sendMessage(senderJid, { text: `✅ Grup *${groupName}* berhasil dibuat!\nℹ️ *${groupResult.participants.length}* Peserta Berhasil Ditambahkan!\n📍 Link: ${link}` });
};
module.exports = { createGroupWithFile };
