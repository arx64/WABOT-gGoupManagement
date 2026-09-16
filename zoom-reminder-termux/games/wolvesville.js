import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const data = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../database/wolvesville.json'), 'utf-8'),
);

const { roles, distribution, minPlayers, maxPlayers } = data;

export const PHASES = {
  LOBBY: 'lobby',
  NIGHT: 'night',
  DAY: 'day',
  ENDED: 'ended',
};

export function getConfig() {
  return {
    minPlayers,
    maxPlayers,
    voteSeconds: data.voteSeconds,
    nightSeconds: data.nightSeconds,
    dayDiscussSeconds: data.dayDiscussSeconds,
  };
}

export function getRoleInfo(roleKey) {
  return roles[roleKey] || null;
}

export function getRoleListText() {
  let text = '📜 *DAFTAR ROLE*\n';
  Object.entries(roles).forEach(([key, r]) => {
    text += `${r.emoji} *${r.name}* (${key})\n`;
    text += `   Tim: ${r.team === 'werewolf' ? '🐺 Serigala' : '🏘️ Warga'}\n`;
    text += `   ${r.desc}\n\n`;
  });
  return text.trim();
}

export function createLobby(hostJid, hostName) {
  return {
    type: 'wolvesville',
    phase: PHASES.LOBBY,
    hostJid,
    day: 0,
    players: [
      {
        jid: hostJid,
        name: hostName,
        role: null,
        alive: true,
        protectedLastNight: false,
        lastProtectedIdx: null,
      },
    ],
    nightActions: { kills: {}, seerChecks: {}, protects: {} },
    dayVotes: {},
    votingOpen: false,
    pendingHunter: null,
    timers: {},
  };
}

export function isLobby(session) {
  return session && session.type === 'wolvesville' && session.phase === PHASES.LOBBY;
}

export function isInGame(session) {
  return session && session.type === 'wolvesville' &&
    [PHASES.NIGHT, PHASES.DAY].includes(session.phase);
}

export function isEnded(session) {
  return session && session.type === 'wolvesville' && session.phase === PHASES.ENDED;
}

export function getPlayerIdx(session, jid) {
  return session.players.findIndex((p) => p.jid === jid);
}

export function isInSession(session, jid) {
  return getPlayerIdx(session, jid) !== -1;
}

export function joinLobby(session, jid, name) {
  if (!isLobby(session)) return { ok: false, reason: 'Lobby sudah dimulai.' };
  if (session.players.length >= maxPlayers) {
    return { ok: false, reason: `Lobby penuh (maks ${maxPlayers} pemain).` };
  }
  if (isInSession(session, jid)) return { ok: false, reason: 'Kamu sudah ada di lobby.' };
  session.players.push({
    jid,
    name,
    role: null,
    alive: true,
    protectedLastNight: false,
    lastProtectedIdx: null,
  });
  return { ok: true, players: session.players };
}

export function leaveLobby(session, jid) {
  if (!isLobby(session)) return { ok: false, reason: 'Tidak bisa keluar, permainan sudah dimulai.' };
  if (session.hostJid === jid) {
    return { ok: false, reason: 'Host tidak bisa keluar. Ketik /ww exit untuk membatalkan lobby.' };
  }
  const idx = getPlayerIdx(session, jid);
  if (idx === -1) return { ok: false, reason: 'Kamu belum join.' };
  session.players.splice(idx, 1);
  return { ok: true, players: session.players };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function startGame(session) {
  if (!isLobby(session)) return { ok: false, reason: 'Game sudah berjalan.' };
  const n = session.players.length;
  if (n < minPlayers) {
    return { ok: false, reason: `Minimal ${minPlayers} pemain, baru ada ${n}.` };
  }
  const roleList = distribution[String(n)];
  if (!roleList) {
    return { ok: false, reason: `Jumlah pemain ${n} tidak didukung.` };
  }
  const shuffledRoles = shuffle(roleList);
  session.players.forEach((p, i) => {
    p.role = shuffledRoles[i];
    p.alive = true;
    p.protectedLastNight = false;
    p.lastProtectedIdx = null;
  });
  session.day = 1;
  session.phase = PHASES.NIGHT;
  session.nightActions = { kills: {}, seerChecks: {}, protects: {} };
  session.dayVotes = {};
  return { ok: true, session };
}

export function getAlivePlayers(session) {
  return session.players
    .map((p, i) => ({ ...p, idx: i }))
    .filter((p) => p.alive);
}

export function getAliveIdxList(session) {
  return session.players
    .map((p, i) => (p.alive ? i : -1))
    .filter((i) => i !== -1);
}

export function getPlayerListText(session, opts = {}) {
  const { mention = false } = opts;
  const list = session.players
    .map((p, i) => {
      const status = p.alive ? '🟢' : '💀';
      const num = p.jid.split('@')[0].split(':')[0];
      const name = mention ? `@${num} ${p.name}` : p.name;
      return `  ${i + 1}. ${status} ${name}`;
    })
    .join('\n');
  return `👥 *Pemain (${session.players.length}):*\n${list}`;
}

export function getAliveListText(session, opts = {}) {
  const { mention = false } = opts;
  const alive = session.players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.alive);
  const list = alive
    .map(({ p, i }) => {
      const num = p.jid.split('@')[0].split(':')[0];
      const name = mention ? `@${num} ${p.name}` : p.name;
      return `  ${i + 1}. 🟢 ${name}`;
    })
    .join('\n');
  return `👥 *Pemain Hidup (${alive.length}):*\n${list}`;
}

export function getPlayerMentions(session) {
  return session.players.map((p) => p.jid);
}

export function getAliveMentions(session) {
  return session.players.filter((p) => p.alive).map((p) => p.jid);
}

export function getStatusText(session) {
  if (session.phase === PHASES.LOBBY) {
    return `🏘️ *WOLVESVILLE — LOBBY*\n\n${getPlayerListText(session)}\n\n` +
      `Host: @${session.hostJid.split('@')[0]}\n` +
      `Minimal: ${minPlayers} | Maksimal: ${maxPlayers}\n\n` +
      `Ketik /ww join untuk gabung\n` +
      `Ketik /ww start untuk mulai (khusus host)`;
  }
  if (session.phase === PHASES.ENDED) {
    const aliveText = session.players
      .map((p, i) => `  ${i + 1}. ${p.alive ? '🟢' : '💀'} ${p.name} — ${roles[p.role]?.name || p.role}`)
      .join('\n');
    return `🏁 *WOLVESVILLE — BERAKHIR*\n\n${aliveText}\n\n` +
      `🏆 Pemenang: *${session.winner || '-'}*\n` +
      (session.winReason ? `📝 ${session.winReason}\n` : '');
  }
  const alive = getAlivePlayers(session);
  const wolves = alive.filter((p) => p.role === 'werewolf').length;
  const villagers = alive.length - wolves;
  let phaseLabel;
  if (session.phase === PHASES.NIGHT) phaseLabel = '🌙 Malam';
  else if (session.votingOpen) phaseLabel = '☀️ Siang — 🗳️ Voting dibuka';
  else phaseLabel = '☀️ Siang — 💬 Diskusi';
  return `🌙 *WOLVESVILLE — Hari ${session.day}*\n` +
    `Fase: *${phaseLabel}*\n` +
    `👥 Pemain hidup: ${alive.length} (🐺 ${wolves} | 🏘️ ${villagers})\n` +
    `💀 Sudah mati: ${session.players.length - alive.length}`;
}

export function checkWin(session) {
  const alive = session.players.filter((p) => p.alive);
  const wolves = alive.filter((p) => p.role === 'werewolf').length;
  const villagers = alive.length - wolves;
  if (wolves === 0) {
    return { ended: true, winner: '🏘️ Desa', reason: 'Semua Serigala berhasil dilenyapkan!' };
  }
  if (wolves >= villagers) {
    return { ended: true, winner: '🐺 Serigala', reason: 'Serigala menguasai desa!' };
  }
  return { ended: false };
}

export function getRoleRevealText(session) {
  return session.players
    .map((p, i) => `  ${i + 1}. ${p.alive ? '🟢' : '💀'} ${p.name} — ${roles[p.role]?.name || p.role} ${roles[p.role]?.emoji || ''}`)
    .join('\n');
}

export function endGame(session, winner, reason) {
  session.phase = PHASES.ENDED;
  session.winner = winner;
  session.winReason = reason;
  return session;
}

export function cancelLobby(session) {
  session.phase = PHASES.ENDED;
  session.winner = '-';
  session.winReason = 'Lobby dibatalkan.';
  return session;
}

export function startNight(session) {
  session.phase = PHASES.NIGHT;
  session.nightActions = { kills: {}, seerChecks: {}, protects: {} };
  return session;
}

export function startDay(session) {
  session.phase = PHASES.DAY;
  session.dayVotes = {};
  session.day = (session.day || 1) + (session.phase_was_night ? 0 : 0);
  return session;
}

function tallyVotes(voteMap) {
  const tally = {};
  Object.values(voteMap).forEach((target) => {
    tally[target] = (tally[target] || 0) + 1;
  });
  return tally;
}

export function getNightActionStatus(session) {
  const alive = getAliveIdxList(session);
  const wolves = session.players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.alive && p.role === 'werewolf');
  const seers = session.players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.alive && p.role === 'seer');
  const bodyguards = session.players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.alive && p.role === 'bodyguard');

  const wolfDone = wolves.length === 0 || wolves.every(({ i }) => session.nightActions.kills[i] !== undefined);
  const seerDone = seers.length === 0 || seers.every(({ i }) => session.nightActions.seerChecks[i] !== undefined);
  const bgDone = bodyguards.length === 0 || bodyguards.every(({ i }) => session.nightActions.protects[i] !== undefined);

  return { wolfDone, seerDone, bgDone, allDone: wolfDone && seerDone && bgDone };
}

export function processWerewolfKill(session, wolfIdx, targetIdx) {
  if (wolfIdx < 0 || wolfIdx >= session.players.length) {
    return { ok: false, reason: 'Serigala tidak ada di game ini.' };
  }
  if (session.players[wolfIdx].role !== 'werewolf' || !session.players[wolfIdx].alive) {
    return { ok: false, reason: 'Kamu bukan Serigala yang hidup.' };
  }
  if (targetIdx < 0 || targetIdx >= session.players.length) {
    return { ok: false, reason: 'Target tidak valid.' };
  }
  if (!session.players[targetIdx].alive) {
    return { ok: false, reason: 'Target sudah mati.' };
  }
  if (targetIdx === wolfIdx) {
    return { ok: false, reason: 'Tidak bisa membunuh diri sendiri.' };
  }
  session.nightActions.kills[wolfIdx] = targetIdx;
  return { ok: true };
}

export function processSeerCheck(session, seerIdx, targetIdx) {
  if (seerIdx < 0 || seerIdx >= session.players.length) {
    return { ok: false, reason: 'Dukun tidak ada di game ini.' };
  }
  if (session.players[seerIdx].role !== 'seer' || !session.players[seerIdx].alive) {
    return { ok: false, reason: 'Kamu bukan Dukun yang hidup.' };
  }
  if (targetIdx < 0 || targetIdx >= session.players.length) {
    return { ok: false, reason: 'Target tidak valid.' };
  }
  if (!session.players[targetIdx].alive) {
    return { ok: false, reason: 'Target sudah mati.' };
  }
  if (targetIdx === seerIdx) {
    return { ok: false, reason: 'Tidak bisa menyelidiki diri sendiri.' };
  }
  session.nightActions.seerChecks[seerIdx] = targetIdx;
  const target = session.players[targetIdx];
  return {
    ok: true,
    result: target.role === 'werewolf' ? '🐺 SERIGALA' : '🏘️ BUKAN Serigala',
    targetName: target.name,
  };
}

export function processBodyguardProtect(session, bgIdx, targetIdx) {
  if (bgIdx < 0 || bgIdx >= session.players.length) {
    return { ok: false, reason: 'Bodyguard tidak ada di game ini.' };
  }
  if (session.players[bgIdx].role !== 'bodyguard' || !session.players[bgIdx].alive) {
    return { ok: false, reason: 'Kamu bukan Bodyguard yang hidup.' };
  }
  if (targetIdx < 0 || targetIdx >= session.players.length) {
    return { ok: false, reason: 'Target tidak valid.' };
  }
  if (!session.players[targetIdx].alive) {
    return { ok: false, reason: 'Target sudah mati.' };
  }
  if (session.players[bgIdx].lastProtectedIdx === targetIdx) {
    return { ok: false, reason: 'Tidak boleh melindungi orang yang sama dua malam berturut-turut.' };
  }
  session.nightActions.protects[bgIdx] = targetIdx;
  return { ok: true };
}

export function resolveNight(session) {
  const wolves = session.players
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.alive && p.role === 'werewolf');

  let killTarget = null;
  if (wolves.length > 0) {
    const tally = tallyVotes(
      Object.fromEntries(
        Object.entries(session.nightActions.kills).filter(([k]) =>
          session.players[Number(k)] && session.players[Number(k)].alive && session.players[Number(k)].role === 'werewolf',
        ),
      ),
    );
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) {
      const [topTarget, topCount] = sorted[0];
      const ties = sorted.filter(([, c]) => c === topCount);
      killTarget = ties.length > 1
        ? Number(ties[Math.floor(Math.random() * ties.length)][0])
        : Number(topTarget);
    } else {
      killTarget = -1;
    }
  }

  const protectTarget = Object.values(session.nightActions.protects)[0];

  let killed = null;
  let saved = false;
  if (killTarget !== null && killTarget >= 0) {
    if (killTarget === protectTarget) {
      saved = true;
    } else {
      session.players[killTarget].alive = false;
      killed = { idx: killTarget, name: session.players[killTarget].name };
      if (session.players[killTarget].role === 'hunter') {
        session.pendingHunter = killTarget;
      }
    }
  }

  const seerResults = Object.entries(session.nightActions.seerChecks).map(([seerIdx, targetIdx]) => {
    const seer = session.players[Number(seerIdx)];
    const target = session.players[targetIdx];
    return {
      seerIdx: Number(seerIdx),
      seerName: seer.name,
      targetIdx,
      targetName: target.name,
      result: target.role === 'werewolf' ? 'SERIGALA' : 'BUKAN_SERIGALA',
    };
  });

  const bgLastProtected = Object.values(session.nightActions.protects)[0];
  const bgIdx = session.players.findIndex((p) => p.role === 'bodyguard');
  if (bgIdx !== -1 && bgLastProtected !== undefined) {
    session.players[bgIdx].lastProtectedIdx = bgLastProtected;
  }

  session.phase = PHASES.DAY;
  session.day = (session.day || 1);
  session.votingOpen = false;

  return { killed, saved, seerResults, protectTarget };
}

export function openVoting(session) {
  if (session.phase !== PHASES.DAY) return false;
  session.votingOpen = true;
  return true;
}

export function isVotingOpen(session) {
  return session && session.phase === PHASES.DAY && session.votingOpen === true;
}

export function processVote(session, voterIdx, targetIdx) {
  const voter = session.players[voterIdx];
  if (!voter || !voter.alive) return { ok: false, reason: 'Pemain sudah mati tidak bisa vote.' };
  if (!isVotingOpen(session)) return { ok: false, reason: 'Voting belum dibuka (masih masa diskusi).' };
  if (targetIdx === -1) {
    delete session.dayVotes[voterIdx];
    return { ok: true, cleared: true };
  }
  if (targetIdx < 0 || targetIdx >= session.players.length) {
    return { ok: false, reason: 'Target tidak valid.' };
  }
  if (!session.players[targetIdx].alive) {
    return { ok: false, reason: 'Target sudah mati.' };
  }
  if (targetIdx === voterIdx) {
    return { ok: false, reason: 'Tidak bisa vote diri sendiri.' };
  }
  session.dayVotes[voterIdx] = targetIdx;
  return { ok: true };
}

export function getVoteTally(session) {
  const tally = {};
  Object.entries(session.dayVotes).forEach(([voterIdx, targetIdx]) => {
    if (session.players[voterIdx] && session.players[voterIdx].alive) {
      tally[targetIdx] = (tally[targetIdx] || 0) + 1;
    }
  });
  return tally;
}

export function resolveVote(session) {
  const tally = getVoteTally(session);
  const entries = Object.entries(tally).map(([k, v]) => [Number(k), v]);
  session.votingOpen = false;
  if (entries.length === 0) {
    return { lynched: null, reason: 'Tidak ada vote. Tidak ada yang digantung.' };
  }
  entries.sort((a, b) => b[1] - a[1]);
  const [topTarget, topCount] = entries[0];
  const ties = entries.filter(([, c]) => c === topCount);
  if (ties.length > 1) {
    return { lynched: null, reason: `Vote seri (${topCount} suara masing-masing). Tidak ada yang digantung.` };
  }
  session.players[topTarget].alive = false;
  let hunterTrigger = null;
  if (session.players[topTarget].role === 'hunter') {
    session.pendingHunter = topTarget;
    hunterTrigger = { idx: topTarget, name: session.players[topTarget].name };
  }
  return {
    lynched: { idx: topTarget, name: session.players[topTarget].name, votes: topCount },
    hunterTrigger,
    reason: `${session.players[topTarget].name} digantung dengan ${topCount} suara.`,
  };
}

export function processHunterShoot(session, hunterIdx, targetIdx) {
  if (session.pendingHunter !== hunterIdx) {
    return { ok: false, reason: 'Kamu tidak punya hak menembak.' };
  }
  if (targetIdx < 0 || targetIdx >= session.players.length) {
    return { ok: false, reason: 'Target tidak valid.' };
  }
  if (!session.players[targetIdx].alive) {
    return { ok: false, reason: 'Target sudah mati.' };
  }
  session.players[targetIdx].alive = false;
  session.pendingHunter = null;
  return {
    ok: true,
    target: { idx: targetIdx, name: session.players[targetIdx].name, role: session.players[targetIdx].role },
  };
}

export function clearPendingHunter(session) {
  session.pendingHunter = null;
  return session;
}

export function getPlayerRolePM(session, jid) {
  const idx = getPlayerIdx(session, jid);
  if (idx === -1) return null;
  const p = session.players[idx];
  const r = roles[p.role];
  if (!r) return null;
  return {
    name: p.name,
    role: p.role,
    roleName: r.name,
    emoji: r.emoji,
    team: r.team,
    desc: r.desc,
    alive: p.alive,
  };
}

export function getWerewolfTeamPM(session, jid) {
  const idx = getPlayerIdx(session, jid);
  if (idx === -1) return null;
  if (session.players[idx].role !== 'werewolf') return null;
  return session.players
    .map((p, i) => ({ idx: i, ...p }))
    .filter((p) => p.role === 'werewolf')
    .map((p) => ({ idx: p.idx, name: p.name, alive: p.alive }));
}

export default {
  PHASES,
  getConfig,
  getRoleInfo,
  getRoleListText,
  createLobby,
  isLobby,
  isInGame,
  isEnded,
  getPlayerIdx,
  isInSession,
  joinLobby,
  leaveLobby,
  startGame,
  getAlivePlayers,
  getAliveIdxList,
  getPlayerListText,
  getAliveListText,
  getPlayerMentions,
  getAliveMentions,
  getStatusText,
  checkWin,
  getRoleRevealText,
  endGame,
  cancelLobby,
  startNight,
  resolveNight,
  openVoting,
  isVotingOpen,
  processWerewolfKill,
  processSeerCheck,
  processBodyguardProtect,
  getNightActionStatus,
  processVote,
  getVoteTally,
  resolveVote,
  processHunterShoot,
  clearPendingHunter,
  getPlayerRolePM,
  getWerewolfTeamPM,
};