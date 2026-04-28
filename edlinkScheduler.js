import db from './db.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

dayjs.extend(utc);
dayjs.extend(timezone);

const TZ = process.env.TIMEZONE || 'Asia/Jakarta';

// Poll Edlink open assignments/quizzes and send reminders at configured offsets.
// Requires environment variables:
// EDLINK_BEARER - required Bearer token for Authorization header
// EDLINK_NOTIFY_JID - JID to send reminders to (group or user)

const EDLINK_URL = 'https://api.edlink.id/api/v1.4/home/openassignmentsandquizes';

let edlinkInterval = null;

async function ensureTable() {
  const exists = await db.schema.hasTable('edlink_notifications');
  if (!exists) {
    await db.schema.createTable('edlink_notifications', (table) => {
      table.increments('id');
      table.string('external_id');
      table.string('notify_date'); // YYYY-MM-DD
      table.integer('offset_min');
      table.timestamp('sent_at').defaultTo(db.fn.now());
    });
  }
}

function parseDueAt(dueAt) {
  if (!dueAt) return null;
  if (typeof dueAt === 'number') {
    if (dueAt < 1e12) dueAt = dueAt * 1000;
    return dayjs(dueAt).tz(TZ);
  }
  const parsed = Date.parse(dueAt);
  if (!isNaN(parsed)) return dayjs(parsed).tz(TZ);
  return null;
}

async function startEdlinkScheduler(sock, opts = {}) {
  const bearer = process.env.EDLINK_BEARER || opts.bearer;
  const notifyJid = process.env.EDLINK_NOTIFY_JID || opts.notifyJid;
  const offsets = opts.offsets ?? [10,5,3];
  const freq = opts.freqSeconds ?? 60; // check every minute

  if (!bearer) throw new Error('EDLINK_BEARER not configured');
  if (!notifyJid) throw new Error('EDLINK_NOTIFY_JID not configured');

  await ensureTable();

  if (edlinkInterval) clearInterval(edlinkInterval);

  edlinkInterval = setInterval(async () => {
    try {
      const res = await fetch(EDLINK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${bearer}`,
          'accept': 'application/json, text/plain, */*',
          'x-app-locale': 'id'
        },
        body: JSON.stringify({})
      });
      if (!res.ok) {
        console.error('Edlink fetch failed', res.status, await res.text());
        return;
      }
      const payload = await res.json();
      const items = payload?.data?.data ?? [];
      const now = dayjs().tz(TZ);
      const nowHHMM = now.format('HH:mm');

      for (const it of items) {
        // determine due date/time (dayjs in TZ)
        const due = parseDueAt(it.dueAt || it.publishedAtTimestamp || it.section?.endedAtTimestamp);
        if (!due) continue; // skip items without due time

        for (const off of offsets) {
          const notifyTime = due.subtract(off, 'minute');
          const notifyHHMM = notifyTime.format('HH:mm');
          if (notifyHHMM !== nowHHMM) continue;

          const today = notifyTime.format('YYYY-MM-DD');

          // already sent?
          const exists = await db('edlink_notifications').where({ external_id: String(it.id), notify_date: notifyTime.format('YYYY-MM-DD'), offset_min: off }).first();
          if (exists) continue;

          // build message
          const title = it.title || (it.group?.name ?? 'Tugas/Quiz');
          const groupName = it.group?.className || it.group?.name || '';
          const link = (it.group?.description && (it.group.description.match(/https?:\/\/[^\"]+/) || [])[0]) || '';
          const text = `🔔 *EDLINK Reminder*\n${title}\nKelas: ${groupName}\nWaktu: ${due.format('LLLL')}\n(${off} menit lagi)\n${link}`;

          try {
            await sock.sendMessage(notifyJid, { text });
            await db('edlink_notifications').insert({ external_id: String(it.id), notify_date: notifyTime.format('YYYY-MM-DD'), offset_min: off });
            console.log('Sent edlink reminder', it.id, off);
          } catch (err) {
            console.error('Failed to send edlink reminder', err);
          }
        }
      }
    } catch (err) {
      console.error('Edlink scheduler error', err);
    }
  }, freq * 1000);
}

function stopEdlinkScheduler() { if (edlinkInterval) clearInterval(edlinkInterval); edlinkInterval = null; }

export { startEdlinkScheduler, stopEdlinkScheduler };
export default { startEdlinkScheduler, stopEdlinkScheduler };

// Fetch current open assignments/quizzes from Edlink API and return array of items
export async function fetchOpenAssignments(opts = {}) {
  const bearer = process.env.EDLINK_BEARER || opts.bearer;
  if (!bearer) throw new Error('EDLINK_BEARER not configured');

  const res = await fetch(EDLINK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearer}`,
      'accept': 'application/json, text/plain, */*',
      'x-app-locale': 'id'
    },
    body: JSON.stringify({})
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Edlink fetch failed: ${res.status} ${txt}`);
  }

  const payload = await res.json();
  return payload?.data?.data ?? [];
}

export async function fetchPresenceStatus(opts = {}) {
  const bearer = process.env.EDLINK_BEARER || opts.bearer;
  const groupMemberIds = opts.groupMemberIds || [];
  if (!bearer) throw new Error('EDLINK_BEARER not configured');
  if (!Array.isArray(groupMemberIds) || groupMemberIds.length === 0) {
    throw new Error('groupMemberIds tidak boleh kosong');
  }

  const res = await fetch('https://api.edlink.id/api/v1.4/group/presence-status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearer}`,
      'accept': 'application/json, text/plain, */*',
      'x-app-locale': 'id',
      'referer': 'https://edlink.id/',
      'origin': 'https://edlink.id'
    },
    body: JSON.stringify({ groupMemberIds })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Edlink presence-status fetch failed: ${res.status} ${txt}`);
  }

  const payload = await res.json();
  return payload?.data || [];
}

export async function fetchAllPresenceStatus(opts = {}) {
  const bearer = process.env.EDLINK_BEARER || opts.bearer;
  if (!bearer) throw new Error('EDLINK_BEARER not configured');

  // First fetch: get academic groups
  const academicRes = await fetch('https://api.edlink.id/api/v1.4/group/academic?with_inactive=1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearer}`,
      'accept': 'application/json, text/plain, */*',
      'x-app-locale': 'id',
      'x-referer': 'https://edlink.id/classes',
      'referer': 'https://edlink.id/',
      'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'priority': 'u=1, i',
      'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site'
    },
    body: JSON.stringify({
      "university_user_id": 1865853,
      "dataProvider": {
        "criterion": [
          {"operator": "EQ", "value": "20252", "criteria": "periode"},
          {"operator": "LK", "value": "", "criteria": "keyword", "custom": true},
          {"operator": "EQ", "value": "", "criteria": "year", "custom": true}
        ],
        "page": {"count": 1, "current": 1, "limit": 10, "next": -1, "previous": -1, "total": 0, "last_page": 1},
        "sort": [
          {"criteria": "status", "order": "asc"},
          {"criteria": "id", "order": "desc"}
        ]
      }
    })
  });

  if (!academicRes.ok) {
    const txt = await academicRes.text().catch(() => '');
    throw new Error(`Edlink academic fetch failed: ${academicRes.status} ${txt}`);
  }

  const academicPayload = await academicRes.json();
  const academicData = academicPayload?.data || [];
  const groupMemberIds = academicData.map(item => item.id).filter(id => id);

  if (groupMemberIds.length === 0) {
    return [];
  }

  // Second fetch: get presence status for all groupMemberIds
  const presenceRes = await fetch('https://api.edlink.id/api/v1.4/group/presence-status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${bearer}`,
      'accept': 'application/json, text/plain, */*',
      'x-app-locale': 'id',
      'x-referer': 'https://edlink.id/classes',
      'referer': 'https://edlink.id/',
      'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache',
      'pragma': 'no-cache',
      'priority': 'u=1, i',
      'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site'
    },
    body: JSON.stringify({ groupMemberIds })
  });

  if (!presenceRes.ok) {
    const txt = await presenceRes.text().catch(() => '');
    throw new Error(`Edlink presence-status fetch failed: ${presenceRes.status} ${txt}`);
  }

  const presencePayload = await presenceRes.json();
  const presenceData = presencePayload?.data || [];

  // Merge with academic data to include names
  const mergedData = presenceData.map(presenceItem => {
    const academicItem = academicData.find(acad => acad.id === presenceItem.groupId || acad.id === presenceItem.group?.id);
    return {
      ...presenceItem,
      name: academicItem?.name || 'Unknown'
    };
  });

  return mergedData;
}

