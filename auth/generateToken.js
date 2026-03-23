/**
 * Google OAuth2 Token Generator
 * 
 * Script ini digunakan SEKALI untuk mendapatkan refresh token.
 * Jalankan: node auth/generateToken.js
 * 
 * Prerequisites:
 * 1. Buat project di Google Cloud Console
 * 2. Enable Google Drive API
 * 3. Buat OAuth2 credentials (Desktop App type)
 * 4. Copy Client ID dan Client Secret ke .env
 */

import 'dotenv/config';
import { google } from 'googleapis';
import readline from 'readline';

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

function validateEnv() {
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\nPlease add these to your .env file:\n');
    console.error(`GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost
GOOGLE_DRIVE_FOLDER_ID=optional_folder_id
DRIVE_PUBLIC=0`);
    process.exit(1);
  }
}

function createOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl(oauth2Client) {
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent' // Force to get refresh_token
  });
}

async function getAccessToken(oauth2Client, code) {
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(query, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  console.log('🔐 Google OAuth2 Token Generator\n');
  console.log('=' .repeat(50));
  
  validateEnv();
  
  const oauth2Client = createOAuth2Client();
  const authUrl = getAuthUrl(oauth2Client);
  
  console.log('\n📋 Instructions:');
  console.log('1. Open this URL in your browser:');
  console.log('\n   ' + authUrl + '\n');
  console.log('2. Login with your Google account (Gmail personal 15GB)');
  console.log('3. Grant permission for Google Drive access');
  console.log('4. Copy the authorization code from the URL bar');
  console.log('   (after redirect, it will be like: http://localhost/?code=4/xxx...)');
  console.log('   Paste ONLY the code part (4/xxx...)\n');
  
  const code = await askQuestion('📝 Enter authorization code: ');
  
  if (!code.trim()) {
    console.error('❌ No code provided. Exiting.');
    process.exit(1);
  }
  
  try {
    console.log('\n⏳ Exchanging code for tokens...');
    const tokens = await getAccessToken(oauth2Client, code.trim());
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ SUCCESS! Tokens received:\n');
    
    if (tokens.refresh_token) {
      console.log('🔑 GOOGLE_REFRESH_TOKEN (SAVE THIS!):');
      console.log(tokens.refresh_token);
      console.log('\n⚠️  IMPORTANT: Add this to your .env file:\n');
      console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    } else {
      console.log('⚠️  Warning: No refresh_token received!');
      console.log('   This might happen if you already authorized before.');
      console.log('   Try revoking access at https://myaccount.google.com/permissions');
      console.log('   Then run this script again.\n');
    }
    
    console.log('📊 Other token info:');
    console.log('   Access Token expires in:', tokens.expiry_date 
      ? new Date(tokens.expiry_date).toLocaleString()
      : 'Unknown');
    console.log('   Scope:', tokens.scope);
    
    console.log('\n' + '='.repeat(50));
    console.log('🎉 Setup complete! Add the refresh token to your .env');
    console.log('   and restart your bot.\n');
    
  } catch (error) {
    console.error('\n❌ Error getting tokens:', error.message);
    if (error.message.includes('invalid_grant')) {
      console.error('\n💡 The authorization code may have expired.');
      console.error('   Please generate a new URL and try again.');
    }
    process.exit(1);
  }
}

main();
