import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function getAllMember(sock, message, senderJid) {
  try {
    // Ambil JID grup dari pesan
    const groupJid = message.key.remoteJid;
    if (!groupJid.endsWith('@g.us')) {
      await sock.sendMessage(senderJid, { text: '❗ Perintah ini hanya bisa digunakan di grup.' });
      return;
    }

    // Ambil info grup
    const groupMetadata = await sock.groupMetadata(groupJid);
    const members = groupMetadata.participants || [];
    const groupName = groupMetadata.subject || 'Grup Tanpa Nama';

    if (!members.length) {
      await sock.sendMessage(senderJid, { text: '❗ Tidak ada anggota grup yang ditemukan.' });
      return;
    }

    // Ambil semua nomor (tanpa @s.whatsapp.net)
    const numbers = members.map(m => m.phoneNumber.replace('@s.whatsapp.net', ''));

    // Simpan ke file txt
    const filePath = path.join(__dirname, 'all_members.txt');
    fs.writeFileSync(filePath, numbers.join('\n'));

    // Kirim file ke pengirim
    await sock.sendMessage(senderJid, {
      document: fs.readFileSync(filePath),
      fileName: `all_members of ${groupName}.txt`,
      mimetype: 'text/plain'
    });

    // Hapus file setelah dikirim
    fs.unlinkSync(filePath);
  } catch (err) {
    console.error('❌ Error getAllMember:', err);
    await sock.sendMessage(senderJid, { text: 'Terjadi kesalahan saat mengambil anggota grup.' });
  }
};
