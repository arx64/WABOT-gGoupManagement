import axios from 'axios';
import dayjs from 'dayjs';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Fungsi untuk memformat tanggal ke format DD-MM-YYYY
const formatTanggal = (tanggal) => {
  return dayjs(tanggal).format('DD-MM-YYYY');
};
const EDLINK_SITE_LOGIN_URL = 'https://api.edlink.id/api/v1.4/site/login';
const EDLINK_SSO_LOGIN_URL = 'https://api.edlink.id/api/v1.4/sso/login';
const EDLINK_SCHEDULE_URL = 'https://api.edlink.id/api/v1.4/account/weekly-schedules';
let loginPromise = null;

function edlinkHeaders(extra = {}) {
  return {
    accept: 'application/json, text/plain, */*',
    'content-type': 'application/json',
    'x-app-locale': 'id',
    origin: 'https://www.edlink.id',
    referer: 'https://www.edlink.id/',
    'user-agent': 'Mozilla/5.0',
    ...extra,
  };
}

function saveBearerToken(token) {
  const envPath = path.resolve(process.cwd(), '.env');
  let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const bearerLine = `EDLINK_BEARER=${token}`;

  if (/^EDLINK_BEARER=.*$/m.test(envContent)) {
    envContent = envContent.replace(/^EDLINK_BEARER=.*$/m, bearerLine);
  } else {
    envContent = `${envContent.trimEnd()}${envContent ? '\n' : ''}${bearerLine}\n`;
  }

  fs.writeFileSync(envPath, envContent, 'utf8');
  process.env.EDLINK_BEARER = token;
}

async function  loginEdlink(opts = {}) {
  const email = process.env.EDLINK_EMAIL || opts.email;
  const password = process.env.EDLINK_PASSWORD || opts.password;
  const debug = typeof opts.debug === 'function' ? opts.debug : null;
  const trace = (label, value) => { if (debug) debug(`SSO ${label}`, value); };
  if (!email || !password) throw new Error('EDLINK_EMAIL dan EDLINK_PASSWORD belum dikonfigurasi');

  const loginBody = {
    username: '', app_id: '', email, password, web_reg_id: null,
    device: JSON.stringify({ secureId: 'zoom-reminder', name: 'Node.js', manufacture: 'Node.js', model: 'Node.js', product: 'zoom-reminder', hardware: process.platform, version: process.version, regId: null }),
  };
  trace('SITE LOGIN REQUEST', { url: EDLINK_SITE_LOGIN_URL, method: 'POST', headers: edlinkHeaders({ 'x-referer': 'https://www.edlink.id/login' }), body: loginBody });
  const loginResponse = await fetch(EDLINK_SITE_LOGIN_URL, {
    method: 'POST',
    headers: edlinkHeaders({ 'x-referer': 'https://www.edlink.id/login' }),
    body: JSON.stringify(loginBody),
  });
  const loginPayload = await loginResponse.json().catch(() => ({}));
  trace('SITE LOGIN RESPONSE', { url: EDLINK_SITE_LOGIN_URL, status: loginResponse.status, statusText: loginResponse.statusText, headers: Object.fromEntries(loginResponse.headers.entries()), body: loginPayload });
  const token = loginPayload?.data?.userToken?.token;
  if (!loginResponse.ok || !token) throw new Error(`EdLink login gagal (${loginResponse.status})`);

  const ssoBody = { email, password, redirect_uri: `https://api.edlink.id/sso/auth?token=${encodeURIComponent(token)}` };
  trace('SSO LOGIN REQUEST', { url: EDLINK_SSO_LOGIN_URL, method: 'POST', headers: edlinkHeaders({ 'x-referer': 'https://www.edlink.id/login' }), body: ssoBody });
  const ssoResponse = await fetch(EDLINK_SSO_LOGIN_URL, {
    method: 'POST',
    headers: edlinkHeaders({ 'x-referer': 'https://www.edlink.id/login' }),
    body: JSON.stringify(ssoBody),
  });
  const ssoPayload = await ssoResponse.json().catch(() => ({}));
  trace('SSO LOGIN RESPONSE', { url: EDLINK_SSO_LOGIN_URL, status: ssoResponse.status, statusText: ssoResponse.statusText, headers: Object.fromEntries(ssoResponse.headers.entries()), body: ssoPayload });
  let authUrl = ssoPayload?.data?.url;
  if (!ssoResponse.ok || !authUrl) throw new Error(`EdLink SSO login gagal (${ssoResponse.status})`);

  for (let redirect = 0; redirect < 10; redirect += 1) {
    trace('REDIRECT REQUEST', { redirect: redirect + 1, url: authUrl, method: 'GET', redirectMode: 'manual', headers: edlinkHeaders() });
    const response = await fetch(authUrl, { redirect: 'manual', headers: edlinkHeaders() });
    const location = response.headers.get('location');
    trace('REDIRECT RESPONSE', { redirect: redirect + 1, url: authUrl, status: response.status, statusText: response.statusText, headers: Object.fromEntries(response.headers.entries()), location });
    if (!location) break;
    authUrl = new URL(location, authUrl).toString();
    const authTarget = new URL(authUrl);
    if (authTarget.hostname === 'edlink.id' && authTarget.pathname === '/classes' && authTarget.searchParams.get('t') === token) {
      saveBearerToken(token);
      return token;
    }
  }
  throw new Error('EdLink SSO tidak mengarah ke halaman classes dengan token valid');
}

export async function refreshBearerToken(opts = {}) {
  if (!loginPromise) loginPromise = loginEdlink(opts).finally(() => { loginPromise = null; });
  return loginPromise;
}

async function fetchWeeklySchedule(bearer) {
  return axios.get(EDLINK_SCHEDULE_URL, {
    headers: { ...edlinkHeaders(), authorization: `Bearer ${bearer}` },
    validateStatus: () => true,
  });
}

export async function fetchData(opts = {}) {
  let result = '';

  let bearer = process.env.EDLINK_BEARER || opts.bearer;
  if (!bearer) {
    try {
      bearer = await refreshBearerToken(opts);
    } catch (loginError) {
      console.error('EdLink auto-login gagal:', loginError.message);
      return 'Error: EDLINK_BEARER belum diset di file .env';
    }
  }

  try {
    let response = await fetchWeeklySchedule(bearer);

    if ([401, 403].includes(response.status) || !response.data.data || response.data.applicationSystem?.message === 'Silakan refresh halaman Anda atau login kembali') {
      try {
        bearer = await refreshBearerToken(opts);
        response = await fetchWeeklySchedule(bearer);
      } catch (loginError) {
        console.error('EdLink auto-login gagal:', loginError.message);
        return 'Error: Authorization token tidak valid atau sesi berakhir.';
      }

      if ([401, 403].includes(response.status) || !response.data.data || response.data.applicationSystem?.message === 'Silakan refresh halaman Anda atau login kembali') {
        return 'Error: Authorization token tidak valid atau sesi berakhir.';
      }
    }

    for (const hariData of response.data.data) {
      const tanggal = formatTanggal(hariData.date);
      const hari = hariData.day;

      if (!hariData.sections || hariData.sections.length === 0) {
        result += `Tanggal: ${tanggal}\nHari: ${hari}\nTidak ada perkuliahan.\n\n`;
        continue;
      }

      for (const section of hariData.sections) {
        const matkul = section.group?.name ?? '-';
        const kelas = section.group?.className ?? '-';
        const metode = section.learningMethod ?? '-';
        const mulai = section.startedAt?.split(' ')[1] ?? '-';
        const selesai = section.endedAt?.split(' ')[1] ?? '-';
        const ruang = section.room ?? '-';
        const status = section.progressLabel ?? 'Belum selesai';
        const pertemuan = section.meet ?? '-';

        result += `Tanggal: ${tanggal}\nHari: ${hari}\nPertemuan: ${pertemuan}\nStatus: ${status}\nMata Kuliah: ${matkul} - ${kelas} (${metode})\nJam: ${mulai} - ${selesai}\nRuangan: ${ruang}\n\n`;
      }
    }

    return result;
  } catch (error) {
    console.error(error);
    return `Terjadi kesalahan saat mengambil data.\nError: ${error}`;
  }
}
