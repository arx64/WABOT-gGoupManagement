import * as wv from './games/wolvesville.js';

const WV_TIMER_MS = 50;
const sessionKey = 'test-chat';
const gameSessions = new Map();

const messages = [];
const sock = {
  sendMessage: async (jid, payload) => {
    messages.push({ jid, text: payload.text });
    return { ok: true };
  },
};

const remoteJid = 'test-chat@g.us';
const isGroup = true;

function clearWvTimers(session) {
  if (session && session.timers) {
    Object.values(session.timers).forEach((t) => t && clearTimeout(t));
    session.timers = {};
  }
}

async function wvSend(text) {
  await sock.sendMessage(remoteJid, { text });
}

async function wvRunNightEnd() {
  const cur = gameSessions.get(sessionKey);
  if (!cur || cur.type !== 'wolvesville' || cur.phase !== wv.PHASES.NIGHT) return;
  clearWvTimers(cur);
  const r = wv.resolveNight(cur);
  let text = `☀️ *HARI ${cur.day}*\n\n`;
  if (r.killed) text += `💀 ${r.killed.name} mati!\n`;
  const win = wv.checkWin(cur);
  if (win.ended) {
    text += `\n🏆 ${win.winner}`;
    await wvSend(text);
    clearWvTimers(cur);
    wv.endGame(cur, win.winner, win.reason);
    gameSessions.delete(sessionKey);
    return;
  }
  await wvSend(text);
  cur.timers.dayTimer = setTimeout(wvRunDayEnd, WV_TIMER_MS);
}

async function wvRunDayEnd() {
  const cur = gameSessions.get(sessionKey);
  if (!cur || cur.type !== 'wolvesville' || cur.phase !== wv.PHASES.DAY) return;
  clearWvTimers(cur);
  const r = wv.resolveVote(cur);
  cur.phase = wv.PHASES.NIGHT;
  cur.day += 1;
  cur.nightActions = { kills: {}, seerChecks: {}, protects: {} };
  if (r.hunterTrigger) cur.pendingHunter = r.hunterTrigger.idx;
  let text = `🌙 *MALAM ${cur.day}*`;
  if (r.lynched) text += `\n⚖️ ${r.lynched.name} digantung`;
  const win = wv.checkWin(cur);
  if (win.ended) {
    text += `\n🏆 ${win.winner}`;
    await wvSend(text);
    clearWvTimers(cur);
    wv.endGame(cur, win.winner, win.reason);
    gameSessions.delete(sessionKey);
    return;
  }
  await wvSend(text);
  cur.timers.nightTimer = setTimeout(wvRunNightEnd, WV_TIMER_MS);
}

async function sleep(ms) {
  await new Promise(r => setTimeout(r, ms));
}

async function testCase(name, setup, votes) {
  messages.length = 0;
  const s = wv.createLobby('host@x', 'Host');
  setup(s);
  wv.startGame(s);
  s.timers = {};
  gameSessions.set(sessionKey, s);
  s.timers.nightTimer = setTimeout(wvRunNightEnd, WV_TIMER_MS);
  await sleep(WV_TIMER_MS + 20);
  let cur = gameSessions.get(sessionKey);
  if (!cur) {
    console.log(`[${name}] Game ended early`);
    return;
  }
  // All villagers vote wolf
  const alive = cur.players.map((p, i) => p.alive ? i : -1).filter(i => i !== -1);
  const wIdx = cur.players.findIndex(p => p.role === 'werewolf');
  for (const v of alive) {
    if (v !== wIdx) wv.processVote(cur, v, wIdx);
  }
  await sleep(WV_TIMER_MS + 20);
  cur = gameSessions.get(sessionKey);
  console.log(`[${name}] game still exists after day cycle:`, !!cur);
  if (cur) {
    console.log(`  phase: ${cur.phase}, day: ${cur.day}, alive: ${cur.players.filter(p => p.alive).length}`);
  }
  // Wait one more cycle to make sure
  if (cur) {
    await sleep(WV_TIMER_MS + 20);
    cur = gameSessions.get(sessionKey);
    console.log(`[${name}] after night cycle: game exists =`, !!cur);
  }
  // Cleanup any pending timers
  if (cur) clearWvTimers(cur);
  gameSessions.delete(sessionKey);
}

// Test 1: wolf kills villager, village votes wolf out, ends in villagers win
console.log('=== Test 1: wolf kills villager first ===');
await testCase('T1', (s) => {
  wv.joinLobby(s, 'p2@x', 'P2');
  wv.joinLobby(s, 'p3@x', 'P3');
  wv.joinLobby(s, 'p4@x', 'P4');
}, null);
console.log('');

console.log('=== Test 2: wolves outnumber villagers mid-game ===');
// Setup 4 players (1 wolf, 1 seer, 2 villagers), then wolf kills seer + villager night 1
await new Promise(async () => {
  messages.length = 0;
  const s = wv.createLobby('host@x', 'Host');
  wv.joinLobby(s, 'p2@x', 'P2');
  wv.joinLobby(s, 'p3@x', 'P3');
  wv.joinLobby(s, 'p4@x', 'P4');
  wv.startGame(s);
  s.timers = {};
  gameSessions.set(sessionKey, s);

  // Night 1: wolf kills seer
  const w = s.players.findIndex(p => p.role === 'werewolf');
  const se = s.players.findIndex(p => p.role === 'seer');
  wv.processWerewolfKill(s, w, se);

  s.timers.nightTimer = setTimeout(wvRunNightEnd, WV_TIMER_MS);
  await sleep(WV_TIMER_MS + 20);

  let cur = gameSessions.get(sessionKey);
  console.log('After night 1: phase =', cur?.phase, 'alive =', cur?.players.filter(p=>p.alive).length);

  // Day 1: villagers must vote wolf to win (or game continues)
  const alive = cur.players.map((p, i) => p.alive ? i : -1).filter(i => i !== -1);
  const wIdx = cur.players.findIndex(p => p.role === 'werewolf');
  for (const v of alive) {
    if (v !== wIdx) wv.processVote(cur, v, wIdx);
  }
  await sleep(WV_TIMER_MS + 20);
  cur = gameSessions.get(sessionKey);
  console.log('After day 1: game exists =', !!cur);
  if (cur) {
    console.log('  wolf wins?', wv.checkWin(cur).ended);
  }
});

console.log('\nALL TESTS OK');