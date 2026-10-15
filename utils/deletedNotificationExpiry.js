import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DELETED_NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_QUEUE_PATH = path.join(__dirname, '..', 'uploads', 'deleted-notification-expiry.json');

export function createDeletedNotificationExpiry({
  filePath = DEFAULT_QUEUE_PATH,
  now = Date.now,
  intervalMs = 60_000,
} = {}) {
  let activeSocket = null;
  let timer = null;
  let processing = false;

  async function readQueue() {
    try {
      const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return [];
      throw error;
    }
  }

  async function writeQueue(queue) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(queue, null, 2)}\n`, 'utf8');
    await fs.rename(temporaryPath, filePath);
  }

  async function schedule(ownerJid, sentMessageKey) {
    if (!ownerJid || !sentMessageKey?.id) return false;
    const queue = await readQueue();
    // Avoid scheduling the same WhatsApp message twice.
    if (queue.some((item) => item.ownerJid === ownerJid && item.messageId === sentMessageKey.id)) return true;
    queue.push({ ownerJid, messageId: sentMessageKey.id, deleteAt: now() + DELETED_NOTIFICATION_TTL_MS });
    await writeQueue(queue);
    return true;
  }

  async function processDue() {
    if (!activeSocket || processing) return;
    processing = true;
    try {
      const queue = await readQueue();
      if (!queue.length) return;
      const remaining = [];
      let changed = false;
      for (const item of queue) {
        if (!item?.ownerJid || !item?.messageId || !Number.isFinite(item.deleteAt)) {
          changed = true;
          continue;
        }
        if (item.deleteAt > now()) {
          remaining.push(item);
          continue;
        }
        try {
          await activeSocket.sendMessage(item.ownerJid, {
            delete: { remoteJid: item.ownerJid, fromMe: true, id: item.messageId },
          });
          changed = true;
          console.log(`[deleted-message] Notifikasi ${item.messageId} dihapus setelah 24 jam.`);
        } catch (error) {
          // Keep the job so a transient disconnect/API error can be retried.
          remaining.push(item);
          console.warn(`[deleted-message] Gagal menghapus ${item.messageId}; akan dicoba lagi:`, error.message);
        }
      }
      if (changed) await writeQueue(remaining);
    } catch (error) {
      console.error('[deleted-message] Gagal memproses antrean penghapusan:', error.message);
    } finally {
      processing = false;
    }
  }

  function start(socket, { processImmediately = true } = {}) {
    activeSocket = socket;
    if (!timer) {
      timer = setInterval(() => { void processDue(); }, intervalMs);
      timer.unref?.();
    }
    if (processImmediately) void processDue();
  }

  return { schedule, processDue, start };
}

const deletedNotificationExpiry = createDeletedNotificationExpiry();
export const scheduleDeletedNotificationExpiry = deletedNotificationExpiry.schedule;
export const processDueDeletedNotifications = deletedNotificationExpiry.processDue;
export const startDeletedNotificationExpiry = deletedNotificationExpiry.start;
