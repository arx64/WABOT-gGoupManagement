/** Helpers for formatting WhatsApp message-edit notifications. */

function unwrapMessage(message) {
  let content = message?.message || message || {};
  for (let depth = 0; content && depth < 6; depth += 1) {
    if (content.ephemeralMessage?.message) content = content.ephemeralMessage.message;
    else if (content.viewOnceMessage?.message) content = content.viewOnceMessage.message;
    else if (content.viewOnceMessageV2?.message) content = content.viewOnceMessageV2.message;
    else if (content.viewOnceMessageV2Extension?.message) content = content.viewOnceMessageV2Extension.message;
    else if (content.documentWithCaptionMessage?.message) content = content.documentWithCaptionMessage.message;
    else break;
  }
  return content || {};
}

export function extractMessageText(message) {
  const content = unwrapMessage(message);
  if (typeof content.conversation === 'string') return content.conversation;
  if (typeof content.extendedTextMessage?.text === 'string') return content.extendedTextMessage.text;
  if (typeof content.imageMessage?.caption === 'string' && content.imageMessage.caption) return `📸 Gambar — ${content.imageMessage.caption}`;
  if (typeof content.videoMessage?.caption === 'string' && content.videoMessage.caption) return `🎥 Video — ${content.videoMessage.caption}`;
  if (content.imageMessage) return '📸 Gambar (tanpa caption)';
  if (content.videoMessage) return '🎥 Video (tanpa caption)';
  if (content.audioMessage) return '🎤 Pesan suara';
  if (content.ptvMessage) return '🎥 Video pendek';
  if (content.documentMessage) return `📄 Dokumen — ${content.documentMessage.fileName || content.documentMessage.filename || 'tanpa nama'}`;
  if (content.stickerMessage) return '🏷️ Stiker';
  if (content.contactMessage) return `👤 Kontak — ${content.contactMessage.displayName || 'tanpa nama'}`;
  if (content.locationMessage || content.liveLocationMessage) return '📍 Lokasi';
  return '(Isi pesan tidak dapat ditampilkan)';
}

export function createEditedMessageNotification({ cachedData, editedMessage, chatJid, groupName }) {
  const senderName = cachedData?.pushName || cachedData?.phoneNumber || (cachedData?.senderJid || '').split('@')[0] || 'Tidak diketahui';
  const senderNumber = cachedData?.phoneNumber || '';
  const oldText = extractMessageText(cachedData?.message);
  const newText = extractMessageText(editedMessage);
  const isGroup = String(chatJid || '').endsWith('@g.us');
  const location = isGroup
    ? `📍 Grup: ${groupName || chatJid.split('@')[0]}`
    : `📍 Chat pribadi: ${String(chatJid || '').split('@')[0]}`;

  return [
    '✏️ *Pesan Diedit*',
    `👤 Pengirim: ${senderName}${senderNumber ? ` (${senderNumber})` : ''}`,
    location,
    '',
    '📩 *Pesan Lama:*',
    oldText,
    '',
    '🆕 *Pesan Baru:*',
    newText,
  ].join('\n');
}
