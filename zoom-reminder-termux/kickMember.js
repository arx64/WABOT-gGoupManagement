// Fungsi untuk memeriksa apakah pengguna adalah admin grup
import fs from 'fs';
import path from 'path';

function normalizeJid(jid) {
  return String(jid || '').replace(/:\d+/, ''); // hapus :6, :1, dll
}

function resolvePhoneToLid(phoneLocal) {
  try {
    const base = path.resolve('auth_info_baileys');
    const mapPath = path.join(base, `lid-mapping-${phoneLocal}.json`);
    if (fs.existsSync(mapPath)) {
      const content = fs.readFileSync(mapPath, 'utf8');
      const cleaned = content.trim().replace(/^"|"$/g, '').trim();
      if (cleaned) return `${cleaned}@lid`;
    }
    // fallback: scan files for reverse mapping
    if (fs.existsSync(base)) {
      const files = fs.readdirSync(base).filter(f => f.startsWith('lid-mapping-') && f.endsWith('.json'));
      for (const f of files) {
        try {
          const content = fs.readFileSync(path.join(base, f), 'utf8').trim().replace(/^"|"$/g, '').trim();
          if (!content) continue;
          if (content === phoneLocal) {
            const m = f.match(/^lid-mapping-([0-9]+)(?:_reverse)?\.json$/);
            if (m) return `${m[1]}@lid`;
          }
        } catch (e) { /* ignore */ }
      }
    }
    return null;
  } catch (e) {
    return null;
  }
}

function resolveLidToPhone(localId) {
  try {
    const base = path.resolve('auth_info_baileys');
    const revPath = path.join(base, `lid-mapping-${localId}_reverse.json`);
    const altPath = path.join(base, `lid-mapping-${localId}.json`);
    let content = null;
    if (fs.existsSync(revPath)) content = fs.readFileSync(revPath, 'utf8');
    else if (fs.existsSync(altPath)) content = fs.readFileSync(altPath, 'utf8');
    if (!content) return null;
    const cleaned = content.trim().replace(/^"|"$/g, '').trim();
    if (!cleaned) return null;
    return `${cleaned}@s.whatsapp.net`;
  } catch (e) {
    return null;
  }
}

export async function isAdmin(sock, participant, groupJid) {
  try {
    const groupMembers = await sock.groupMetadata(groupJid);

    const participants = groupMembers.participants || [];

    // Normalize participant -> try to map phone JID to @lid for uniform comparison
    let normalizedParticipant = normalizeJid(participant);
    if (normalizedParticipant.endsWith('@s.whatsapp.net')) {
      const phoneLocal = (normalizedParticipant.split('@')[0] || '').toLowerCase();
      const mapped = resolvePhoneToLid(phoneLocal);
      if (mapped) {
        normalizedParticipant = mapped;
        console.log(`Mapped participant ${phoneLocal} -> ${normalizedParticipant}`);
      }
    }

    // Build admin list and prefer lid format when available
    const adminEntries = participants.filter((member) => member.admin === 'admin' || member.admin === 'superadmin');
    const adminList = [];
    for (const a of adminEntries) {
      const n = normalizeJid(a.id);
      if (n.endsWith('@s.whatsapp.net')) {
        const phoneLocal = (n.split('@')[0] || '').toLowerCase();
        const mapped = resolvePhoneToLid(phoneLocal);
        if (mapped) {
          adminList.push(mapped);
          console.log(`Mapped admin ${n} -> ${mapped}`);
          continue;
        }
      }
      adminList.push(n);
    }

    console.log('adminList (as lids where available):', adminList);
    console.log('Participant to check (normalized to lid if possible):', normalizedParticipant);

    // Direct match
    if (adminList.includes(normalizedParticipant)) return true;

    // If participant is lid, try resolving to phone and compare
    if (normalizedParticipant.endsWith('@lid')) {
      const resolvedPhone = resolveLidToPhone((normalizedParticipant.split('@')[0] || '').toLowerCase());
      if (resolvedPhone && adminList.includes(resolvedPhone)) return true;
    }

    // Fallback: compare local parts
    const participantLocal = (normalizedParticipant.split('@')[0] || '').toLowerCase();
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


// Fungsi utama untuk mengeluarkan anggota dari grup
export default async function handleKickCommand(sock, m, groupJid) {
  try {
    if (!groupJid) {
      await sock.sendMessage(m.messages[0].key.remoteJid, { text: 'Perintah ini hanya bisa digunakan di grup.' }, { quoted: m.messages[0] });
      return;
    }

    // Ambil nomor yang ingin dikeluarkan
    const chatMessage = m.messages[0].message.conversation?.trim() ?? '';
    const commandParts = chatMessage.split(' ');
    const numberReplyKick = m.messages[0].message.extendedTextMessage?.contextInfo?.participant;

    let phoneToKick;

    // Jika pengguna memasukkan nomor secara langsung
    if (commandParts.length >= 2 && /^\d+$/.test(commandParts[1])) {
      phoneToKick = commandParts[1];
    }
    // Jika pengguna membalas pesan
    else if (numberReplyKick) {
      phoneToKick = numberReplyKick.replace('@s.whatsapp.net', ''); // Hapus domain
    }
    // Jika input tidak valid
    else {
      await sock.sendMessage(groupJid, { text: 'Format salah! Gunakan: /kick 628xxxx atau reply pesan user yang mau di-kick!' });
      return;
    }

    const userToKick = `${phoneToKick}@s.whatsapp.net`;

    // Cek apakah bot adalah admin
    // const userJid = sock.user.id.replace(':1', '');
    const userJid = sock.user.id.replace(/:\d+/, ''); // aman untuk semua suffix
    const isBotAdmin = await isAdmin(sock, userJid, groupJid);
    if (!isBotAdmin) {
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

    // Coba keluarkan anggota dari grup
    try {
      await sock.groupParticipantsUpdate(groupJid, [userToKick], 'remove');
      await sock.sendMessage(groupJid, { text: `Nomor ${phoneToKick} telah berhasil dikeluarkan dari grup.` });
    } catch (error) {
      console.error('Error saat mengeluarkan anggota:', error);
      if (error.output?.statusCode === 403) {
        await sock.sendMessage(groupJid, { text: 'Gagal mengeluarkan anggota. Mungkin nomor tidak valid atau privasi pengguna terbatas.' });
      } else {
        await sock.sendMessage(groupJid, { text: 'Terjadi kesalahan saat mengeluarkan anggota.' });
      }
    }
  } catch (error) {
    console.error('Error handling kick command:', error);
    await sock.sendMessage(m.messages[0].key.remoteJid, { text: 'Terjadi kesalahan saat memproses perintah.' });
  }
}
