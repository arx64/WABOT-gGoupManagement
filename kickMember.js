// Fungsi untuk memeriksa apakah pengguna adalah admin grup
function normalizeJid(jid) {
  return jid.replace(/:\d+/, ''); // hapus :6, :1, dll
}

export async function isAdmin(sock, participant, groupJid) {
  try {
    const groupMembers = await sock.groupMetadata(groupJid);

    const adminList = groupMembers.participants.filter((member) => member.admin === 'admin' || member.admin === 'superadmin').map((admin) => normalizeJid(admin.id));

    const normalizedParticipant = normalizeJid(participant);

    console.log(`adminList: ${adminList}`);
    console.log(`Participant to check: ${normalizedParticipant}`);

    return adminList.includes(normalizedParticipant);
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
