import 'dotenv/config';
import QRCode from 'qrcode';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { responAI } from './gpt.js';
import { fetchData } from './jadwalKelas.js';
import { tagAll } from './tagAllFunc.js';
import { addReminder } from './addReminder.js';
import { deleteReminder } from './deleteReminder.js';
import { listReminders } from './listReminder.js';
import { createGroupWithFile } from './createGroupWithFile.js';
import handleAddCommand from './addMember.js';
import handleKickCommand from './kickMember.js';
import { getAllMember } from './getAllMember.js';
import { addScore, getTopUsers } from './db/leaderboard.js';
import gameHandlers from './games/gameHandlers.js';
import { createNote, getNoteById, listNotes, deleteNote } from './notes.js';
import { startScheduler, stopScheduler } from './scheduler.js';
import { startEdlinkScheduler, stopEdlinkScheduler, fetchOpenAssignments } from './edlinkScheduler.js';
import uploadManager from './uploadManager.js';

let sock;
const activeGuess = new Map(); // userJid → { word }
const userScores = {}; // userJid → skor
const gameSessions = new Map(); // userJid → { game, jawaban, soal }
const gameScores = {}; // userJid → { name, score }

// persistent auth handled by useMultiFileAuthState; no manual pairing request

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

  sock = makeWASocket({
    auth: state,
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;

    console.log('📶 Status koneksi:', connection);

    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    if (update.qr) {
      console.log('🔳 QR code diterima — silakan scan dengan WhatsApp:');
      qrcode.generate(update.qr, { small: true });

      const qrPath = path.join(__dirname, 'qr_code.png');

      // generate PNG
      QRCode.toFile(
        qrPath,
        update.qr,
        {
          width: 600,
          margin: 2,
        },
        (err) => {
          if (err) return console.error('Gagal membuat QR Code:', err);

          console.log(`\n📁 QR Code telah dibuat di: ${qrPath}`);

          // Buka otomatis sesuai OS
          const openCmd = process.platform === 'win32' ? `start "" "${qrPath}"` : process.platform === 'darwin' ? `open "${qrPath}"` : `xdg-open "${qrPath}"`;

          exec(openCmd, (err) => {
            if (err) console.log('Tidak bisa membuka file QR secara otomatis');
          });
        }
      );
    }

    if (lastDisconnect?.error) {
      console.error('🔴 Error:', lastDisconnect.error?.output?.payload?.message || lastDisconnect.error.message);
    }
    if (connection === 'open') {
      console.log('✅ Terhubung ke WhatsApp!');
      // start scheduler when connection opens
      try {
        startScheduler(sock).catch((err) => console.error('startScheduler failed:', err));
        // start edlink scheduler if configured (EDLINK_BEARER and EDLINK_NOTIFY_JID)
        startEdlinkScheduler(sock).catch((err) => console.error('startEdlinkScheduler failed:', err));
      } catch (e) {
        console.error('Failed to start scheduler:', e);
      }
    }
    if (connection === 'close') {
      const reason = lastDisconnect?.error?.output?.statusCode;
      console.log('❌ Koneksi tertutup. Alasan:', reason);
      if (reason !== DisconnectReason.loggedOut) {
        console.log('🔁 Mencoba reconnect dalam 5 detik...');
        setTimeout(() => {
          connectToWhatsApp();
        }, 5000);
        // stop scheduler while disconnected
        try {
          stopScheduler();
        } catch (e) {
          /* ignore */
        }
        try {
          stopEdlinkScheduler();
        } catch (e) {
          /* ignore */
        }
      } else {
        console.log('🔒 Telah logout dari WhatsApp. Harap login ulang secara manual.');
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async (m) => {
    if (m.messages[0].key.fromMe) return;
    try {
      const pushName = m.messages[0].pushName;
      const numberUser = m.messages[0].key.participant || m.messages[0].key.remoteJid || m.messages[0].key.remoteJidAlt;

      const message = m.messages[0].message;
      const msg = m.messages[0];
      const messageArr = m.messages[0];
      const remoteJid = m.messages[0].key.remoteJid;
      const chatId = remoteJid.endsWith('@g.us') ? remoteJid : numberUser;
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

      // If upload session active for this user, let uploadManager handle incoming media
      try {
        const handled = await uploadManager.handleIncomingMessage(msg, sock, { chatId, numberUser, pushName });
        if (handled) return;
      } catch (e) {
        console.error('uploadManager error:', e);
      }

      if (!chatMessage) return;

      const sessionID = remoteJid;

      if (chatMessage.startsWith('/menu')) {
        console.log(`Isi dari NumberUser: ${numberUser}\n\nIsi dari remoteJid: ${remoteJid}\n\nIsi dari pushName: ${pushName}\n\nIsi dari chatMessage: ${msg}`);

        const groupMenu = `Halo *@${numberUser.split('@')[0]} (${pushName})*, menu saat ini adalah:
 /ai [Pesan] - Untuk  chat dengan AI
 /tugas - Cek tugas/quiz terbuka dari EdLink
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
 /siapakahaku - Untuk bermain siapa aku
 /susunkata - Untuk bermain susun kata
 /tebakbendera - Untuk bermain tebak bendera
 /tebakbendera2 - Untuk bermain tebak bendera 2
 /tebakgambar - Untuk bermain tebak gambar
 /tebakkabupaten - Untuk bermain tebak kabupaten <Error!>
 /tebakkalimat - Untuk bermain tebak kalimat
 /tebakkata - Untuk bermain tebak kata
 /tebakkimia - Untuk bermain tebak kimia
 /tebaklirik - Untuk bermain tebak lirik
 /tebaktebakan - Untuk bermain tebak tebakan
 /tekateki - Untuk bermain teka-teki
 /leaderboard - Untuk melihat leaderboard
 /exit - Untuk keluar dari mode tebak kata`;

        const privateMenu = `Halo *${pushName}*, menu saat ini adalah:
 /tugas - Cek tugas/quiz terbuka dari EdLink
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
 /siapakahaku - Untuk bermain siapa aku
 /susunkata - Untuk bermain susun kata
 /tebakbendera - Untuk bermain tebak bendera
 /tebakbendera2 - Untuk bermain tebak bendera 2
 /tebakgambar - Untuk bermain tebak gambar
 /tebakkabupaten - Untuk bermain tebak kabupaten <Error!>
 /tebakkalimat - Untuk bermain tebak kalimat
 /tebakkata - Untuk bermain tebak kata
 /tebakkimia - Untuk bermain tebak kimia
 /tebaklirik - Untuk bermain tebak lirik
 /tebaktebakan - Untuk bermain tebak tebakan
 /tekateki - Untuk bermain teka-teki
 /leaderboard - Untuk melihat leaderboard
 /exit - Untuk keluar dari mode tebak kata`;

        const text = remoteJid.endsWith('@g.us') ? groupMenu : privateMenu;
        // Only add mentions when in a group chat (participant present). In private chats
        // `numberUser` equals `remoteJid` and we shouldn't include mentions.
        const payload = { text };
        if (remoteJid.endsWith('@g.us')) payload.mentions = [numberUser];
        await sock.sendMessage(remoteJid, payload, { quoted: m.messages[0] });
      }

      // === Upload feature ===
      if (chatMessage === '/upload') {
        await uploadManager.startSession(sock, chatId, numberUser);
        return;
      }

      if (chatMessage.startsWith('/upload') && chatMessage.includes('show')) {
        await uploadManager.showFiles(sock, chatId, numberUser);
        return;
      }

      if (chatMessage === '/end') {
        await uploadManager.endSession(sock, chatId, numberUser);
        return;
      }

      if (chatMessage.startsWith('/jadwal')) {
        const jadwalKelas = await fetchData();
        await sock.sendMessage(remoteJid, { text: jadwalKelas }, { quoted: m.messages[0] });
      }

      if (chatMessage.startsWith('/tugas')) {
        try {
          const bearer = process.env.EDLINK_BEARER;
          const items = await fetchOpenAssignments({ bearer });
          if (!items || items.length === 0) {
            await sock.sendMessage(remoteJid, { text: '✅ Tidak ada tugas/quiz terbuka saat ini.' }, { quoted: m.messages[0] });
            return;
          }

          // helper to parse various timestamp formats
          const parseMaybeDate = (v) => {
            if (!v) return null;
            if (typeof v === 'number') {
              if (v < 1e12) v = v * 1000; // seconds -> ms
              return new Date(v);
            }
            const p = Date.parse(v);
            if (isNaN(p)) return null;
            return new Date(p);
          };

          const lines = items.map((it) => {
            const due = parseMaybeDate(it.dueAt || it.publishedAtTimestamp || it.section?.endedAtTimestamp);
            const dueStr = due ? due.toLocaleString('id-ID') : '—';
            // console.log(it.group);
            const className = it.group?.className || '';
            const kelas = it.group?.name || it.group?.className || '';
            const link = (it.group?.description && (it.group.description.match(/https?:\/\/(\S+)/) || [])[0]) || '';
            return `• ${it.title || 'Tugas/Quiz'}\nKelas: ${kelas} (${className})\nWaktu: ${dueStr}\n${link}`;
          });

          const out = `📚 *Daftar Tugas / Quiz Terbuka:*
\n${lines.join('\n\n')}`;
          await sock.sendMessage(remoteJid, { text: out }, { quoted: m.messages[0] });
        } catch (err) {
          console.error('Error fetching tugas:', err);
          await sock.sendMessage(remoteJid, { text: 'Gagal mengambil data tugas dari EdLink.' }, { quoted: m.messages[0] });
        }
      }

      if (remoteJid.endsWith('@g.us') && chatMessage.startsWith('/ai')) {
        const messageUser = chatMessage.slice(4).trim();
        const jawabanAI = await responAI(messageUser, sessionID);
        console.log(`Jawaban AI: ${jawabanAI}`);

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
          console.log(`NumberUSer ${numberUser}`);

          await sock.sendMessage(
            remoteJid,
            {
              text: `Jadwal berhasil ditambahkan:\nMata Kuliah: ${courseName}\nLink: ${zoomLink}\nJam: ${reminderTime}\nHari: ${days}`,
            },
            { quoted: m.messages[0] }
          );
        } else {
          await sock.sendMessage(remoteJid, { text: 'Format salah! Gunakan: /addList "Mata Kuliah" <Zoom Link> <Jam> <Hari>' }, { quoted: m.messages[0] });
        }
      }

      // === /notes command ===
      if (chatMessage.startsWith('/notes')) {
        const args = chatMessage.slice(6).trim(); // remove '/notes'

        // /notes show -> list notes
        if (args === 'show') {
          const rows = await listNotes();
          if (!rows.length) {
            await sock.sendMessage(remoteJid, { text: 'Belum ada notes.' }, { quoted: m.messages[0] });
            return;
          }
          const summary = rows.map((r) => `ID: ${r.id} — ${r.author} — ${r.created_at}\n\n${r.content.slice(0, 200)}${r.content.length > 200 ? '...' : ''}`).join('\n\n');
          await sock.sendMessage(remoteJid, { text: `Daftar notes:\n\n${summary}` }, { quoted: m.messages[0] });
          return;
        }

        // /notes delete <id>
        if (args.startsWith('delete ')) {
          const id = parseInt(args.split(' ')[1], 10);
          if (Number.isNaN(id)) {
            await sock.sendMessage(remoteJid, { text: 'ID tidak valid.' }, { quoted: m.messages[0] });
            return;
          }
          const ok = await deleteNote(id);
          await sock.sendMessage(remoteJid, { text: ok ? `Note ${id} dihapus.` : `Note ${id} tidak ditemukan.` }, { quoted: m.messages[0] });
          return;
        }

        // /notes <id> -> show note
        if (/^\d+$/.test(args)) {
          const id = parseInt(args, 10);
          const row = await getNoteById(id);
          if (!row) {
            await sock.sendMessage(remoteJid, { text: `Note dengan ID ${id} tidak ditemukan.` }, { quoted: m.messages[0] });
            return;
          }
          await sock.sendMessage(remoteJid, { text: `ID: ${row.id}\nAuthor: ${row.author}\nCreated: ${row.created_at}\n\n${row.content}` }, { quoted: m.messages[0] });
          return;
        }

        // Otherwise create a new note with the args as content
        if (args.length > 0) {
          const id = await createNote(numberUser, args);
          await sock.sendMessage(remoteJid, { text: `Note disimpan dengan ID ${id}.` }, { quoted: m.messages[0] });
          return;
        }

        // fallback: show help for notes
        await sock.sendMessage(remoteJid, { text: 'Format /notes:\n/notes <teks> — buat note\n/notes <id> — lihat note\n/notes show — list semua note\n/notes delete <id> — hapus note' }, { quoted: m.messages[0] });
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
          await sock.sendMessage(
            remoteJid,
            {
              text: '🚪 Permainan telah dihentikan.',
            },
            { quoted: msg }
          );
        } else {
          await sock.sendMessage(
            remoteJid,
            {
              text: '❌ Tidak ada permainan aktif saat ini.',
            },
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

        await sock.sendMessage(
          remoteJid,
          {
            text: '⏭️ Soal dilewati. Berikut soal selanjutnya:',
          },
          { quoted: msg }
        );

        // Kirim soal baru sesuai jenisnya
        if (nextSoal.soal && !nextSoal.img) {
          await sock.sendMessage(
            remoteJid,
            {
              text: `🧠 ${nextSoal.soal}`,
            },
            { quoted: msg }
          );
        } else if (session.game === 'tebakgambar' && nextSoal.img) {
          await sock.sendMessage(
            remoteJid,
            {
              image: { url: nextSoal.img },
              caption: `🖼️ *Clue:*\n${nextSoal.deskripsi || 'Tidak ada'}`,
            },
            { quoted: msg }
          );
        } else if (nextSoal.img) {
          await sock.sendMessage(
            remoteJid,
            {
              image: { url: nextSoal.img },
              caption: '🖼️ Soal Berikutnya!',
            },
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
            await addScore(chatId, numberUser, pushName);

            const sisa = session.jawaban.length - session.terjawab.length;

            if (gameHandlers.family100.isComplete(session)) {
              const next = gameHandlers.family100.getRandom();
              gameSessions.set(sessionKey, {
                game: 'family100',
                soal: next.soal,
                jawaban: next.jawaban,
                terjawab: [],
              });

              await sock.sendMessage(
                remoteJid,
                {
                  text: `✅ Semua jawaban benar!`,
                },
                { quoted: msg }
              );

              await sock.sendMessage(
                remoteJid,
                {
                  text: `💯 *FAMILY 100*\n${next.soal}`,
                },
                { quoted: msg }
              );
            } else {
              await sock.sendMessage(
                remoteJid,
                {
                  text: `✅ Benar! Masih ${sisa} jawaban lagi.`,
                },
                { quoted: msg }
              );
            }
          } else {
            await sock.sendMessage(
              remoteJid,
              {
                text: `❌ Salah atau sudah dijawab.`,
              },
              { quoted: msg }
            );
          }
          return;
        }

        // GAME BIASA
        const jawabanBenar = session.jawaban.toLowerCase();
        if (jawabanUser === jawabanBenar) {
          await addScore(chatId, numberUser, pushName);

          const nextSoal = gameHandlers[session.game].getRandom();
          gameSessions.set(sessionKey, {
            game: session.game,
            jawaban: nextSoal.jawaban.toLowerCase(),
            soal: nextSoal,
          });

          const deskripsi = session.soal?.deskripsi && ['caklontong', 'tebakgambar'].includes(session.game) ? `\n📝 *Penjelasan:* ${session.soal.deskripsi}` : '';

          // 1. Kirim feedback jawaban benar dulu
          await sock.sendMessage(
            remoteJid,
            {
              text: `✅ Benar! Point +10\n\n${deskripsi}`,
            },
            { quoted: msg }
          );

          await new Promise((resolve) => setTimeout(resolve, 800)); // Delay sebelum soal baru

          // 2. Kirim soal berikutnya (bentuk tergantung jenis game)
          if (session.game === 'susunkata') {
            await sock.sendMessage(
              remoteJid,
              {
                text: `🧩 *Soal Berikutnya:*\nSusun kata berikut: ${nextSoal.soal}\nKategori: ${nextSoal.tipe}`,
              },
              { quoted: msg }
            );
          } else if (nextSoal.soal && !nextSoal.img) {
            await sock.sendMessage(
              remoteJid,
              {
                text: `🧠 *Soal Berikutnya:*\n${nextSoal.soal}`,
              },
              { quoted: msg }
            );
          } else if (session.game === 'tebakgambar' && nextSoal.img) {
            await sock.sendMessage(remoteJid, {
              image: { url: nextSoal.img },
              caption: `🖼️ *Soal Berikutnya!*\n\n🧠 Clue: ${nextSoal.deskripsi || 'Tidak ada'}`,
              quoted: msg,
            });
          } else if (nextSoal.img) {
            await sock.sendMessage(remoteJid, {
              image: { url: nextSoal.img },
              caption: `🖼️ *Soal Berikutnya!*`,
              quoted: msg,
            });
          }

          return;
        }

        // Jawaban salah
        await sock.sendMessage(
          remoteJid,
          {
            text: `❌ Salah. Coba lagi atau ketik /exit untuk keluar.`,
          },
          { quoted: msg }
        );

        // Kirim ulang soal aktif
        const game = session.game;
        const soalAktif = session.soal;

        if (game === 'susunkata') {
          await sock.sendMessage(
            remoteJid,
            {
              text: `🔁 *Soal Ulang:*\nSusun kata berikut: ${soalAktif.soal}\nKategori: ${soalAktif.tipe}`,
            },
            { quoted: msg }
          );
        } else if (game === 'tebakkimia' && soalAktif.soal) {
          // Soal tebakkimia
          await sock.sendMessage(remoteJid, {
            text: `🔁 *Soal Ulang:*\nClue: Unsur dari ${soalAktif.soal} adalah?`,
            quoted: msg,
          });
        } else if (soalAktif.soal && !soalAktif.img) {
          // Soal berbentuk teks biasa
          await sock.sendMessage(remoteJid, {
            text: `🔁 *Soal Ulang:*\n${soalAktif.soal}`,
            quoted: msg,
          });
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
        const topUsers = await getTopUsers(remoteJid);
        console.log(`Top USers: ${topUsers}`);

        if (topUsers.length === 0) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '📊 Belum ada pemain di leaderboard untuk chat ini.',
            },
            { quoted: msg }
          );
          return;
        }

        let msgSend = '🏆 *Leaderboard Top 5:*\n';
        topUsers.forEach((user, i) => {
          msgSend += `${i + 1}. ${user.name} - ${user.score} poin\n`;
        });
        await sock.sendMessage(remoteJid, { text: msgSend }, { quoted: msg });
        return;
      }

      if (chatMessage === '/asahotak') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg }
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
        await sock.sendMessage(
          remoteJid,
          {
            text: `🧠 *ASAH OTAK*\n${soal.soal}`,
          },
          { quoted: msg }
        );
        return;
      }

      if (chatMessage === '/caklontong') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg }
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
        await sock.sendMessage(
          remoteJid,
          {
            text: `🤣 *CAK LONTONG*\n${soal.soal}`,
          },
          { quoted: msg }
        );
        return;
      }

      if (chatMessage === '/family100') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg }
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
        await sock.sendMessage(
          remoteJid,
          {
            text: `💯 *FAMILY 100*\n${soal.soal}\n\nTebak semua ${soal.jawaban.length} jawabannya!`,
          },
          { quoted: msg }
        );
        return;
      }

      if (chatMessage === '/siapakahaku') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg }
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
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg }
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

        await sock.sendMessage(
          remoteJid,
          {
            text: `🔤 *SUSUN KATA*\n${soal.soal}\n*Kategori:* ${soal.tipe}`,
          },
          { quoted: msg }
        );

        return;
      }

      if (chatMessage === '/tebakbendera') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg }
          );
          return;
        }

        const soal = gameHandlers.tebakbendera.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakbendera',
          jawaban: soal.name.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            image: { url: soal.img },
            caption: `🚩 *TEBAK BENDERA*\nNegara apakah ini?`,
          },
          { quoted: msg }
        );

        return;
      }

      if (chatMessage === '/tebakbendera2') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg }
          );
          return;
        }

        const soal = gameHandlers.tebakbendera2.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakbendera2',
          jawaban: soal.name.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            image: { url: soal.img },
            caption: `🚩 *TEBAK BENDERA*\nNegara apakah ini?`,
          },
          { quoted: msg }
        );

        return;
      }

      if (chatMessage === '/tebakgambar') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg }
          );
          return;
        }

        const soal = gameHandlers.tebakgambar.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakgambar',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            image: { url: soal.img },
            caption: `🖼️ *TEBAK GAMBAR*\nApa yang ada di gambar ini?\n\nClue: ${soal.deskripsi}`,
          },
          { quoted: msg }
        );

        return;
      }

      if (chatMessage === '/tebakkabupaten') {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg }
          );
          return;
        }

        const soal = gameHandlers.tebakkabupaten.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakkabupaten',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            image: { url: soal.img },
            caption: `🏙️ *TEBAK KABUPATEN*\nApa nama kabupaten ini?`,
          },
          { quoted: msg }
        );

        return;
      }

      if (chatMessage.startsWith('/tebakkalimat')) {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg }
          );
          return;
        }

        const soal = gameHandlers.tebakkalimat.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakkalimat',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `✍️ *TEBAK KALIMAT*\n${soal.soal}`,
          },
          { quoted: msg }
        );

        return;
      }

      if (chatMessage.startsWith('/tebakkata')) {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg }
          );
          return;
        }

        const soal = gameHandlers.tebakkata.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakkata',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `✍️ *TEBAK KATA*\nClue: ${soal.soal}`,
          },
          { quoted: msg }
        );

        return;
      }

      if (chatMessage.startsWith('/tebakkimia')) {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(
            remoteJid,
            {
              text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.',
            },
            { quoted: msg }
          );
          return;
        }

        const soal = gameHandlers.tebakkimia.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebakkimia',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `✍️ *TEBAK KIMIA*\nClue: Unsur dari ${soal.soal} adalah?`,
          },
          { quoted: msg }
        );

        return;
      }

      if (chatMessage.startsWith('/tebaklirik')) {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, { text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.' }, { quoted: msg });
          return;
        }

        const soal = gameHandlers.tebaklirik.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebaklirik',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `🎵 *TEBAK LIRIK*
${soal.soal}`,
          },
          { quoted: msg }
        );
        return;
      }

      if (chatMessage.startsWith('/tebaktebakan')) {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, { text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.' }, { quoted: msg });
          return;
        }

        const soal = gameHandlers.tebaktebakan.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tebaktebakan',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `🧩 *TEBAK-TEBAKAN*
${soal.soal}`,
          },
          { quoted: msg }
        );
        return;
      }

      if (chatMessage.startsWith('/tekateki')) {
        if (gameSessions.has(sessionKey)) {
          await sock.sendMessage(remoteJid, { text: '⚠️ Masih ada game aktif. Ketik /exit untuk keluar.' }, { quoted: msg });
          return;
        }

        const soal = gameHandlers.tekateki.getRandom();

        gameSessions.set(sessionKey, {
          game: 'tekateki',
          jawaban: soal.jawaban.toLowerCase(),
          soal,
        });

        await sock.sendMessage(
          remoteJid,
          {
            text: `❓ *TEKA-TEKI*
${soal.soal}`,
          },
          { quoted: msg }
        );
        return;
      }
    } catch (error) {
      console.error('Error handling incoming message:', error);
    }
  });
}

connectToWhatsApp();
