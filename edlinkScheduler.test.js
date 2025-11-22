// Small runtime test for edlinkScheduler
// This test mocks fetch and a simple sock.sendMessage to verify the scheduler sends a message.

import { startEdlinkScheduler, stopEdlinkScheduler } from './edlinkScheduler.js';

// Capture sent messages
const sent = [];
const fakeSock = {
  sendMessage: async (jid, payload) => {
    sent.push({ jid, payload });
    return { ok: true };
  }
};

// Mock fetch to return one item due now
global.fetch = async () => {
  const now = new Date();
  const iso = now.toISOString();
  return {
    ok: true,
    json: async () => ({ data: { data: [ { id: 'test-1', title: 'Tugas Unit Test', group: { name: 'Kelas-UT', description: 'Info: https://example.test/assignment' }, dueAt: iso } ] } })
  };
};

async function runTest() {
  console.log('Starting edlink scheduler test (will run ~6s)');
  // Use offsets [0] so notify time equals due time (which is now)
  await startEdlinkScheduler(fakeSock, { bearer: 'fake-token', notifyJid: 'test-123@s.whatsapp.net', offsets: [0], freqSeconds: 2 });

  // Wait 6 seconds to allow a couple of polling rounds
  await new Promise((res) => setTimeout(res, 6000));

  // Stop scheduler
  stopEdlinkScheduler();

  console.log('Captured sent messages:', sent);
}

runTest().catch(err => { console.error('Test failed', err); process.exit(1); });
