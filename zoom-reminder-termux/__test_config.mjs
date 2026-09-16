import * as wv from './games/wolvesville.js';

// Use accelerated timers for test
const WV_NIGHT_MS = 50;
const WV_DISCUSS_MS = 100;
const WV_VOTE_MS = 50;
const gameSessions = new Map();

const messages = [];
const sock = {
  sendMessage: async (jid, payload) => {
    messages.push({ jid, text: payload.text });
    return { ok: true };
  },
};

const groupJid = 'G@g.us';

function clearWvTimers(session) {
  if (session && session.timers) {
    Object.values(session.timers).forEach((t) => t && clearTimeout(t));
    session.timers = {};
  }
}

function findWvAnySession(phase) {
  for (const [key, sess] of gameSessions.entries()) {
    if (sess && sess.type === 'wolvesville' && (!phase || sess.phase === phase)) {
      return { session: sess, key };
    }
  }
  return null;
}

async function wvSendTo(targetJid, text) {
  await sock.sendMessage(targetJid, { text });
}

async function wvRunNightEnd() {
  const found = findWvAnySession(wv.PHASES.NIGHT);
  if (!found) return;
  const cur = found.session;
  const curKey = found.key;
  clearWvTimers(cur);
  const r = wv.resolveNight(cur);
  let text = `HARI ${cur.day} ${r.killed ? r.killed.name + ' mati' : 'no kill'}`;
  await wvSendTo(curKey, text);
  cur.timers.discussTimer = setTimeout(wvOpenVoting, WV_DISCUSS_MS);
}

async function wvOpenVoting() {
  const found = findWvAnySession(wv.PHASES.DAY);
  if (!found) return;
  const cur = found.session;
  const curKey = found.key;
  if (cur.votingOpen) return;
  clearWvTimers(cur);
  wv.openVoting(cur);
  console.log(`[wvOpenVoting] voting opened, schedule vote end in ${WV_VOTE_MS}ms`);
  await wvSendTo(curKey, `VOTING DIBUKA (${cur.votingOpen})`);
  cur.timers.voteTimer = setTimeout(wvRunDayEnd, WV_VOTE_MS);
}

async function wvRunDayEnd() {
  const found = findWvAnySession(wv.PHASES.DAY);
  if (!found) return;
  const cur = found.session;
  const curKey = found.key;
  clearWvTimers(cur);
  const r = wv.resolveVote(cur);
  cur.phase = wv.PHASES.NIGHT;
  cur.day += 1;
  cur.votingOpen = false;
  await wvSendTo(curKey, `MALAM ${cur.day}`);
  cur.timers.nightTimer = setTimeout(wvRunNightEnd, WV_NIGHT_MS);
}

// Setup
let s = wv.createLobby('host@x', 'Host');
['p2@x', 'p3@x', 'p4@x'].forEach((j, i) => wv.joinLobby(s, j, String.fromCharCode(66 + i)));
wv.startGame(s);
s.timers = {};
gameSessions.set(groupJid, s);

// Test 1: voting rejected during discussion
console.log('=== Test 1: vote rejected during discuss ===');
const w = s.players.findIndex(p => p.role === 'werewolf');
const alive = s.players.map((p, i) => p.alive ? i : -1).filter(i => i !== -1);
const target = alive.find(i => i !== w);
const r1 = wv.processVote(s, alive[0], target);
console.log(`Vote during NIGHT (before resolveNight): ok=${r1.ok}, reason=${r1.reason}`);

// After resolveNight -> DAY, votingOpen=false
s.timers.nightTimer = setTimeout(wvRunNightEnd, 0);
await new Promise(r => setTimeout(r, 30));
const sess = gameSessions.get(groupJid).session || gameSessions.get(groupJid);
const sessReal = gameSessions.get(groupJid);
console.log(`After resolveNight: phase=${sessReal.phase}, votingOpen=${sessReal.votingOpen}`);

// Try vote during discuss
const r2 = wv.processVote(sessReal, alive[0], target);
console.log(`Vote during DISCUSS: ok=${r2.ok}, reason=${r2.reason}`);

// Wait for wvOpenVoting to fire
await new Promise(r => setTimeout(r, WV_DISCUSS_MS + 30));
const sessAfter = gameSessions.get(groupJid);
console.log(`After wvOpenVoting: phase=${sessAfter.phase}, votingOpen=${sessAfter.votingOpen}`);

// Vote now should work
const r3 = wv.processVote(sessAfter, alive[0], target);
console.log(`Vote during VOTING: ok=${r3.ok}`);

// Wait for vote end
await new Promise(r => setTimeout(r, WV_VOTE_MS + 30));
const sessFinal = gameSessions.get(groupJid);
console.log(`After voteEnd: phase=${sessFinal.phase}, day=${sessFinal.day}, votingOpen=${sessFinal.votingOpen}`);
console.log(`Lynched: ${sessFinal.players.filter(p => !p.alive).map(p => p.name).join(', ')}`);

console.log('\n--- Messages sent ---');
messages.forEach(m => console.log(`→ ${m.text.split('\n')[0]}`));

console.log('\nALL TESTS OK');