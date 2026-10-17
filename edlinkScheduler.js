import { refreshBearerToken } from './jadwalKelas.js';
import db from './db.js';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import localeData from 'dayjs/plugin/localeData.js';
import localizedFormat from 'dayjs/plugin/localizedFormat.js';
import 'dayjs/locale/id.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(localeData);
dayjs.extend(localizedFormat);
dayjs.locale('id');

const TZ = process.env.TIMEZONE || 'Asia/Jakarta';

// Poll Edlink open assignments/quizzes and send reminders at configured offsets.
// Requires environment variables:
// EDLINK_BEARER - required Bearer token for Authorization header
// EDLINK_NOTIFY_JID - JID to send reminders to (group or user)

const EDLINK_URL = 'https://api.edlink.id/api/v1.4/home/openassignmentsandquizes';
const EDLINK_FETCH_TIMEOUT_MS = Number(process.env.EDLINK_FETCH_TIMEOUT_MS || 60000);
const EDLINK_FETCH_RETRIES = Number(process.env.EDLINK_FETCH_RETRIES || 4);
const EDLINK_REFRESH_RETRIES = Number(process.env.EDLINK_REFRESH_RETRIES || 3);
// Diagnostic request/response logging is opt-in; keep it off during normal operation.
const EDLINK_DEBUG_LOGS = ['1', 'true', 'yes', 'on'].includes(String(process.env.EDLINK_DEBUG_LOGS || 'false').toLowerCase());

let edlinkInterval = null;
let edlinkFetchRunning = false;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (/authorization|bearer|password|passwd|email|user.?token|access.?token|refresh.?token|secret|cookie|set-cookie/i.test(key)) {
        return [key, typeof item === 'string' && /^Bearer\s/i.test(item) ? 'Bearer [REDACTED]' : '[REDACTED]'];
      }
      return [key, redactSecrets(item)];
    }));
  }
  if (typeof value === 'string') {
    return value
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
      .replace(/([?&](?:token|access_token|refresh_token|password)=)[^&\s]+/gi, '$1[REDACTED]')
      .replace(/("(?:token|access_token|refresh_token|password|email|secret)"\s*:\s*)"[^"]*"/gi, '$1"[REDACTED]"');
  }
  return value;
}

function debugEdlink(label, value) {
  if (!EDLINK_DEBUG_LOGS) return;
  let safeValue = redactSecrets(value);
  if (typeof safeValue !== 'string') {
    try { safeValue = JSON.stringify(safeValue, null, 2); } catch { safeValue = String(safeValue); }
  }
  console.log(`[Edlink reminders][DEBUG] ${label}\n${safeValue}`);
}

function isTransientEdlinkError(err) {
  const errorCodes = new Set([
    'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENETUNREACH',
    'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET',
  ]);
  let cause = err;
  let retryable = err?.name === 'AbortError' || err?.name === 'TimeoutError';
  for (let depth = 0; cause && depth < 6; depth += 1, cause = cause.cause) {
    if (errorCodes.has(cause.code)) retryable = true;
  }
  return retryable;
}

// Reminders have their own retry policy; keep /tugas and /jadwal untouched.
async function refreshSchedulerBearer(opts = {}) {
  let lastError;
  for (let attempt = 0; attempt < EDLINK_REFRESH_RETRIES; attempt += 1) {
    try {
      debugEdlink('SSO refresh dimulai', { attempt: attempt + 1, maxAttempts: EDLINK_REFRESH_RETRIES });
      const token = await refreshBearerToken({ ...opts, debug: debugEdlink });
      debugEdlink('SSO refresh berhasil', { tokenReceived: Boolean(token), tokenLength: token?.length });
      return token;
    } catch (err) {
      lastError = err;
      debugEdlink('SSO refresh gagal', { attempt: attempt + 1, message: err.message, stack: err.stack, cause: err.cause ? { message: err.cause.message, code: err.cause.code } : null });
      if (attempt === EDLINK_REFRESH_RETRIES - 1) break;
      const waitMs = 1500 * (2 ** attempt);
      console.warn(`[Edlink reminders] SSO refresh gagal; percobaan ${attempt + 2}/${EDLINK_REFRESH_RETRIES} dalam ${waitMs / 1000}s: ${err.message}`);
      await delay(waitMs);
    }
  }
  throw lastError;
}

async function fetchEdlink(url, options) {
  for (let attempt = 0; attempt <= EDLINK_FETCH_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EDLINK_FETCH_TIMEOUT_MS);

    try {
      debugEdlink('HTTP REQUEST', {
        attempt: attempt + 1,
        maxAttempts: EDLINK_FETCH_RETRIES + 1,
        url,
        method: options.method || 'GET',
        headers: options.headers,
        body: options.body ? (() => { try { return JSON.parse(options.body); } catch { return options.body; } })() : null,
        timeoutMs: EDLINK_FETCH_TIMEOUT_MS,
      });
      const response = await fetch(url, { ...options, signal: controller.signal });
      // Consume the body while the timeout is still active; fetch() alone only
      // guarantees that response headers have arrived, not that the body did.
      const responseText = await response.text();
      debugEdlink('HTTP RESPONSE', {
        url: response.url || url,
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        redirected: response.redirected,
        headers: Object.fromEntries(response.headers.entries()),
        bodyText: responseText,
      });
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        bodyText: responseText,
        json: async () => responseText ? JSON.parse(responseText) : {},
      };
    } catch (err) {
      debugEdlink('HTTP NETWORK ERROR', { url, attempt: attempt + 1, name: err.name, message: err.message, code: err.code || err.cause?.code, cause: err.cause ? { name: err.cause.name, message: err.cause.message, code: err.cause.code } : null, stack: err.stack });
      if (!isTransientEdlinkError(err) || attempt === EDLINK_FETCH_RETRIES) throw err;
      const waitMs = 1000 * (2 ** attempt);
      console.warn(`[Edlink] Request gagal (${err?.cause?.code || err?.code || err?.name || 'network error'}), percobaan ${attempt + 1}/${EDLINK_FETCH_RETRIES}; mencoba lagi dalam ${waitMs / 1000}s.`);
      await delay(waitMs);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function fetchReminderAssignments(bearer) {
  const res = await fetchEdlink(EDLINK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      accept: 'application/json, text/plain, */*',
      'x-app-locale': 'id',
      'x-referer': 'https://edlink.id/panel/',
      'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache',
      pragma: 'no-cache',
      priority: 'u=1, i',
      origin: 'https://edlink.id',
      referer: 'https://edlink.id/',
    },
    body: JSON.stringify({
      dataProvider: JSON.stringify({
        criterion: [],
        page: { count: 0, current: 1, limit: 5, next: 0, previous: 0, total: 0 },
        sort: [],
      }),
      accept_assessment_team: true,
    }),
  });
  const payload = await res.json().catch(() => ({}));
  debugEdlink('PARSED API OUTPUT', {
    status: res.status,
    statusText: res.statusText,
    responseHeaders: res.headers,
    applicationMessage: payload?.applicationSystem?.message ?? null,
    dataIsNull: payload?.data == null,
    responseKeys: Object.keys(payload || {}),
    itemCount: Array.isArray(payload?.data?.data) ? payload.data.data.length : null,
    payload,
  });
  return { res, payload };
}

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

// Edlink academic period code: <tahun><nomor semester>, e.g. 20251, 20252, 20261, 20262.
// One year is split into 2 semesters: Jan-Jun -> 1, Jul-Dec -> 2.
// Override via EDLINK_PERIODE env or opts.periode when the campus calendar differs.
export function currentAcademicPeriod(date = new Date()) {
  const d = dayjs(date).tz(TZ);
  return `${d.year()}${d.month() < 6 ? 1 : 2}`;
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
  let bearer = process.env.EDLINK_BEARER || opts.bearer;
  const notifyJid = process.env.EDLINK_NOTIFY_JID || opts.notifyJid;
  const offsets = opts.offsets ?? [60,30,15,10,5,3];
  const freq = opts.freqSeconds ?? 60; // check every minute

  if (!bearer) throw new Error('EDLINK_BEARER not configured');
  if (!notifyJid) throw new Error('EDLINK_NOTIFY_JID not configured');

  await ensureTable();

  if (edlinkInterval) clearInterval(edlinkInterval);

  edlinkInterval = setInterval(async () => {
    if (edlinkFetchRunning) return;
    edlinkFetchRunning = true;

    try {
      let { res, payload } = await fetchReminderAssignments(bearer);
      let sessionExpired = [401, 403].includes(res.status)
        || payload?.data == null
        || payload?.applicationSystem?.message === 'Silakan refresh halaman Anda atau login kembali';
      if (sessionExpired) {
        console.warn('[Edlink reminders] API menolak sesi; detail request/response dan alasan klasifikasi ada pada log DEBUG di atas.');
        debugEdlink('SESSION REJECTED - DIAGNOSIS', {
          httpStatus: res.status,
          applicationMessage: payload?.applicationSystem?.message ?? null,
          dataIsNull: payload?.data == null,
          responseKeys: Object.keys(payload || {}),
          reason: [401, 403].includes(res.status) ? 'HTTP 401/403' : payload?.data == null ? 'payload.data null/undefined' : 'applicationSystem meminta login ulang',
        });
        bearer = await refreshSchedulerBearer(opts);
        // Validate the newly saved token immediately, in this same cycle.
        ({ res, payload } = await fetchReminderAssignments(bearer));
        sessionExpired = [401, 403].includes(res.status)
          || payload?.data == null
          || payload?.applicationSystem?.message === 'Silakan refresh halaman Anda atau login kembali';
        if (sessionExpired) {
          console.error('[Edlink reminders] Token hasil login ulang masih ditolak API; lihat log DEBUG untuk request/response sebelum dan sesudah refresh.');
          return;
        }
      }
      if (!res.ok) {
        console.error('[Edlink reminders] API gagal:', res.status, res.statusText, res.bodyText);
        return;
      }
      const items = payload?.data?.data ?? [];
      const now = dayjs().tz(TZ);
      const nowHHMM = now.format('HH:mm');
      debugEdlink('REMINDER PROCESSING INPUT', { now: now.format(), timezone: TZ, nowHHMM, offsets, itemCount: items.length, items });

      for (const it of items) {
        // determine due date/time (dayjs in TZ)
        const rawDueAt = it.dueAt || it.publishedAtTimestamp || it.section?.endedAtTimestamp;
        // Many Edlink items have no deadline at all. Ignore them quietly; only
        // log a parse warning when a deadline value exists but is malformed.
        if (rawDueAt == null || rawDueAt === '') continue;

        const due = parseDueAt(rawDueAt);
        if (!due || !due.isValid()) {
          debugEdlink('ITEM SKIPPED - due time tidak bisa diparse', { id: it?.id, title: it?.title, dueAt: it?.dueAt, publishedAtTimestamp: it?.publishedAtTimestamp, sectionEndedAtTimestamp: it?.section?.endedAtTimestamp });
          continue;
        }

        for (const off of offsets) {
          const notifyTime = due.subtract(off, 'minute');
          const notifyHHMM = notifyTime.format('HH:mm');
          if (notifyHHMM !== nowHHMM) {
            debugEdlink('REMINDER OFFSET CHECK', { id: it.id, title: it.title, dueAt: due.format(), offsetMinutes: off, calculatedNotifyTime: notifyTime.format(), nowHHMM, notifyHHMM, matches: false });
            continue;
          }

          const today = notifyTime.format('YYYY-MM-DD');

          // already sent?
          const exists = await db('edlink_notifications').where({ external_id: String(it.id), notify_date: notifyTime.format('YYYY-MM-DD'), offset_min: off }).first();
          if (exists) {
            debugEdlink('REMINDER SKIPPED - sudah pernah dikirim', { externalId: String(it.id), notifyDate: notifyTime.format('YYYY-MM-DD'), offsetMinutes: off, existingRow: exists });
            continue;
          }

          // build message
          const title = it.title || (it.group?.name ?? 'Tugas/Quiz');
          const groupName = it.group?.className || it.group?.name || '';
          const link = (it.group?.description && (it.group.description.match(/https?:\/\/[^\"]+/) || [])[0]) || '';
          const text = `🔔 *EDLINK Reminder*\n${title}\nKelas: ${groupName}\nWaktu: ${due.format('LLLL')}\n(${off} menit lagi)\n${link}`;
          debugEdlink('REMINDER OUTPUT', { notifyJid, externalId: String(it.id), offsetMinutes: off, dueAt: due.format(), message: text });

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
      const code = err?.cause?.code || err?.code;
      if (isTransientEdlinkError(err)) {
        console.error(`[Edlink reminders] Network gagal setelah retry: ${err.message}${code ? ` (${code})` : ''}. Akan dicoba lagi pada polling berikutnya.`);
      } else {
        console.error('[Edlink reminders] Scheduler error:', err.message, code ? `(${code})` : '');
      }
    } finally {
      edlinkFetchRunning = false;
    }
  }, freq * 1000);
}

function stopEdlinkScheduler() { if (edlinkInterval) clearInterval(edlinkInterval); edlinkInterval = null; }

export { startEdlinkScheduler, stopEdlinkScheduler };
export default { startEdlinkScheduler, stopEdlinkScheduler };

// Fetch current open assignments/quizzes from Edlink API and return array of items
export async function fetchOpenAssignments(opts = {}) {
  let bearer = process.env.EDLINK_BEARER || opts.bearer;
  if (!bearer) throw new Error('EDLINK_BEARER not configured');

  for (let attempt = 0; attempt < 2; attempt += 1) {
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

    const payload = await res.json().catch(() => ({}));
    const sessionExpired = [401, 403].includes(res.status)
      || payload?.data == null
      || payload?.applicationSystem?.message === 'Silakan refresh halaman Anda atau login kembali';

    if (sessionExpired && attempt === 0) {
      bearer = await refreshBearerToken(opts);
      continue;
    }

    if (!res.ok) throw new Error(`Edlink fetch failed: ${res.status}`);
    if (sessionExpired) throw new Error('Authorization token tidak valid atau sesi berakhir.');

    return Array.isArray(payload?.data?.data) ? payload.data.data : [];
  }

  throw new Error('Authorization token tidak valid atau sesi berakhir.');
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
  // Period follows the current academic year/semester unless pinned via config.
  const periode = String(opts.periode || process.env.EDLINK_PERIODE || currentAcademicPeriod());
  const bearer = process.env.EDLINK_BEARER || opts.bearer;
  if (!bearer) throw new Error('EDLINK_BEARER not configured');

  // Fetch user profile to get correct university_user_id
  let universityUserId = null;

  try {
    const userRes = await fetch('https://api.edlink.id/api/v1.4/user/profile', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
        accept: 'application/json, text/plain, */*',
        'x-app-locale': 'id',
      },
    });

    if (userRes.ok) {
      const userPayload = await userRes.json();
      universityUserId = userPayload?.data?.id || userPayload?.data?.universityUserId;
    }
  } catch (err) {
    console.warn('Could not fetch user profile:', err.message);
  }

  // First fetch: get academic groups
  const academicRes = await fetch('https://api.edlink.id/api/v1.4/group/academic?with_inactive=1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      accept: 'application/json, text/plain, */*',
      'x-app-locale': 'id',
      'x-referer': 'https://edlink.id/classes',
      referer: 'https://edlink.id/',
      'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache',
      pragma: 'no-cache',
      priority: 'u=1, i',
      'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
    },
    body: JSON.stringify({
      university_user_id: universityUserId,
      dataProvider: JSON.stringify({
        criterion: [
          {
            operator: 'EQ',
            value: periode,
            criteria: 'periode',
          },
          {
            operator: 'LK',
            value: '',
            criteria: 'keyword',
            custom: true,
          },
          {
            operator: 'EQ',
            value: '',
            criteria: 'year',
            custom: true,
          },
        ],
        page: {
          current: 1,
        },
        sort: [],
      }),
    }),
  });

  if (!academicRes.ok) {
    const txt = await academicRes.text().catch(() => '');
    throw new Error(`Edlink academic fetch failed: ${academicRes.status} ${txt}`);
  }

  const academicPayload = await academicRes.json();
  const academicData = academicPayload?.data?.data || [];

  console.log(
    'Academic Groups:',
    academicData.map((g) => ({
      id: g.id,
      name: g.name,
      memberId: g.memberId,
    })),
  );

  const groupMemberIds = academicData.map((g) => g.memberId).filter(Boolean);

  console.log('groupMemberIds:', groupMemberIds);

  if (groupMemberIds.length === 0) {
    return [];
  }

  // Second fetch: get presence status for all groupMemberIds
  const presenceRes = await fetch('https://api.edlink.id/api/v1.4/group/presence-status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bearer}`,
      accept: 'application/json, text/plain, */*',
      'x-app-locale': 'id',
      'x-referer': 'https://edlink.id/classes',
      referer: 'https://edlink.id/',
      'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
      'cache-control': 'no-cache',
      pragma: 'no-cache',
      priority: 'u=1, i',
      'sec-ch-ua': '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
    },
    body: JSON.stringify({
      groupMemberIds,
    }),
  });

  if (!presenceRes.ok) {
    const txt = await presenceRes.text().catch(() => '');
    throw new Error(`Edlink presence-status fetch failed: ${presenceRes.status} ${txt}`);
  }

  const presencePayload = await presenceRes.json();
  const presenceData = presencePayload?.data || [];

  // Merge with academic data to include names
  const mergedData = presenceData.map((presenceItem) => {
    const academicItem = academicData.find((acad) => acad.id === presenceItem.groupId || acad.id === presenceItem.group?.id);

    return {
      ...presenceItem,
      name: academicItem?.name || 'Unknown',
    };
  });

  return mergedData;
}
