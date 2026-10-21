/**
 * Google Drive OAuth2 token setup.
 * Run `node auth/generateToken.js`, authorize in the browser, and the callback
 * on the configured localhost redirect automatically updates GOOGLE_REFRESH_TOKEN
 * in .env. Credentials and tokens are never printed to the terminal.
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];
const ENV_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
const REDIRECT_URI = (process.env.GOOGLE_REDIRECT_URI || 'http://localhost').trim();
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
const execAsync = promisify(exec);

function validateEnv() {
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    throw new Error(`Variabel .env belum diisi: ${missing.join(', ')}`);
  }

  let redirect;
  try {
    redirect = new URL(REDIRECT_URI);
  } catch {
    throw new Error('GOOGLE_REDIRECT_URI tidak valid. Gunakan http://localhost untuk callback lokal.');
  }
  if (redirect.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(redirect.hostname)) {
    throw new Error('Generator ini hanya mendukung redirect localhost melalui HTTP demi keamanan.');
  }
  if (redirect.username || redirect.password || redirect.search || redirect.hash || redirect.port && redirect.port !== '80') {
    throw new Error('GOOGLE_REDIRECT_URI tidak boleh berisi kredensial, query, atau hash.');
  }
  return redirect;
}

function updateEnvValue(contents, key, value) {
  const escaped = value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '');
  const line = `${key}=${escaped}`;
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  if (pattern.test(contents)) return contents.replace(pattern, line);
  const suffix = contents.length && !contents.endsWith('\n') ? '\n' : '';
  return `${contents}${suffix}${line}\n`;
}

async function saveRefreshToken(refreshToken) {
  let contents = '';
  try {
    contents = await readFile(ENV_PATH, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const updated = updateEnvValue(contents, 'GOOGLE_REFRESH_TOKEN', refreshToken);
  // Write the .env file directly; it is ignored by git. Preserve existing config.
  await writeFile(ENV_PATH, updated, { encoding: 'utf8', mode: 0o600 });
}

function createOAuth2Client(redirectUri) {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID.trim(),
    process.env.GOOGLE_CLIENT_SECRET.trim(),
    redirectUri,
  );
}

function waitForAuthorizationCode(oauth2Client, redirect) {
  return new Promise((resolve, reject) => {
    const callbackPath = redirect.pathname || '/';
    let completed = false;
    const finish = (error, code) => {
      if (completed) return;
      completed = true;
      clearTimeout(timeout);
      server.close(() => {});
      if (error) reject(error);
      else resolve(code);
    };

    const server = createServer((request, response) => {
      let requestUrl;
      try {
        requestUrl = new URL(request.url || '/', REDIRECT_URI);
      } catch {
        response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Permintaan callback tidak valid. Tutup halaman ini.');
        return;
      }

      if (requestUrl.pathname !== callbackPath) {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Callback OAuth tidak ditemukan.');
        return;
      }
      if (requestUrl.searchParams.get('error')) {
        const providerError = requestUrl.searchParams.get('error');
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<h2>Otorisasi Google tidak berhasil.</h2><p>Kamu bisa menutup halaman ini dan mencoba lagi di terminal.</p>');
        finish(new Error(`Google menolak otorisasi: ${providerError}`));
        return;
      }

      const code = requestUrl.searchParams.get('code');
      const state = requestUrl.searchParams.get('state');
      if (!code || state !== oauth2Client._oauth2ClientState) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end('<h2>Callback OAuth tidak lengkap atau tidak valid.</h2><p>Tutup halaman ini lalu jalankan generator kembali.</p>');
        finish(new Error('Callback Google tidak berisi kode atau state yang valid.'));
        return;
      }

      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html lang="id"><meta charset="utf-8"><title>Google Drive terhubung</title><body style="font-family:system-ui;max-width:36rem;margin:4rem auto;padding:0 1rem"><h2>Otorisasi Google berhasil</h2><p>Kamu bisa menutup tab ini dan kembali ke terminal bot.</p></body></html>');
      finish(null, code);
    });

    const timeout = setTimeout(() => finish(new Error('Waktu otorisasi habis setelah 5 menit. Jalankan ulang generator.')), CALLBACK_TIMEOUT_MS);
    timeout.unref?.();
    server.on('error', (error) => finish(new Error(`Tidak bisa membuka callback localhost: ${error.message}`)));
    server.listen(Number(redirect.port || 80), redirect.hostname === '[::1]' ? '::1' : redirect.hostname, () => {
      console.log(`Callback OAuth siap di ${redirect.origin}${callbackPath}`);
    });
  });
}

async function main() {
  console.log('Google Drive OAuth2 Token Setup\n');
  const redirect = validateEnv();
  const oauth2Client = createOAuth2Client(REDIRECT_URI);
  // State validation protects the localhost callback from unrelated requests.
  const stateValue = randomBytes(24).toString('hex');
  oauth2Client._oauth2ClientState = stateValue;
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
    state: stateValue,
  });

  console.log('Selesaikan persetujuan di browser yang akan dibuka.');
  console.log(`Jika browser tidak terbuka, salin URL ini:\n${authUrl}\n`);
  const callbackPromise = waitForAuthorizationCode(oauth2Client, redirect);
  try {
    if (process.platform === 'win32') {
      await execAsync(`start "" "${authUrl}"`, { windowsHide: true, shell: 'cmd.exe' });
    } else if (process.platform === 'darwin') {
      await execAsync('open "$URL"', { env: { ...process.env, URL: authUrl } });
    } else {
      await execAsync('xdg-open "$URL"', { env: { ...process.env, URL: authUrl } });
    }
  } catch {
    console.log('Browser otomatis tidak bisa dibuka; silakan buka URL di atas secara manual.');
  }

  try {
    const code = await callbackPromise;
    console.log('Kode otorisasi diterima; menukar kode dengan token...');
    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
      throw new Error('Google tidak mengirim refresh token. Cabut akses aplikasi di https://myaccount.google.com/permissions lalu jalankan ulang generator.');
    }

    await saveRefreshToken(tokens.refresh_token);
    // Update this process too (the dotenv values are loaded once at startup).
    process.env.GOOGLE_REFRESH_TOKEN = tokens.refresh_token;
    console.log(`GOOGLE_REFRESH_TOKEN berhasil diperbarui di ${ENV_PATH}.`);
    console.log('Jangan bagikan token tersebut. Restart bot agar konfigurasi baru digunakan.');
  } catch (error) {
    console.error(`Gagal menyiapkan Google Drive OAuth: ${error.message}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`Gagal menyiapkan Google Drive OAuth: ${error.message}`);
  process.exitCode = 1;
});
