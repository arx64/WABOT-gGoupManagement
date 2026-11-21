import test from 'node:test';
import assert from 'node:assert/strict';
import { createEditedMessageNotification, extractMessageText } from './editedMessageHandler.js';

test('extracts regular and wrapped message text', () => {
  assert.equal(extractMessageText({ message: { conversation: 'teks lama' } }), 'teks lama');
  assert.equal(extractMessageText({ message: { ephemeralMessage: { message: { extendedTextMessage: { text: 'teks baru' } } } } }), 'teks baru');
});

test('formats old and new text together in one notification', () => {
  const notification = createEditedMessageNotification({
    cachedData: {
      message: { message: { conversation: 'Pesan lama' } },
      pushName: 'Arif',
      phoneNumber: '6281234567890',
    },
    editedMessage: { message: { conversation: 'Pesan baru' } },
    chatJid: '6281111111111@s.whatsapp.net',
  });

  assert.match(notification, /Pesan Lama:[\s\S]*Pesan lama/);
  assert.match(notification, /Pesan Baru:[\s\S]*Pesan baru/);
  assert.match(notification, /Arif \(6281234567890\)/);
});
