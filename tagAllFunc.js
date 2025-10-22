// Fungsi untuk tag all
export async function tagAll(sock, remoteJid, chatMessage) {
  try {
    // Mengambil metadata grup untuk mendapatkan daftar peserta
    const groupMetadata = await sock.groupMetadata(remoteJid);
    const participants = groupMetadata.participants;

    // Menghapus command /tagall dari pesan dan mengambil pesan yang dikirim user
    let tagMessage = chatMessage.replace('/tagall', '').trim();

    // Kirim pesan dan mention semua anggota
    await sock.sendMessage(remoteJid, {
      text: tagMessage || 'Halo semua!\nAda informasi baru nih, buka grup yaa!',
      mentions: participants.map((participant) => participant.id), // Mention semua anggota grup
    });

    console.log('Tag all berhasil dikirim');
  } catch (error) {
    console.error('Error saat tag all:', error);
  }
}

export default tagAll;
