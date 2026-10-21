/**
 * Google Drive Client with OAuth2
 * 
 * Menggunakan OAuth2 user account (Gmail personal)
 * dengan auto-refresh access token via refresh_token
 */

import 'dotenv/config';
import { google } from 'googleapis';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ENV_PATH = path.resolve(process.cwd(), '.env');
let oauthClient;
let driveClient;
let refreshPromise;

function updateEnvValue(contents, key, value) {
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
  const line = `${key}=${value}`;
  if (pattern.test(contents)) return contents.replace(pattern, line);
  return `${contents}${contents && !contents.endsWith('\n') ? '\n' : ''}${line}\n`;
}

async function persistRefreshToken(token) {
  // A rotated refresh token is rare, but if Google issues one keep it across restarts.
  let contents = '';
  try {
    contents = await readFile(ENV_PATH, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await writeFile(ENV_PATH, updateEnvValue(contents, 'GOOGLE_REFRESH_TOKEN', token), {
    encoding: 'utf8',
    mode: 0o600,
  });
  process.env.GOOGLE_REFRESH_TOKEN = token;
}

// Validate required environment variables
function validateEnv() {
  const required = [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_REDIRECT_URI',
    'GOOGLE_REFRESH_TOKEN'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n` +
      missing.map(key => `  - ${key}`).join('\n') +
      `\n\nPlease set these in your .env file.\n` +
      `Run "node auth/generateToken.js" to get GOOGLE_REFRESH_TOKEN.`
    );
  }
}

/**
 * Create and configure OAuth2 client
 * @returns {OAuth2Client} Configured OAuth2 client
 */
export function getOAuthClient() {
  validateEnv();
  if (oauthClient) return oauthClient;

  oauthClient = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI,
  );

  // Set credentials with refresh token
  oauthClient.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  // Listen for token refresh events
  oauthClient.on('tokens', (tokens) => {
    if (tokens.access_token) {
      console.log('[DriveClient] Access token refreshed automatically');
    }
    if (tokens.refresh_token) {
      void persistRefreshToken(tokens.refresh_token).catch((error) => {
        console.error('[DriveClient] Gagal menyimpan refresh token baru ke .env:', error.message);
      });
    }
  });

  return oauthClient;
}

/** Proactively refresh the short-lived access token; concurrent calls share one refresh. */
export async function refreshGoogleAccessToken() {
  const auth = getOAuthClient();
  if (!refreshPromise) {
    refreshPromise = auth.getAccessToken()
      .then(({ token }) => {
        if (!token) throw new Error('Google OAuth tidak mengembalikan access token.');
        return token;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

/**
 * Get Google Drive API client
 * @returns {drive_v3.Drive} Drive API client
 */
export function getDriveClient() {
  if (!driveClient) driveClient = google.drive({ version: 'v3', auth: getOAuthClient() });
  return driveClient;
}

/**
 * Test Drive connection and get user info
 * @returns {Promise<Object>} User info
 */
export async function testConnection() {
  try {
    const drive = getDriveClient();
    await refreshGoogleAccessToken();
    const about = await drive.about.get({
      fields: 'user,storageQuota'
    });
    
    return {
      user: about.data.user,
      storageQuota: about.data.storageQuota,
      connected: true
    };
  } catch (error) {
    throw new Error(formatDriveAuthError(error));
  }
}

/** Return an actionable message for OAuth failures without exposing secrets. */
export function formatDriveAuthError(error) {
  const responseData = error?.response?.data || {};
  const code = String(responseData.error || error?.code || '');
  const description = String(responseData.error_description || error?.message || '');
  const message = `${code} ${description} ${error?.message || ''}`.toLowerCase();

  if (message.includes('invalid_grant')) {
    return 'Google Drive OAuth gagal: refresh token sudah kedaluwarsa/dicabut atau tidak cocok dengan OAuth Client ID. Auto-refresh hanya memperbarui access token; token ini tidak bisa dipulihkan otomatis. Buat refresh token baru dengan `node auth/generateToken.js`, simpan sebagai GOOGLE_REFRESH_TOKEN di .env, lalu restart bot.';
  }
  if (message.includes('invalid_client')) {
    return 'Google Drive OAuth gagal: GOOGLE_CLIENT_ID atau GOOGLE_CLIENT_SECRET tidak valid/tidak sepasang. Periksa kredensial OAuth di .env.';
  }
  return `Gagal terhubung ke Google Drive: ${error?.message || description || 'kesalahan tidak diketahui'}`;
}

export default {
  getOAuthClient,
  getDriveClient,
  refreshGoogleAccessToken,
  testConnection
};
