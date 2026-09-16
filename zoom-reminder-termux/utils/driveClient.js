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
    process.env.GOGLE_GOOGLE_CLIENT_SECRET,
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
    throw new Error(`Failed to connect to Google Drive: ${error.message}`);
  }
}

export default {
  getOAuthClient,
  getDriveClient,
  testConnection
};
