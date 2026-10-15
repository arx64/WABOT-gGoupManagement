import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDeletedNotificationExpiry, DELETED_NOTIFICATION_TTL_MS } from './deletedNotificationExpiry.js';

test('deleted-message notification is scheduled for 24 hours and deleted when due', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'deleted-notification-expiry-'));
  const filePath = path.join(directory, 'queue.json');
  let currentTime = 1_000_000;
  const deleted = [];
  const manager = createDeletedNotificationExpiry({ filePath, now: () => currentTime });
  const socket = { sendMessage: async (jid, content) => { deleted.push({ jid, content }); } };

  try {
    await manager.schedule('628123@s.whatsapp.net', { id: 'MSG-123' });
    const scheduled = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.equal(scheduled[0].deleteAt, currentTime + DELETED_NOTIFICATION_TTL_MS);

    manager.start(socket);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await manager.processDue();
    assert.equal(deleted.length, 0);

    currentTime += DELETED_NOTIFICATION_TTL_MS;
    await manager.processDue();
    assert.deepEqual(deleted, [{
      jid: '628123@s.whatsapp.net',
      content: { delete: { remoteJid: '628123@s.whatsapp.net', fromMe: true, id: 'MSG-123' } },
    }]);
    assert.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf8')), []);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test('failed delete stays queued for retry', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'deleted-notification-retry-'));
  const filePath = path.join(directory, 'queue.json');
  let currentTime = 10_000;
  const manager = createDeletedNotificationExpiry({ filePath, now: () => currentTime });
  try {
    await manager.schedule('628123@s.whatsapp.net', { id: 'MSG-RETRY' });
    currentTime += DELETED_NOTIFICATION_TTL_MS;
    manager.start({ sendMessage: async () => { throw new Error('temporary error'); } });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await manager.processDue();
    const queue = JSON.parse(await fs.readFile(filePath, 'utf8'));
    assert.equal(queue.length, 1);
    assert.equal(queue[0].messageId, 'MSG-RETRY');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
