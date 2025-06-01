// Fungsi untuk memeriksa apakah pengguna adalah admin grup
async function isAdmin(sock, participant, groupJid) {
  try {
    const groupMembers = await sock.groupMetadata(groupJid);

    // Cetak data untuk debugging
    console.log(`groupMembers: ${JSON.stringify(groupMembers)}`);

    // Filter anggota grup yang memiliki properti "admin"
    const adminList = groupMembers.participants.filter((member) => member.admin === 'admin' || member.admin === 'superadmin').map((admin) => admin.id);

    // Cetak daftar admin untuk debugging
    // console.log(`adminList: ${adminList}`);
    // Cetak daftar admin untuk debugging
    console.log(`adminList: ${adminList}`);
    console.log(`Participant to check: ${participant}`);
    console.log(`Bot ID: ${sock.user.jid}`);

    // Periksa apakah ID pengguna ada dalam daftar admin
    return adminList.includes(participant);
  } catch (error) {
    console.error('Error saat memeriksa admin:', error);
    return false;
  }
}

// Fungsi utama untuk menambahkan anggota ke grup
// Fungsi utama untuk menambahkan anggota ke grup
async function handleAddCommand(sock, m, groupJid) {
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
      const userJid = sock.user.id.replace(':1', '');
      const isBotAdmin = await isAdmin(sock, userJid, groupJid);
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
  
// Export fungsi handleAddCommand
module.exports = handleAddCommand;