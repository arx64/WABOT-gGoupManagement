// Fungsi untuk memeriksa apakah pengguna adalah admin grup
import fs from 'fs';
import path from 'path';

function normalizeJid(jid) {
  return String(jid || '').replace(/:\d+/, ''); // hapus :6, :1, dll
}

function resolveLidToPhone(localId) {
  try {
    const base = path.resolve('auth_info_baileys');
    // try reverse mapping filename first
    const revPath = path.join(base, `lid-mapping-${localId}_reverse.json`);
    const altPath = path.join(base, `lid-mapping-${localId}.json`);
    let content = null;
    if (fs.existsSync(revPath)) content = fs.readFileSync(revPath, 'utf8');
    else if (fs.existsSync(altPath)) content = fs.readFileSync(altPath, 'utf8');
    if (!content) return null;
    // content often is a quoted string like "6281934179820"
    const cleaned = content.trim().replace(/^"|"$/g, '').trim();
    if (!cleaned) return null;
    // return full jid
    return `${cleaned}@s.whatsapp.net`;
  } catch (e) {
    return null;
  }
}

function resolvePhoneToLid(phoneLocal) {
  try {
    const base = path.resolve('auth_info_baileys');
    const mapPath = path.join(base, `lid-mapping-${phoneLocal}.json`);
    if (!fs.existsSync(mapPath)) return null;
    const content = fs.readFileSync(mapPath, 'utf8');
    const cleaned = content.trim().replace(/^"|"$/g, '').trim();
    if (!cleaned) return null;
    return `${cleaned}@lid`;
  } catch (e) {
    return null;
  }
}

export async function isAdmin(sock, participant, groupJid) {
  try {
    const groupMembers = await sock.groupMetadata(groupJid);

    // Build participants array and attempt robust matching.
    const participants = groupMembers.participants || [];

    // Normalize participant to lid format if possible
    let normalizedParticipant = normalizeJid(participant);
    if (normalizedParticipant.endsWith('@s.whatsapp.net')) {
      const phoneLocal = (normalizedParticipant.split('@')[0] || '').toLowerCase();
      const mappedLid = resolvePhoneToLid(phoneLocal);
      if (mappedLid) {
        normalizedParticipant = mappedLid;
        console.log(`Mapped participant ${phoneLocal} -> ${normalizedParticipant}`);
      }
    }

    const participantLocal = (normalizedParticipant.split('@')[0] || '').toLowerCase();

    // Collect admin entries and convert them to lid format when possible
    const adminEntries = participants.filter((member) => member.admin === 'admin' || member.admin === 'superadmin');
    const adminList = [];
    for (const a of adminEntries) {
      const raw = a.id;
      const n = normalizeJid(raw);
      // If admin is a phone JID, try to map to lid
      if (n.endsWith('@s.whatsapp.net')) {
        const phoneLocal = (n.split('@')[0] || '').toLowerCase();
        const mapped = resolvePhoneToLid(phoneLocal);
        if (mapped) {
          adminList.push(mapped);
          console.log(`Mapped admin ${n} -> ${mapped}`);
          continue;
        }
      }
      // If it's already a lid, keep normalized form
      if (n.endsWith('@lid')) {
        adminList.push(n);
        continue;
      }
      // fallback: store normalized raw
      adminList.push(n);
    }

    console.log('adminList (as lids where available):', adminList);
    console.log('Participant to check (normalized to lid if possible):', normalizedParticipant);

    // Direct match first
    if (adminList.includes(normalizedParticipant)) return true;

    // Fallback: match by local part (compare lid or phone numbers)
    for (const a of adminList) {
      const adminLocal = (a.split('@')[0] || '').toLowerCase();
      if (!adminLocal || !participantLocal) continue;
      if (adminLocal === participantLocal) return true;
      if (adminLocal.endsWith(participantLocal)) return true;
      if (participantLocal.endsWith(adminLocal)) return true;
      if (adminLocal.includes(participantLocal)) return true;
      if (participantLocal.includes(adminLocal)) return true;
    }

    return false;
  } catch (error) {
    console.error('Error saat memeriksa admin:', error);
    return false;
  }
}


// Fungsi utama untuk menambahkan anggota ke grup
export default async function handleAddCommand(sock, m, groupJid) {
    try {
      if (!groupJid) {
        await sock.sendMessage(m.messages[0].key.remoteJid, { text: 'Perintah ini hanya bisa digunakan di grup.' });
        return;
      }

      // Ambil nomor yang ingin ditambahkan
      const chatMessage = m.messages[0].message.conversation?.trim() ?? '';
      const commandParts = chatMessage.split(' ');
      const repliedParticipant = m.messages[0].message.extendedTextMessage?.contextInfo?.participant;

      let phoneToAdd;

      // Jika pengguna memasukkan nomor secara langsung
      if (commandParts.length >= 2 && /^\d+$/.test(commandParts[1])) {
        phoneToAdd = commandParts[1];
      }
      // Jika pengguna membalas pesan
      else if (repliedParticipant) {
        phoneToAdd = repliedParticipant.replace('@s.whatsapp.net', '');
      }
      // Jika input tidak valid
      else {
        await sock.sendMessage(groupJid, { text: 'Format salah! Gunakan: /addMember 628xxxx atau reply pesan user yang mau ditambahkan!' });
        return;
      }

      const userToAdd = `${phoneToAdd}@s.whatsapp.net`;

      // Cek apakah bot adalah admin
      // const userJid = sock.user.id.replace(':1', '');
      const userJid = sock.user.id.replace(/:\d+/, ''); // aman untuk semua suffix
      const isBotAdmin = await isAdmin(sock, userJid, groupJid);
      console.log(`Bot ID: ${userJid}, Is Bot Admin: ${isBotAdmin}`);

      if (!isBotAdmin) {
        console.log(`Bot ID di bagian isAdmin: ${userJid}`);
        await sock.sendMessage(groupJid, { text: 'Bot harus menjadi admin untuk menjalankan perintah ini.' });
        return;
      }

      // Cek apakah pengirim adalah admin
      const senderJid = m.messages[0].key.participant ?? m.messages[0].key.remoteJid;
      const isSenderAdmin = await isAdmin(sock, senderJid, groupJid);
      if (!isSenderAdmin) {
        await sock.sendMessage(groupJid, { text: 'Anda harus menjadi admin untuk menggunakan perintah ini.' });
        return;
      }

      // Tambahkan anggota ke grup
      try {
        await sock.groupParticipantsUpdate(groupJid, [userToAdd], 'add');
        await sock.sendMessage(groupJid, { text: `Nomor ${phoneToAdd} telah berhasil ditambahkan ke grup.` });
      } catch (error) {
        console.error('Error saat menambahkan anggota:', error);
        if (error.output?.statusCode === 403) {
          await sock.sendMessage(groupJid, { text: 'Gagal menambahkan anggota. Mungkin nomor tidak valid atau privasi pengguna terbatas.' });
        } else {
          await sock.sendMessage(groupJid, { text: 'Terjadi kesalahan saat menambahkan anggota.' });
        }
      }
    } catch (error) {
      console.error('Error handling add command:', error);
      await sock.sendMessage(m.messages[0].key.remoteJid, { text: 'Terjadi kesalahan saat memproses perintah.' });
    }
  }
