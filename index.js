const { DisconnectReason, makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { responAI } = require('./gpt');
const { fetchData } = require('./jadwalKelas');
const { tagAll } = require('./tagAllFunc');
const { addReminder } = require('./addReminder');
const { deleteReminder } = require('./deleteReminder');
const { listReminders } = require('./listReminder');
const { createGroupWithFile } = require('./createGroupWithFile');
const handleAddCommand = require('./addMember'); // Import modul handleAddCommand
const handleKickCommand = require('./kickMember');
const { getAllMember } = require('./getAllMember'); // Import modul getAllMember

// console.log(responAI);

async function connectToWhatsApp () {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    // const { version, isLatest } = await fetchLatestBaileysVersion();
    // console.log(`using WA v${version.join('.')}, isLatest: ${isLatest}`);
    const sock = makeWASocket({
      // can provide additional config here
      version: (
        await (
        await fetch(
        "https://raw.githubusercontent.com/WhiskeySockets/Baileys/master/src/Defaults/baileys-version.json"
        )
        ).json()
        ).version,
      printQRInTerminal: true,
      auth: state,
    });
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update
        if(connection === 'close') {
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut
            console.log('connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect)
            // reconnect if not logged out
            if(shouldReconnect) {
                connectToWhatsApp()
            }
        } else if(connection === 'open') {  
            console.log('opened connection')
        }
    })
    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('messages.upsert', async (m) => {
  // Biar tidak spam kita kasih pengecualian
  if (m.messages[0].key.fromMe) return; // Return ini adalah fungsi penolakan

  console.log(m.messages[0].pushName);
  
  try {
    const pushName = m.messages[0].pushName;
    // Cek apakah pesan berasal dari grup atau chat pribadi
    const numberUser = m.messages[0].key.participant
      ? m.messages[0].key.participant // Jika berasal dari grup
      : m.messages[0].key.remoteJid; // Jika berasal dari chat pribadi
    console.log(numberUser);

    const message = m.messages[0].message;
    const messageArr = m.messages[0];

    // console.log(`MEssage nya adalah: ` + message);
    // console.log(`Message nya adalah: ${JSON.stringify(message)}`);

    // Menentukan pesan yang diterima berdasarkan tipe
    // let chatMessage;
    //  const chatMessage = m.messages[0].message.conversation ?? m.messages[0].message.extendedTextMessage?.text;

    let chatMessage;

    switch (true) {
      case !!message.conversation:
        chatMessage = message.conversation; // Jika pesan berupa teks biasa
        break;

      case !!(message.extendedTextMessage && message.extendedTextMessage.text):
        chatMessage = message.extendedTextMessage.text; // Jika pesan berupa extendedTextMessage
        break;

      case !!(message.imageMessage && message.imageMessage.caption):
        chatMessage = message.imageMessage.caption; // Jika pesan adalah gambar dengan keterangan
        break;

      case !!(message.videoMessage && message.videoMessage.caption):
        chatMessage = message.videoMessage.caption; // Jika pesan adalah video dengan keterangan
        break;
        
      // default:
      //   // Jika tipe pesan tidak diketahui, atau belum di-handle
      //   chatMessage = 'Maaf, saya belum bisa memahami tipe pesan ini.';
      //   await sock.sendMessage(
      //     remoteJid, // ID pengguna yang mengirim pesan
      //     { text: chatMessage }, // Balasan yang dikirimkan
      //     { quoted: m.messages[0] } // Mengutip pesan pengguna
      //   );
      //   break;
    }

    console.log(`Pesan yang diterima di try-catch dari ${m.messages[0].key.remoteJid.replace('@s.whatsapp.net', '')}: ${chatMessage}`);

    const sessionID = m.messages[0].key.remoteJid; // Session ID bisa disesuaikan sesuai kebutuhan
    const remoteJid = m.messages[0].key.remoteJid; // Pengguna yang mengirim pesan
    // console.log(m.messages[0].message);

    // Handle semua perintah

    // Handle perintah /menu
    if (chatMessage.startsWith('/menu') && remoteJid.endsWith('@g.us')) {
      await sock.sendMessage(
        remoteJid,
        {
          text: `Halo *@${numberUser.replace('@s.whatsapp.net', '')} (${pushName})*, menu saat ini adalah:
/ai [Pesan] - Untuk chat dengan AI
/jadwal - Melihat Jadwal Mingguan yang berada di EdLink
/list - Melihat semua list yang telah berada di auto reminder
/addList "Nama Mata Kuliah" <Zoom Link> <Jam> <Hari> - Untuk menambahkan jadwal ke database
/delete - Untuk menghapus reminder
/add - Untuk add member di dalam grup
/tagall - Tag Semua orang ( Khusus Grup! )
/kick - Untuk kick member di dalam grup
/new "Nama Grup" - Untuk membuat grup baru dengan file txt yang berisi nomor telepon
/getAllMember - Untuk mendapatkan semua anggota grup dan mengirimkannya sebagai file txt`,
          mentions: [numberUser],
        },
        { quoted: m.messages[0] }
      );
    }

    if (chatMessage.startsWith('/menu') && !remoteJid.endsWith('@g.us')) {
      await sock.sendMessage(
        remoteJid,
        {
          text: `Halo *${pushName}*, menu saat ini adalah:
/jadwal - Melihat Jadwal Mingguan yang berada di EdLink
/list - Melihat semua list yang telah berada di auto reminder
/addList "Nama Mata Kuliah" <Zoom Link> <Jam> <Hari> - Untuk menambahkan jadwal ke database
/delete - Untuk menghapus reminder
/add - Untuk add member di dalam grup
/tagall - Tag Semua orang ( Khusus Grup! )
/kick - Untuk kick member di dalam grup
/new "Nama Grup" - Untuk membuat grup baru dengan file txt yang berisi nomor telepon
/getAllMember - Untuk mendapatkan semua anggota grup dan mengirimkannya sebagai file txt`,
        },
        { quoted: m.messages[0] }
      );
    }

    // Handle perintah /jadwal
    if (chatMessage.startsWith('/jadwal')) {
      const jadwalKelas = await fetchData();
      await sock.sendMessage(
        remoteJid, // ID pengguna yang mengirim pesan
        { text: jadwalKelas }, // Balasan yang dikirimkan oleh AI
        { quoted: m.messages[0] } // Mengutip pesan pengguna
      );
    }

    // untuk chat AI melalui chat pribadi
    // memastikan pesan yang masuk bukan berasal dari grup, agar menghindari spam
    // if (!remoteJid.endsWith('@g.us') && remoteJid != 'status@broadcast') {
    //   // Jika bukan perintah /tagall, jalankan respon AI atau perintah lain
    //   const jawabanAI = await responAI(chatMessage, sessionID);
    //   await sock.sendPresenceUpdate('available', remoteJid);
    //   await sock.sendMessage(
    //     remoteJid, // ID pengguna yang mengirim pesan
    //     { text: jawabanAI }, // Balasan yang dikirimkan oleh AI
    //     { quoted: m.messages[0] } // Mengutip pesan pengguna
    //   );
    //   console.log(`Balasan AI yang berisi pesan "${chatMessage}" untuk ${remoteJid.replace('@s.whatsapp.net', '')} berhasil dikirim: ${jawabanAI}\n\n`);
    //   // untuk chat dengan AI di grup dengan awalan /ai
    // }
    if (remoteJid.endsWith('@g.us') && chatMessage.startsWith('/ai')) {
      // Menghapus "/ai " (perintah dan satu spasi setelahnya) dan mengambil sisa pesan
      const messageUser = chatMessage.slice(4).trim(); // trim() untuk menghapus spasi tambahan di depan/akhir teks
      console.log(messageUser);

      const jawabanAI = await responAI(messageUser, sessionID);
      await sock.sendPresenceUpdate('available', remoteJid);
      await sock.sendMessage(
        remoteJid, // ID pengguna yang mengirim pesan
        { text: jawabanAI }, // Balasan yang dikirimkan oleh AI
        { quoted: m.messages[0] } // Mengutip pesan pengguna
      );
      console.log(`Balasan AI yang berisi pesan "${messageUser}" untuk ${remoteJid.replace('@g.us', '')} berhasil dikirim: ${jawabanAI}\n\n`);
    }

    // Handle perintah /list
    if (chatMessage.startsWith('/list')) {
      const listJadwal = await listReminders(numberUser);
      console.log(`remoteJID dari grup:` + numberUser);

      await sock.sendMessage(remoteJid, { text: listJadwal }, { quoted: m.messages[0] });
    }

    if (chatMessage.startsWith('/new')) {
      await createGroupWithFile(sock, messageArr, chatMessage, numberUser);
    }

    if (chatMessage.startsWith('/getAllMember')) {
      // Mengambil semua anggota grup
      const groupJid = remoteJid.endsWith('@g.us') ? remoteJid : null;
      if (!groupJid) {
        await sock.sendMessage(remoteJid, { text: 'Perintah ini hanya bisa digunakan di grup.' });
        return;
      }
      await getAllMember(sock, messageArr, groupJid); // Sertakan groupJid dalam pemanggilan fungsi
      return;
    }

    // Handle perintah /add
    if (chatMessage.startsWith('/add')) {
      const groupJid = remoteJid.endsWith('@g.us') ? remoteJid : null;

      if (!groupJid) {
        await sock.sendMessage(remoteJid, { text: 'Perintah ini hanya bisa digunakan di grup.' });
        return;
      }

      await handleAddCommand(sock, m, groupJid); // Sertakan groupJid dalam pemanggilan fungsi
      return;
    }

    // Handle perintah /kick
    if (chatMessage.startsWith('/kick') || message.extendedTextMessage?.text == '/kick') {
      // const numberKick = message.extendedTextMessage.contextInfo.participant;
      // await sock.sendMessage(remoteJid, { text: `testing Kick dengan Nomor calon kick: ${numberKick}` });

      const groupJid = remoteJid.endsWith('@g.us') ? remoteJid : null;
      if (!groupJid) {
        await sock.sendMessage(remoteJid, { text: 'Perintah ini hanya bisa digunakan di grup.' });
      }

      await handleKickCommand(sock, m, groupJid); // Sertakan groupJid dalam pemanggilan fungsi
    }
    
    // Handle perintah /add
    // Mengganti case '/add' dengan pengecekan startsWith
    if (chatMessage.startsWith('/addList')) {
      // Memecah pesan untuk mendapatkan parameter jadwal
      const regex = /\/add\s+"([^"]+)"\s+(https:\/\/[^\s]+)\s+([0-9]{2}[.:][0-9]{2})\s+(.+)/;
      const perintah = chatMessage.split(' ')[1];
      const match = chatMessage.match(regex);

      if (match) {
        const courseName = match[1];
        const zoomLink = match[2];
        const reminderTime = match[3];
        const days = match[4]; // Diterima dalam format bahasa Indonesia, misal "Senin"

        try {
          // Menambahkan jadwal ke database
          await addReminder(courseName, zoomLink, reminderTime, days, numberUser);

          await sock.sendMessage(remoteJid, {
            text: `Jadwal berhasil ditambahkan:\nMata Kuliah: ${courseName}\nLink: ${zoomLink}\nJam: ${reminderTime}\nHari: ${days}`,
            quoted: m.messages[0],
          });
        } catch (error) {
          console.error('Error menambahkan jadwal:', error);
          await sock.sendMessage(remoteJid, { text: 'Terjadi kesalahan saat menambahkan jadwal.' }, { quoted: m.messages[0] });
        }
      } else if (perintah === '/addList') {
        await sock.sendMessage(remoteJid, { text: 'Format salah! Gunakan: /add "Mata Kuliah" <Zoom Link> <Jam> <Hari>' }, { quoted: m.messages[0] });
      } else {
        await sock.sendMessage(remoteJid, { text: 'Format salah! Gunakan: /add "Mata Kuliah" <Zoom Link> <Jam> <Hari>' }, { quoted: m.messages[0] });
      }
    }

    // Jika pesan dimulai dengan "/delete"
    if (chatMessage.startsWith('/delete')) {
      const id = chatMessage.split(' ')[1]; // Mendapatkan ID dari perintah

      if (!id) {
        await sock.sendMessage(remoteJid, { text: 'Mohon sertakan ID jadwal yang ingin dihapus, misalnya: /delete 1' });
        return;
      }

      try {
        // Panggil fungsi untuk menghapus jadwal
        const result = await deleteReminder(id, numberUser);

        // Kirimkan respons setelah menghapus jadwal
        await sock.sendMessage(remoteJid, { text: result });

        // mengirimkan kembali semua list jadwal
        const listJadwal = await listReminders(numberUser);
        await sock.sendMessage(remoteJid, { text: listJadwal }, { quoted: m.messages[0] });
      } catch (error) {
        console.error('Error deleting reminder:', error);
        await sock.sendMessage(remoteJid, { text: 'Terjadi kesalahan saat menghapus jadwal. Coba lagi nanti.' });
      }
    }

    // Mengganti case '/tagall' dengan pengecekan startsWith
    if (chatMessage.startsWith('/tagall')) {
      await tagAll(sock, remoteJid, chatMessage);
    }
  } catch (error) { console.error('Error handling incoming message:', error);}
    });
    
}
// run in main file
connectToWhatsApp()