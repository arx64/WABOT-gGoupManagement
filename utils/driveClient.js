/**
 * Google Drive Client with OAuth2
 * 
 * Menggunakan OAuth2 user account (Gmail personal)
 * dengan auto-refresh access token via refresh_token
 */

import 'dotenv/config';
import { google } from 'googleapis';

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
  
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  // Set credentials with refresh token
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  // Listen for token refresh events
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      console.log('[DriveClient] Access token refreshed automatically');
    }
    // Google normally reuses the original refresh token. If a new one is ever
    // issued, don't log it; the running process can continue with the client
    // credentials already updated by google-auth-library.
  });

  return oauth2Client;
}

/**
 * Get Google Drive API client
 * @returns {drive_v3.Drive} Drive API client
 */
export function getDriveClient() {
  const auth = getOAuthClient();
  return google.drive({ version: 'v3', auth });
}

/**
 * Test Drive connection and get user info
 * @returns {Promise<Object>} User info
 */
export async function testConnection() {
  try {
    const drive = getDriveClient();
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
  testConnection
};
