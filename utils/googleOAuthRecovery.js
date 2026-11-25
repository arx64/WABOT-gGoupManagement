import { randomBytes } from 'node:crypto';
import { getOAuthClient, updateGoogleRefreshToken } from './driveClient.js';

const CALLBACK_PATH = '/oauth/google/callback';
const FLOW_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_JOBS = 10;

let activeFlow = null;

function getPublicRedirectUri() {
  const value = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
  let uri;
  try {
    uri = new URL(value);
  } catch {
    throw new Error(`Set GOOGLE_REDIRECT_URI ke URL callback HTTPS publik yang berakhir dengan ${CALLBACK_PATH}.`);
  }
  if (uri.protocol !== 'https:' || uri.hostname === 'localhost' || uri.hostname === '127.0.0.1') {
    throw new Error(`Auto OAuth dari WhatsApp memerlukan GOOGLE_REDIRECT_URI HTTPS publik, misalnya https://domain-kamu.example${CALLBACK_PATH}.`);
  }
  if (uri.pathname !== CALLBACK_PATH || uri.search || uri.hash || uri.username || uri.password) {
    throw new Error(`GOOGLE_REDIRECT_URI harus menggunakan path ${CALLBACK_PATH} tanpa query/hash.`);
  }
  return uri.toString();
}

function errorChain(error) {
  const parts = [];
  for (let current = error, depth = 0; current && depth < 5; current = current.cause, depth += 1) {
    parts.push(String(current.message || ''));
    parts.push(String(current.response?.data?.error || ''));
    parts.push(String(current.response?.data?.error_description || ''));
  }
  return parts.join(' ').toLowerCase();
}

export function isGoogleReauthRequired(error) {
  const text = errorChain(error);
  return text.includes('invalid_grant') ||
    text.includes('invalid refresh token') ||
    text.includes('refresh token has been expired') ||
    text.includes('refresh token sudah kedaluwarsa/dicabut');
}

function htmlPage(title, message) {
  const safeTitle = String(title).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const safeMessage = String(message).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  return `<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><body style="font:16px system-ui;max-width:42rem;margin:3rem auto;padding:0 1rem"><h2>${safeTitle}</h2><p>${safeMessage}</p></body></html>`;
}

async function notifyOwner(flow, message) {
  try {
    const sock = flow.sock;
    if (sock && flow.ownerJid) await sock.sendMessage(flow.ownerJid, { text: message });
  } catch (error) {
    console.error('[GoogleOAuthRecovery] Tidak bisa mengirim notifikasi WhatsApp:', error.message);
  }
}

/** Queue a /see Drive upload and send one Google consent link to the owner. */
export async function queueGoogleOAuthRecovery({ jobId, run, sock, ownerJid }) {
  if (!jobId || typeof run !== 'function') throw new Error('Data pekerjaan OAuth tidak lengkap.');
  if (!ownerJid) throw new Error('OWNER_NUMBER belum diatur; tidak dapat mengirim link autentikasi ke owner.');
  const redirectUri = getPublicRedirectUri();

  if (activeFlow && Date.now() - activeFlow.createdAt > FLOW_TTL_MS) {
    await notifyOwner(activeFlow, '⚠️ Sesi autentikasi Google sebelumnya kedaluwarsa. Jalankan ulang /see untuk meminta link baru.');
    activeFlow = null;
  }

  if (activeFlow?.jobs.has(jobId)) return { alreadyPending: true };
  if (activeFlow && activeFlow.jobs.size >= MAX_PENDING_JOBS) {
    throw new Error('Sudah ada terlalu banyak upload /see yang menunggu autentikasi. Selesaikan autentikasi Google terlebih dahulu.');
  }

  const oauth = getOAuthClient();
  if (!activeFlow) {
    const state = randomBytes(32).toString('hex');
    const authUrl = oauth.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/drive'],
      prompt: 'consent',
      include_granted_scopes: true,
      state,
    });
    activeFlow = { state, redirectUri, createdAt: Date.now(), jobs: new Map(), sock, ownerJid, authUrl };
  }

  activeFlow.jobs.set(jobId, run);
  activeFlow.sock = sock;
  activeFlow.ownerJid = ownerJid;

  if (activeFlow.jobs.size === 1) {
    try {
      await sock.sendMessage(ownerJid, {
        text: '🔐 *Autentikasi ulang Google Drive diperlukan*\n\nRefresh token Google ditolak. Buka link resmi berikut, login ke akun Google pemilik Drive, lalu setujui akses. Setelah callback berhasil, upload /see yang tertunda akan dilanjutkan otomatis.\n\n' + activeFlow.authUrl + '\n\n⏳ Link berlaku sekitar 10 menit. Jangan bagikan link ini ke orang lain.',
      });
    } catch (error) {
      activeFlow.jobs.delete(jobId);
      activeFlow = null;
      throw new Error(`Tidak bisa mengirim link OAuth ke WhatsApp owner: ${error.message}`);
    }
  } else {
    try {
      await sock.sendMessage(ownerJid, {
        text: `📥 Upload /see ditambahkan ke antrean autentikasi. Total menunggu: ${activeFlow.jobs.size}. Selesaikan link Google yang sudah dikirim sebelumnya.`,
      });
    } catch (error) {
      // The original consent link was already sent. Keep the queued job so the callback can resume it.
      console.warn('[GoogleOAuthRecovery] Gagal mengirim notifikasi antrean tambahan:', error.message);
    }
  }
  return { alreadyPending: false };
}

export function registerGoogleOAuthRecoveryRoutes(app) {
  app.get('/oauth/google', (req, res) => {
    try {
      const redirectUri = getPublicRedirectUri();
      const oauth = getOAuthClient({ requireRefreshToken: false });
      const state = randomBytes(32).toString('hex');
      activeFlow = {
        state,
        redirectUri,
        createdAt: Date.now(),
        jobs: new Map(),
        sock: null,
        ownerJid: null,
        authUrl: null,
      };
      const authUrl = oauth.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/drive'],
        prompt: 'consent',
        include_granted_scopes: true,
        state,
      });
      activeFlow.authUrl = authUrl;
      return res.redirect(authUrl);
    } catch (error) {
      console.error('[GoogleOAuthRecovery] Start OAuth gagal:', error.message);
      return res.status(500).type('html').send(htmlPage('OAuth belum siap', error.message));
    }
  });

  app.get(CALLBACK_PATH, async (req, res) => {
    const flow = activeFlow;
    if (!flow || Date.now() - flow.createdAt > FLOW_TTL_MS) {
      activeFlow = null;
      return res.status(410).type('html').send(htmlPage('Sesi OAuth kedaluwarsa', 'Kembali ke WhatsApp dan jalankan /see lagi untuk meminta link baru.'));
    }
    if (req.query.state !== flow.state) {
      return res.status(400).type('html').send(htmlPage('Callback tidak valid', 'Parameter state tidak cocok. Demi keamanan, permintaan ditolak.'));
    }
    if (req.query.error) {
      activeFlow = null;
      await notifyOwner(flow, `❌ Autentikasi Google dibatalkan atau ditolak (${String(req.query.error).slice(0, 80)}). Jalankan /see lagi untuk mencoba ulang.`);
      return res.status(400).type('html').send(htmlPage('Autentikasi tidak selesai', 'Google tidak menyelesaikan persetujuan. Kembali ke WhatsApp dan coba lagi.'));
    }
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code) return res.status(400).type('html').send(htmlPage('Callback tidak lengkap', 'Kode otorisasi tidak ditemukan.'));

    try {
      const oauth = getOAuthClient();
      // The OAuth client already contains the exact redirect URI from .env.
      const { tokens } = await oauth.getToken(code);
      if (!tokens.refresh_token) {
        throw new Error('Google tidak memberikan refresh token baru. Cabut akses aplikasi di akun Google lalu jalankan /see lagi.');
      }
      await updateGoogleRefreshToken(tokens.refresh_token, tokens);

      // Detach the flow before executing jobs so repeated callback requests cannot run them twice.
      activeFlow = null;
      const jobs = [...flow.jobs.entries()];
      let succeeded = 0;
      for (const [jobId, run] of jobs) {
        try {
          await run();
          succeeded += 1;
        } catch (error) {
          console.error(`[GoogleOAuthRecovery] Resume job gagal (${jobId}):`, error.message);
          await notifyOwner(flow, `⚠️ Token Google berhasil diperbarui, tetapi satu upload /see gagal dilanjutkan. Jalankan /see ulang untuk file tersebut. Detail: ${error.message}`);
        }
      }
      await notifyOwner(flow, `✅ Autentikasi Google selesai. ${succeeded}/${jobs.length} upload /see tertunda berhasil dilanjutkan.`);
      return res.status(200).type('html').send(htmlPage('Google Drive terhubung', `Autentikasi berhasil. ${succeeded} dari ${jobs.length} upload tertunda telah dilanjutkan. Kamu bisa kembali ke WhatsApp.`));
    } catch (error) {
      console.error('[GoogleOAuthRecovery] Callback gagal:', error.message);
      await notifyOwner(flow, `❌ Callback Google gagal: ${error.message}. Jalankan /see lagi untuk mencoba ulang.`);
      activeFlow = null;
      return res.status(500).type('html').send(htmlPage('Autentikasi gagal', 'Token tidak berhasil diperbarui. Kembali ke WhatsApp untuk melihat petunjuk dan mencoba lagi.'));
    }
  });
}
