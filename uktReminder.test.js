import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildUktReminderMessage, checkAndSendUktReminder } from './uktReminder.js';

test('UKT reminder includes installment amount and deadline on the 30th', () => {
  const message = buildUktReminderMessage(2026, 10);
  assert.match(message, /Oktober 2026/);
  assert.match(message, /Rp500\.000/);
  assert.match(message, /30 Oktober 2026/);
});

test('sends a reminder on the 15th when no proof exists, only once', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ukt-reminder-test-'));
  const sent = [];
  const sock = { sendMessage: async (jid, payload) => sent.push({ jid, payload }) };
  const options = {
    date: new Date('2026-10-15T02:00:00.000Z'),
    timeZone: 'Asia/Jakarta',
    recipient: '6281234567890',
    rootDir,
    sentFilePath: path.join(rootDir, 'reminders-sent.json'),
  };
  try {
    assert.equal((await checkAndSendUktReminder(sock, options)).status, 'sent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].jid, '6281234567890@s.whatsapp.net');
    assert.match(sent[0].payload.text, /Rp500\.000/);
    assert.equal((await checkAndSendUktReminder(sock, options)).status, 'already-checked');
    assert.equal(sent.length, 1);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('does not send when a proof already exists for the period', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ukt-reminder-paid-test-'));
  const manifestPath = path.join(rootDir, 'uploads', 'ukt', 'manifest.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  await fs.writeFile(manifestPath, JSON.stringify([
    { year: 2026, month: 10, monthName: 'Oktober', filename: 'bukti.jpg', source: 'drive' },
  ]));
  const sent = [];
  try {
    const result = await checkAndSendUktReminder({ sendMessage: async (...args) => sent.push(args) }, {
      date: new Date('2026-10-15T02:00:00.000Z'),
      timeZone: 'Asia/Jakarta',
      recipient: '6281234567890',
      rootDir,
      sentFilePath: path.join(rootDir, 'reminders-sent.json'),
    });
    assert.equal(result.status, 'proof-exists');
    assert.equal(sent.length, 0);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});

test('does not send outside the 15th reminder day or during unmonitored months', async () => {
  const sent = [];
  const sock = { sendMessage: async (...args) => sent.push(args) };
  assert.equal((await checkAndSendUktReminder(sock, { date: new Date('2026-10-14T02:00:00.000Z'), timeZone: 'Asia/Jakarta', recipient: '6281234567890' })).status, 'not-due');
  assert.equal((await checkAndSendUktReminder(sock, { date: new Date('2026-08-15T02:00:00.000Z'), timeZone: 'Asia/Jakarta', recipient: '6281234567890' })).status, 'month-not-monitored');
  assert.equal(sent.length, 0);
});
