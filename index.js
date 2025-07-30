
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const fetch = require('node-fetch');
const readline = require('readline');
const { responAI } = require('./gpt');
const { fetchData } = require('./jadwalKelas');
const { tagAll } = require('./tagAllFunc');
const { addReminder } = require('./addReminder');
const { deleteReminder } = require('./deleteReminder');
const { listReminders } = require('./listReminder');
const { createGroupWithFile } = require('./createGroupWithFile');
const handleAddCommand = require('./addMember');
const handleKickCommand = require('./kickMember');
const { getAllMember } = require('./getAllMember');
const leaderboardDB = require('./db/leaderboard');
const gameHandlers = require('./games/gameHandlers');
const WebSocket = require('ws');
const { getRandomWord } = require('./gameWords');

let sock;
const activeGuess = new Map();      // userJid → { word }
const userScores = {};              // userJid → skor
const gameSessions = new Map(); // userJid → { game, jawaban, soal }
const gameScores = {};          // userJid → { name, score }

let pairingRequested = false;
let phoneNumber = '6281934179820';

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  sock = makeWASocket({
    printQRInTerminal: false,
    auth: state,
  });

  // sock = makeWASocket({
  //   version: {
  //     version: [2, 3000, 1023223821],
  //   },
  //   printQRInTerminal: false,
  //   auth: state,
  // });

  pairingRequested = false;

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    console.log('📶 Status koneksi:', connection);
    if (lastDisconnect?.error) {
      console.error('🔴 Error:', lastDisconnect.error?.output?.payload?.message || lastDisconnect.error.message);
    }

    if (!pairingRequested && connection === 'connecting') {
      // jangan jalankan kalau sudah login
      if (state?.creds?.registered) {
        pairingRequested = true;
        return;
      }

      pairingRequested = true;
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(phoneNumber);
          console.log('🔢 Pairing Code:', code);
          console.log('📱 Buka WhatsApp > Perangkat Tertaut > Masukkan Kode');
        } catch (err) {
          console.error('❌ Gagal pairing:', err);
        }
      }, 2000);
    }
    
    if (connection === 'open') {
      console.log('✅ Terhubung ke WhatsApp!');
      pairingRequested = true; // tidak perlu pairing lagi
    }

    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log('❌ Koneksi tertutup. Alasan:', reason);

        if (reason !== DisconnectReason.loggedOut) {
          console.log('🔁 Mencoba reconnect dalam 5 detik...');
          setTimeout(() => {
            connectToWhatsApp(phoneNumber);
          }, 5000);
        } else {
          console.log('🔒 Telah logout dari WhatsApp. Harap login ulang secara manual.');
        }

      if (reason === 515) {
        console.log('🔁 Restart otomatis setelah pairing...');
        pairingRequested = true;

        // Tunggu 5 detik agar server WhatsApp siap menerima koneksi baru
        setTimeout(() => {
          if (sock?.ws?.readyState === 1) sock.ws.close();
          connectToWhatsApp(phoneNumber);
        }, 5000);
      }
      
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    if (m.messages[0].key.fromMe) return;
    try {
      const pushName = m.messages[0].pushName;
      const numberUser = m.messages[0].key.participant
      const message = m.messages[0].message;
      const msg = m.messages[0];
      const messageArr = m.messages[0];
      const remoteJid = m.messages[0].key.remoteJid;
      const isGroup = remoteJid.endsWith('@g.us');
      const sessionKey = isGroup ? remoteJid : numberUser;

      let chatMessage;

      switch (true) {
        case !!message.conversation:
          chatMessage = message.conversation;
          break;
        case !!(message.extendedTextMessage && message.extendedTextMessage.text):
          chatMessage = message.extendedTextMessage.text;
          break;
        case !!(message.imageMessage && message.imageMessage.caption):
          chatMessage = message.imageMessage.caption;
          break;
        case !!(message.videoMessage && message.videoMessage.caption):
          chatMessage = message.videoMessage.caption;
          break;
      }

      if (!chatMessage) return;

      const sessionID = remoteJid;

      if (chatMessage.startsWith('/menu')) {
        console.log(`Isi dari NumberUser: ${numberUser}\n\nIsi dari remoteJid: ${remoteJid}\n\nIsi dari pushName: ${pushName}\n\nIsi dari chatMessage: ${msg}`);
        
        const text = remoteJid.endsWith('@g.us')
          ? `Halo *@${numberUser.replace('@lid', '')} (${pushName})*, menu saat ini adalah:
/ai [Pesan] - Untuk chat dengan AI
/jadwal - Melihat Jadwal Mingguan yang berada di EdLink
/list - Melihat semua list yang telah berada di auto reminder
/addList "Nama Mata Kuliah" <Zoom Link> <Jam> <Hari> - Untuk menambahkan jadwal ke database
/delete - Untuk menghapus reminder
/add - Untuk add member di dalam grup
/tagall - Tag Semua orang ( Khusus Grup! )
/kick - Untuk kick member di dalam grup
/new "Nama Grup" - Untuk membuat grup baru dengan file txt yang berisi nomor telepon
/getAllMember - Untuk mendapatkan semua anggota grup dan mengirimkannya sebagai file txt
/asahotak - Untuk bermain asah otak
/caklontong - Untuk bermain cak lontong
/family100 - Untuk bermain family 100
/siapakahaku - Untuk bermain siapakah aku
/susunkata - Untuk bermain susun kata
/tebakbendera - Untuk bermain tebak bendera
/tebakbendera2 - Untuk bermain tebak bendera 2
/tebakgambar - Untuk bermain tebak gambar
/tebakkabupaten - Untuk bermain tebak kabupaten <Error!>
/tebakkalimat - Untuk bermain tebak kalimat
/leaderboard - Untuk melihat leaderboard
/exit - Untuk keluar dari mode tebak kata`
          : `Halo *${pushName}*, menu saat ini adalah:
/jadwal - Melihat Jadwal Mingguan yang berada di EdLink
/list - Melihat semua list yang telah berada di auto reminder
/addList "Nama Mata Kuliah" <Zoom Link> <Jam> <Hari> - Untuk menambahkan jadwal ke database
/delete - Untuk menghapus reminder
/add - Untuk add member di dalam grup
/tagall - Tag Semua orang ( Khusus Grup! )
/kick - Untuk kick member di dalam grup
/new "Nama Grup" - Untuk membuat grup baru dengan file txt yang berisi nomor telepon
/getAllMember - Untuk mendapatkan semua anggota grup dan mengirimkannya sebagai file txt
/asahotak - Untuk bermain asah otak
/caklontong - Untuk bermain cak lontong
/family100 - Untuk bermain family 100
/siapakahaku - Untuk bermain siapakah aku
/susunkata - Untuk bermain susun kata
/tebakbendera - Untuk bermain tebak bendera
/tebakbendera2 - Untuk bermain tebak bendera 2
/tebakgambar - Untuk bermain tebak gambar
/tebakkabupaten - Untuk bermain tebak kabupaten <Error!>
/tebakkalimat - Untuk bermain tebak kalimat
/leaderboard - Untuk melihat leaderboard
/exit - Untuk keluar dari mode tebak kata`;
        await sock.sendMessage(remoteJid, { text, mentions: [numberUser] }, { quoted: m.messages[0] });
      }

      if (chatMessage.startsWith('/jadwal')) {
        const jadwalKelas = await fetchData();
        await sock.sendMessage(remoteJid, { text: jadwalKelas }, { quoted: m.messages[0] });
      }

      if (remoteJid.endsWith('@g.us') && chatMessage.startsWith('/ai')) {
        const messageUser = chatMessage.slice(4).trim();
        const jawabanAI = await responAI(messageUser, sessionID);
        await sock.sendMessage(remoteJid, { text: jawabanAI }, { quoted: m.messages[0] });
      }

      if (chatMessage.startsWith('/list')) {
        const listJadwal = await listReminders(numberUser);
        await sock.sendMessage(remoteJid, { text: listJadwal }, { quoted: m.messages[0] });
      }

      if (chatMessage.startsWith('/new')) {
        await createGroupWithFile(sock, messageArr, chatMessage, numberUser);
      }

      if (chatMessage.startsWith('/getAllMember')) {
        const groupJid = remoteJid.endsWith('@g.us') ? remoteJid : null;
        if (!groupJid) {
          await sock.sendMessage(remoteJid, { text: 'Perintah ini hanya bisa digunakan di grup.' }, { quoted: m.messages[0] });
          return;
        }
        await getAllMember(sock, messageArr, groupJid);
        return;
      }

      if (/^\/addList\b/.test(chatMessage)) {
        const regex = /\/addList\s+"([^"]+)"\s+(https:\/\/[^\s]+)\s+([0-9]{2}[.:][0-9]{2})\s+(.+)/;
        const match = chatMessage.match(regex);
        if (match) {
          const [_, courseName, zoomLink, reminderTime, days] = match;
          await addReminder(courseName, zoomLink, reminderTime, days, numberUser);
          await sock.sendMessage(remoteJid, {
            text: `Jadwal berhasil ditambahkan:\nMata Kuliah: ${courseName}\nLink: ${zoomLink}\nJam: ${reminderTime}\nHari: ${days}`},
            { quoted: m.messages[0] }
          );
        } else {
          await sock.sendMessage(remoteJid, { text: 'Format salah! Gunakan: /addList "Mata Kuliah" <Zoom Link> <Jam> <Hari>' }, { quoted: m.messages[0] });
        }
      }

      if (/^\/add\b/.test(chatMessage)) {
        const groupJid = remoteJid.endsWith('@g.us') ? remoteJid : null;
        if (!groupJid) {
          await sock.sendMessage(remoteJid, { text: 'Perintah ini hanya bisa digunakan di grup.' }, { quoted: m.messages[0] });
          return;
        }
        await handleAddCommand(sock, m, groupJid);
        return;
      }

      if (chatMessage.startsWith('/kick') || message.extendedTextMessage?.text === '/kick') {
        const groupJid = remoteJid.endsWith('@g.us') ? remoteJid : null;
        await handleKickCommand(sock, m, groupJid);
      }

      if (chatMessage.startsWith('/delete')) {
        const id = chatMessage.split(' ')[1];
        if (!id) {
          await sock.sendMessage(remoteJid, { text: 'Mohon sertakan ID jadwal yang ingin dihapus.' }, { quoted: m.messages[0] });
          return;
        }
        const result = await deleteReminder(id, numberUser);
        await sock.sendMessage(remoteJid, { text: result });
        const listJadwal = await listReminders(numberUser);
        await sock.sendMessage(remoteJid, { text: listJadwal }, { quoted: m.messages[0] });
      }

      if (chatMessage.startsWith('/tagall')) {
        await tagAll(sock, remoteJid, chatMessage);
      }

      // === HANDLE /exit ===
      if (chatMessage === '/exit') {
        if (gameSessions.has(sessionKey)) {
          gameSessions.delete(sessionKey);
          await sock.sendMessage(remoteJid, {
            text: '🚪 Permainan telah dihentikan.' },
            { quoted: msg }
          );
        } else {
          await sock.sendMessage(remoteJid, {
            text: '❌ Tidak ada permainan aktif saat ini.' },
            { quoted: msg }
          );
        }
        return;
      }

      if (chatMessage === '/skip') {
        if (!gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, { text: '⚠️ Tidak ada game aktif untuk dilewati.' }, { quoted: msg });
          return;
        }

        const session = gameSessions.get(sessionKey);
        const nextSoal = gameHandlers[session.game].getRandom();

        gameSessions.set(sessionKey, {
          game: session.game,
          jawaban: nextSoal.jawaban.toLowerCase(),
          soal: nextSoal,
        });

        await sock.sendMessage(remoteJid, {
          text: '⏭️ Soal dilewati. Berikut soal selanjutnya:' },
          { quoted: msg }
        );

        // Kirim soal baru sesuai jenisnya
        if (nextSoal.soal && !nextSoal.img) {
          await sock.sendMessage(remoteJid, {
            text: `🧠 ${nextSoal.soal}` },
            { quoted: msg }
          );
        } else if (session.game === 'tebakgambar' && nextSoal.img) {
          await sock.sendMessage(remoteJid, {
            image: { url: nextSoal.img },
            caption: `🖼️ *Clue:*\n${nextSoal.deskripsi || 'Tidak ada'}` },
            { quoted: msg }
          );
        } else if (nextSoal.img) {
          await sock.sendMessage(remoteJid, {
            image: { url: nextSoal.img },
            caption: '🖼️ Soal Berikutnya!' } ,
            { quoted: msg }
          );
        }

        return;
      }


      if (gameSessions.has(sessionKey) && !chatMessage.startsWith('/')) {
        const session = gameSessions.get(sessionKey);
        const jawabanUser = chatMessage.toLowerCase();

        // FAMILY100
        if (session.game === 'family100') {
          const isValid = gameHandlers.family100.isCorrectAnswer(session, chatMessage);
          if (isValid) {
            gameHandlers.family100.markAnswer(session, chatMessage);
            await leaderboardDB.addScore(remoteJid, numberUser, pushName, 10);


            const sisa = session.jawaban.length - session.terjawab.length;

            if (gameHandlers.family100.isComplete(session)) {
              const next = gameHandlers.family100.getRandom();
              gameSessions.set(sessionKey, {
                game: 'family100',
                soal: next.soal,
                jawaban: next.jawaban,
                terjawab: [],
              });

              await sock.sendMessage(remoteJid, {
                text: `✅ Semua jawaban benar!` },
                { quoted: msg }
              );

              await sock.sendMessage(remoteJid, {
                text: `💯 *FAMILY 100*\n${next.soal}` },
                { quoted: msg }
              );
            } else {
              await sock.sendMessage(remoteJid, {
                text: `✅ Benar! Masih ${sisa} jawaban lagi.` },
                { quoted: msg }
              );
            }
          } else {
            await sock.sendMessage(remoteJid, {
              text: `❌ Salah atau sudah dijawab.` },
              { quoted: msg }
            );
          }
          return;
        }

        // GAME BIASA
        const jawabanBenar = session.jawaban.toLowerCase();
        if (jawabanUser === jawabanBenar) {
          await leaderboardDB.addScore(remoteJid, numberUser, pushName, 10);

          const nextSoal = gameHandlers[session.game].getRandom();
          gameSessions.set(sessionKey, {
            game: session.game,
            jawaban: nextSoal.jawaban.toLowerCase(),
            soal: nextSoal,
          });

          const deskripsi = session.soal?.deskripsi && ['caklontong', 'tebakgambar'].includes(session.game) ? `\n📝 *Penjelasan:* ${session.soal.deskripsi}` : '';

          // 1. Kirim feedback jawaban benar dulu
          await sock.sendMessage(remoteJid, {
            text: `✅ Benar! Point +10\n\n${deskripsi}` },
            { quoted: msg }
          );

          await new Promise(resolve => setTimeout(resolve, 800)); // Delay sebelum soal baru
          
          // 2. Kirim soal berikutnya (bentuk tergantung jenis game)
          if (nextSoal.soal && !nextSoal.img) {
            await sock.sendMessage(remoteJid, {
              text: `🧠 *Soal Berikutnya:*\n${nextSoal.soal}` },
              { quoted: msg }
            );
          } else if (session.game === 'tebakgambar' && nextSoal.img) {
            await sock.sendMessage(remoteJid, {
              image: { url: nextSoal.img },
              caption: `🖼️ *Soal Berikutnya!*\n\n🧠 Clue: ${nextSoal.deskripsi || 'Tidak ada'}`,
              quoted: msg
            });
          } else if (nextSoal.img) {
            await sock.sendMessage(remoteJid, {
              image: { url: nextSoal.img },
              caption: `🖼️ *Soal Berikutnya!*`,
              quoted: msg
            });
          }

          return;
        }

        // Jawaban salah
        await sock.sendMessage(remoteJid, {
          text: `❌ Salah. Coba lagi atau ketik /exit untuk keluar.` },
          { quoted: msg }
        );

        // Kirim ulang soal aktif
        const game = session.game;
        const soalAktif = session.soal;

        if (soalAktif.soal && !soalAktif.img) {
          // Soal berbentuk teks
          await sock.sendMessage(remoteJid, {
            text: `🔁 *Soal Ulang:*\n${soalAktif.soal}` } ,
            {quoted: msg}
          );
        } else if (game === 'tebakgambar' && soalAktif.img) {
          await new Promise((resolve) => setTimeout(resolve, 800)); // Delay 800ms
          // Gambar dengan clue
          await sock.sendMessage(remoteJid, {
            image: { url: soalAktif.img },
            caption: `🖼️ *Clue Ulang!*\n\n🧠 ${soalAktif.deskripsi || 'Tidak ada'}`,
            quoted: msg,
          });
        } else if (soalAktif.img) {
          // Gambar tanpa clue (misal tebakbendera)
          await new Promise((resolve) => setTimeout(resolve, 800)); // Delay 800ms
          await sock.sendMessage(remoteJid, {
            image: { url: soalAktif.img },
            caption: `🖼️ *Soal Ulang!*`,
            quoted: msg,
          });
        }

        return;
      }


      if (chatMessage === '/leaderboard') {
        const topUsers = await leaderboardDB.getTopUsers(remoteJid);
        if (topUsers.length === 0) {
          await sock.sendMessage(remoteJid, {
            text: '📊 Belum ada pemain di leaderboard untuk chat ini.'},
            {quoted: msg}
          );
          return;
        }

        let msgSend = '🏆 *Leaderboard Top 5:*\n';
        topUsers.forEach((user, i) => {
          msgSend += `${i + 1}. ${user.name} - ${user.score} poin\n`;
        });
        await sock.sendMessage(remoteJid, { text: msgSend}, { quoted: msg });
        return;
      }

      if (chatMessage === '/asahotak') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, {
            text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.' },
            {quoted: msg}
          );
          return;
        }
        // Mulai permainan Asah Otak
        const soal = gameHandlers.asahotak.getRandom();
        gameSessions.set(sessionKey, {
          game: 'asahotak',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });
        await sock.sendMessage(remoteJid, {
          text: `🧠 *ASAH OTAK*\n${soal.soal}`},
          {quoted: msg}
        );
        return;
      }

      if (chatMessage === '/caklontong') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, {
            text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.'},
            {quoted: msg}
          );
          return;
        }

        // Mulai permainan Cak Lontong
        const soal = gameHandlers.caklontong.getRandom();
        gameSessions.set(sessionKey, {
          game: 'caklontong',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });
        await sock.sendMessage(remoteJid, {
          text: `🤣 *CAK LONTONG*\n${soal.soal}`},
          {quoted: msg}
        );
        return;
      }

      if (chatMessage === '/family100') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, {
            text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.' },
            {quoted: msg}
          );
          return;
        }
        // Mulai permainan Family 100
        const soal = gameHandlers.family100.getRandom();
        gameSessions.set(sessionKey, {
          game: 'family100',
          soal: soal.soal,
          jawaban: soal.jawaban,
          terjawab: [],
        });
        await sock.sendMessage(remoteJid, {
          text: `💯 *FAMILY 100*\n${soal.soal}\n\nTebak semua ${soal.jawaban.length} jawabannya!` },
          { quoted: msg }
        );
        return;
      }

      if (chatMessage === '/siapakahaku') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, {
            text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.'},
            {quoted: msg}
          );
          return;
        }
        // Mulai permainan Siapakah Aku
        const soal = gameHandlers.siapakahaku.getRandom();

        gameSessions.set(sessionKey, {
          game: 'siapakahaku',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `👤 *SIAPAKAH AKU*\n${soal.soal}`,
          },
          { quoted: msg }
        );

        return;
      }

      if (chatMessage === '/susunkata') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, {
            text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.'},
            {quoted: msg}
          );
          return;
        }

        // Mulai permainan Susun Kata
        const soal = gameHandlers.susunkata.getRandom();

        gameSessions.set(sessionKey, {
          game: 'susunkata',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(remoteJid, {
          text: `🔤 *SUSUN KATA*\n${soal.soal}\n*Kategori:* ${soal.tipe}`},
          {quoted: msg}
        );

        return;
      }

      if (chatMessage === '/tebakbendera') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, {
            text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.'},
            {quoted: msg}
          );
          return;
        }

        const soal = gameHandlers.tebakbendera.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakbendera',
          jawaban: soal.name.toLowerCase(),
          soal,
        });

        await sock.sendMessage(remoteJid, {
          image: { url: soal.img },
          caption: `🚩 *TEBAK BENDERA*\nNegara apakah ini?`},
          {quoted: msg}
        );

        return;
      }
      
      if (chatMessage === '/tebakbendera2') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, {
            text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.'},
            {quoted: msg}
          );
          return;
        }

        const soal = gameHandlers.tebakbendera2.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakbendera2',
          jawaban: soal.name.toLowerCase(),
          soal,
        });

        await sock.sendMessage(remoteJid, {
          image: { url: soal.img },
          caption: `🚩 *TEBAK BENDERA*\nNegara apakah ini?`},
          {quoted: msg}
        );

        return;
      }

      if (chatMessage === '/tebakgambar') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, {
            text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.'},
            {quoted: msg}
          );
          return;
        }

        const soal = gameHandlers.tebakgambar.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakgambar',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(remoteJid, {
          image: { url: soal.img },
          caption: `🖼️ *TEBAK GAMBAR*\nApa yang ada di gambar ini?\n\nClue: ${soal.deskripsi}`},
          {quoted: msg}
        );

        return;
      }

      if (chatMessage ===  '/tebakkabupaten') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, {
            text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.'},
            {quoted: msg}
          );
          return;
        }

        const soal = gameHandlers.tebakkabupaten.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakkabupaten',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(remoteJid, {
          image: { url: soal.img },
          caption: `🏙️ *TEBAK KABUPATEN*\nApa nama kabupaten ini?`},
          {quoted: msg}
        );

        return;
        
      }

      if (chatMessage.startsWith('/tebakkalimat')) {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, {
            text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.'},
            {quoted: msg}
          );
          return;
        }

        const soal = gameHandlers.tebakkalimat.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakkalimat',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(remoteJid, {
          text: `✍️ *TEBAK KALIMAT*\n${soal.soal}`},
          {quoted: msg}
        );

        return;
      }
      

    } catch (error) {
      console.error('Error handling incoming message:', error);
    }
  });
}


  connectToWhatsApp();
