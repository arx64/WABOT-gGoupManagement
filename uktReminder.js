import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfiguredUktMonths, getUktInstallmentAmount, getUktMonthName, formatUktRupiah, listUktPayments } from './uktManager.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TIME_ZONE = process.env.TIMEZONE || 'Asia/Jakarta';
const REMINDER_HOUR = 9;
let intervalId = null;
let running = false;

function getLocalDateParts(date = new Date(), timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return { year: Number(value('year')), month: Number(value('month')), day: Number(value('day')), hour: Number(value('hour')) };
}

export function buildUktReminderMessage(year, month) {
  const monthName = getUktMonthName(month);
  const amount = formatUktRupiah(getUktInstallmentAmount(month));
  return `🎓 *PENGINGAT PEMBAYARAN UKT*\n\n` +
    `Bukti pembayaran UKT untuk *${monthName} ${year}* belum ditemukan.\n` +
    `💰 Nominal cicilan: *${amount}*\n` +
    `📅 Batas pembayaran: *30 ${monthName} ${year}*\n\n` +
    `Silakan lakukan pembayaran sebelum tanggal 30 dan kirim bukti berupa gambar dengan caption /ukt agar tercatat. Jika kamu sudah membayar, unggah bukti pembayarannya supaya pengingat ini tidak muncul lagi.`;
}

async function readSentReminders(filePath) {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return [];
    throw error;
  }
}

async function writeSentReminders(filePath, sent) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(sent, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, filePath);
}

export async function checkAndSendUktReminder(sock, {
  date = new Date(),
  timeZone = TIME_ZONE,
  recipient = process.env.UKT_REMINDER_JID || process.env.OWNER_NUMBER || '',
  rootDir = __dirname,
  sentFilePath = path.join(rootDir, 'uploads', 'ukt', 'reminders-sent.json'),
} = {}) {
  const { year, month, day, hour } = getLocalDateParts(date, timeZone);
  if (day !== 15 || hour < REMINDER_HOUR) return { status: 'not-due' };

  const months = getConfiguredUktMonths();
  if (!months.includes(month)) return { status: 'month-not-monitored' };
  const reminderKey = `${year}-${String(month).padStart(2, '0')}`;
  const sent = await readSentReminders(sentFilePath);
  if (sent.includes(reminderKey)) return { status: 'already-checked' };

  const records = await listUktPayments({ rootDir, configuredMonths: months });
  const hasProof = records.some((record) => Number(record.year) === year && Number(record.month) === month);
  if (hasProof) {
    sent.push(reminderKey);
    await writeSentReminders(sentFilePath, sent);
    return { status: 'proof-exists' };
  }

  const normalizedRecipient = String(recipient).trim();
  if (!normalizedRecipient) return { status: 'missing-recipient' };
  const jid = normalizedRecipient.includes('@') ? normalizedRecipient : `${normalizedRecipient.replace(/\D/g, '')}@s.whatsapp.net`;
  if (!jid || jid === '@s.whatsapp.net') return { status: 'missing-recipient' };

  await sock.sendMessage(jid, { text: buildUktReminderMessage(year, month) });
  sent.push(reminderKey);
  await writeSentReminders(sentFilePath, sent);
  console.log(`[UKT Reminder] Pengingat ${reminderKey} dikirim ke ${jid}`);
  return { status: 'sent', jid, reminderKey };
}

export function startUktReminderScheduler(sock, { intervalMs = 60_000 } = {}) {
  if (intervalId) clearInterval(intervalId);
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await checkAndSendUktReminder(sock);
      if (result.status === 'sent') console.log(`[UKT Reminder] Reminder terkirim untuk ${result.reminderKey}`);
      else if (result.status === 'missing-recipient') console.warn('[UKT Reminder] UKT_REMINDER_JID dan OWNER_NUMBER belum dikonfigurasi.');
    } catch (error) {
      console.error('[UKT Reminder] Gagal memeriksa pengingat:', error.message);
    } finally {
      running = false;
    }
  };
  void run();
  intervalId = setInterval(() => void run(), intervalMs);
}

export function stopUktReminderScheduler() {
  if (intervalId) clearInterval(intervalId);
  intervalId = null;
}
