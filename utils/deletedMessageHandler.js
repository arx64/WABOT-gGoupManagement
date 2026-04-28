/**
 * Deleted Message Handler
 * Menangkap dan mencatat pesan yang dihapus oleh pengguna
 */

// Cache untuk menyimpan pesan yang diterima: chatJid → Map(messageId → messageData)
const messageCache = new Map();
const MAX_MESSAGES_PER_CHAT = 1000;
const MAX_CACHE_AGE_MS = 24 * 60 * 60 * 1000; // 24 jam

/**
 * Tambahkan pesan ke cache
 * @param {string} chatJid - ID chat (person atau group)
 * @param {string} messageId - ID pesan unik
 * @param {Object} msg - Object pesan lengkap dari Baileys
 */
export function cacheMessage(chatJid, messageId, msg) {
  try {
    if (!chatJid || !messageId) return;

    if (!messageCache.has(chatJid)) {
      messageCache.set(chatJid, new Map());
    }

    const chatMessages = messageCache.get(chatJid);
    
    // Simpan data pesan dengan timestamp
    chatMessages.set(messageId, {
      message: msg,
      timestamp: Date.now(),
      senderJid: msg.key.participant || msg.key.remoteJid,
      pushName: msg.pushName || 'Unknown'
    });

    // Batasi cache size per chat
    if (chatMessages.size > MAX_MESSAGES_PER_CHAT) {
      const firstKey = chatMessages.keys().next().value;
      chatMessages.delete(firstKey);
    }
  } catch (e) {
    console.error('Error caching message:', e);
  }
}

/**
 * Dapatkan pesan dari cache
 * @param {string} chatJid - ID chat
 * @param {string} messageId - ID pesan
 * @returns {Object|null} - Data pesan atau null jika tidak ditemukan
 */
export function getCachedMessage(chatJid, messageId) {
  try {
    const chatMessages = messageCache.get(chatJid);
    if (!chatMessages) return null;
    return chatMessages.get(messageId) || null;
  } catch (e) {
    console.error('Error getting cached message:', e);
    return null;
  }
}

/**
 * Hapus pesan dari cache
 * @param {string} chatJid - ID chat
 * @param {string} messageId - ID pesan
 */
export function removeCachedMessage(chatJid, messageId) {
  try {
    const chatMessages = messageCache.get(chatJid);
    if (chatMessages) {
      chatMessages.delete(messageId);
    }
  } catch (e) {
    console.error('Error removing cached message:', e);
  }
}

/**
 * Format pesan untuk ditampilkan
 * @param {Object} cachedMsgData - Data pesan dari cache
 * @returns {string} - Formatted message text
 */
export function formatDeletedMessage(cachedMsgData) {
  if (!cachedMsgData) return '';

  const msg = cachedMsgData.message;
  const senderName = cachedMsgData.pushName || 'Unknown';
  const senderJid = cachedMsgData.senderJid.split('@')[0];

  let content = '';
  
  // Ekstrak content dari berbagai tipe pesan
  if (msg.message?.conversation) {
    content = msg.message.conversation;
  } else if (msg.message?.extendedTextMessage?.text) {
    content = msg.message.extendedTextMessage.text;
  } else if (msg.message?.imageMessage?.caption) {
    content = `📸 Gambar: ${msg.message.imageMessage.caption || '(tanpa caption)'}`;
  } else if (msg.message?.videoMessage?.caption) {
    content = `🎥 Video: ${msg.message.videoMessage.caption || '(tanpa caption)'}`;
  } else if (msg.message?.audioMessage) {
    content = '🎵 Pesan Suara';
  } else if (msg.message?.documentMessage) {
    const fileName = msg.message.documentMessage.filename || 'Document';
    content = `📄 File: ${fileName}`;
  } else if (msg.message?.stickerMessage) {
    content = '🎨 Sticker';
  } else if (msg.message?.contactMessage) {
    content = `👤 Kontak: ${msg.message.contactMessage.displayName || 'Unknown'}`;
  } else if (msg.message?.locationMessage) {
    content = `📍 Lokasi`;
  } else if (msg.message?.viewOnceMessage || msg.message?.viewOnceMessageV2) {
    content = '👁️ Pesan Sekali Lihat (View-Once)';
  } else {
    content = '(Pesan tidak dapat ditampilkan)';
  }

  return content;
}

/**
 * Buat formatted message untuk dikirim ke chat
 * @param {Object} cachedMsgData - Data pesan dari cache
 * @param {string} chatJid - ID chat (untuk mengetahui jika grup atau personal)
 * @returns {string} - Formatted notification message
 */
export function createDeletedMessageNotification(cachedMsgData, chatJid) {
  if (!cachedMsgData) return '';

  const senderName = cachedMsgData.pushName || 'Unknown';
  const senderJid = cachedMsgData.senderJid;
  const isGroup = chatJid.endsWith('@g.us');
  
  const content = formatDeletedMessage(cachedMsgData);
  
  // Format berdasarkan apakah ini group atau personal chat
  let notification = '';
  
  if (isGroup) {
    // Untuk group, mention si pengguna
    notification = `🗑️ *Pesan Dihapus*\n\n`;
    notification += `👤 Pengguna: @${senderJid.split('@')[0]}\n`;
    notification += `💬 Isi: ${content}`;
  } else {
    // Untuk personal chat
    notification = `🗑️ *Pesan yang Dihapus*\n\n`;
    notification += `👤 Dari: ${senderName}\n`;
    notification += `💬 ${content}`;
  }

  return notification;
}

/**
 * Cleanup cache yang sudah lama
 * Dipanggil secara periodik untuk menghapus pesan lama dari cache
 */
export function cleanupOldMessages() {
  try {
    const now = Date.now();
    for (const [chatJid, chatMessages] of messageCache.entries()) {
      for (const [msgId, msgData] of chatMessages.entries()) {
        if (now - msgData.timestamp > MAX_CACHE_AGE_MS) {
          chatMessages.delete(msgId);
        }
      }
      // Hapus chat dari cache jika sudah kosong
      if (chatMessages.size === 0) {
        messageCache.delete(chatJid);
      }
    }
  } catch (e) {
    console.error('Error cleaning up old messages:', e);
  }
}

/**
 * Jalankan cleanup secara periodik (setiap 1 jam)
 */
setInterval(() => {
  console.log('🧹 Membersihkan cache pesan yang sudah lama...');
  cleanupOldMessages();
}, 60 * 60 * 1000); // 1 jam
