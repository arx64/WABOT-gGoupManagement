import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import { getDriveClient } from './utils/driveClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_MONTHS = [1, 3, 4, 5, 6];
const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export function getConfiguredUktMonths(value = process.env.UKT_MONTHS) {
  if (value == null || !String(value).trim()) return [...DEFAULT_MONTHS];

  const months = String(value).split(',').map((part) => {
    const normalized = part.trim().toLocaleLowerCase('id-ID');
    const byNumber = Number(normalized);
    if (/^\d{1,2}$/.test(normalized) && Number.isInteger(byNumber) && byNumber >= 1 && byNumber <= 12) {
      return byNumber;
    }
    const byName = MONTH_NAMES.findIndex((month) => month.toLocaleLowerCase('id-ID') === normalized);
    if (byName >= 0) return byName + 1;
    throw new Error(`Bulan UKT tidak dikenal: "${part.trim()}". Gunakan nama bulan Indonesia atau angka 1-12.`);
  });

  return [...new Set(months)].sort((a, b) => a - b);
}

export function getUktMonthName(month) {
  return MONTH_NAMES[Number(month) - 1] || 'Bulan tidak dikenal';
}

export function getUktDateParts(date = new Date(), timeZone = process.env.TZ || 'Asia/Jakarta') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month)) throw new Error('Tidak bisa menentukan tahun/bulan UKT.');
  return { year, month, monthName: getUktMonthName(month) };
}

export function sanitizeUktFilename(name) {
  const cleaned = String(name || 'bukti-ukt').trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/[. ]+$/g, '')
    .slice(0, 150);
  return cleaned || 'bukti-ukt';
}

export function getUktLocalDirectory(rootDir, year, month) {
  return path.join(rootDir, 'uploads', 'ukt', String(year), getUktMonthName(month));
}

function unwrapMessage(message) {
  let current = message;
  for (let i = 0; i < 6 && current; i += 1) {
    const wrapped = current.ephemeralMessage?.message
      || current.viewOnceMessage?.message
      || current.viewOnceMessageV2?.message
      || current.viewOnceMessageV2Extension?.message
      || current.documentWithCaptionMessage?.message;
    if (!wrapped) break;
    current = wrapped;
  }
  return current || {};
}

function getImageMessage(messageObject) {
  const content = unwrapMessage(messageObject?.message);
  return content.imageMessage ? { content, media: content.imageMessage } : null;
}

function getRootDriveFolderId() {
  return (process.env.UKT_DRIVE_ROOT_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
}

async function ensureDriveFolder(drive, name, parentId = null) {
  const clauses = [
    "mimeType = 'application/vnd.google-apps.folder'",
    `name = '${String(name).replace(/'/g, "\\'")}'`,
    'trashed = false',
  ];
  if (parentId) clauses.push(`'${String(parentId).replace(/'/g, "\\'")}' in parents`);

  const result = await drive.files.list({
    q: clauses.join(' and '),
    pageSize: 100,
    orderBy: 'createdTime',
    fields: 'files(id,name,mimeType,parents)',
    ...(parentId ? {} : { corpora: 'user' }),
  });
  const folder = result.data.files?.[0];
  if (folder?.id) return folder.id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id,name',
  });
  if (!created.data.id) throw new Error(`Google Drive tidak mengembalikan ID folder ${name}.`);
  return created.data.id;
}

export async function ensureUktDriveFolder(drive, year, month) {
  const rootId = getRootDriveFolderId();
  const yearId = await ensureDriveFolder(drive, String(year), rootId || null);
  const monthName = getUktMonthName(month);
  const monthId = await ensureDriveFolder(drive, monthName, yearId);
  return { yearId, monthId, monthName };
}

async function downloadImage(sock, messageObj) {
  const downloaded = await downloadMediaMessage(
    messageObj,
    'buffer',
    {},
    { reuploadRequest: sock.updateMediaMessage },
  );
  if (!Buffer.isBuffer(downloaded) || downloaded.length === 0) throw new Error('Gambar yang diunduh kosong.');
  return downloaded;
}

async function uploadDriveBuffer(drive, folderId, filename, buffer, mimeType) {
  const created = await drive.files.create({
    requestBody: { name: filename, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id,name,webViewLink,mimeType,parents',
  });
  if (!created.data.id) throw new Error('Google Drive tidak mengembalikan ID file.');
  return created.data;
}

async function ensureManifest() {
  const manifestPath = path.join(__dirname, 'uploads', 'ukt', 'manifest.json');
  await fs.mkdir(path.dirname(manifestPath), { recursive: true });
  try {
    const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    if (Array.isArray(parsed)) return { manifestPath, records: parsed };
  } catch (error) {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }
  return { manifestPath, records: [] };
}

async function saveManifestRecord(record) {
  const { manifestPath, records } = await ensureManifest();
  records.push(record);
  const temporaryPath = `${manifestPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  await fs.rename(temporaryPath, manifestPath);
}

export async function listUktPayments({ rootDir = __dirname, configuredMonths = getConfiguredUktMonths() } = {}) {
  const result = [];
  const localRoot = path.join(rootDir, 'uploads', 'ukt');
  const manifestPath = path.join(localRoot, 'manifest.json');
  try {
    let records = [];
    try {
      const parsed = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      if (Array.isArray(parsed)) records = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
    }
    for (const record of records) {
      if (record?.year && record?.month && record?.filename) {
        result.push({ ...record, source: record.source || 'local' });
      }
    }
  } catch (error) {
    console.warn('[UKT] Manifest lokal tidak bisa dibaca:', error.message);
  }

  async function walkLocal(directory, relative = '') {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.name === 'manifest.json' || entry.name.endsWith('.tmp')) continue;
      const fullPath = path.join(directory, entry.name);
      const relPath = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        await walkLocal(fullPath, relPath);
        continue;
      }
      const [year, monthName] = relPath.split(path.sep);
      const month = MONTH_NAMES.findIndex((name) => name === monthName) + 1;
      if (!/^\d{4}$/.test(year || '') || !month) continue;
      if (!result.some((record) => record.localPath === fullPath)) {
        result.push({ year: Number(year), month, monthName, filename: entry.name, source: 'local', localPath: fullPath });
      }
    }
  }

  await walkLocal(localRoot);

  const unique = new Map();
  for (const record of result) {
    const key = `${record.year}-${record.month}-${record.filename}`;
    const previous = unique.get(key);
    if (!previous || (previous.source !== 'drive' && record.source === 'drive')) unique.set(key, record);
  }

  return [...unique.values()].sort((a, b) => b.year - a.year || b.month - a.month || a.filename.localeCompare(b.filename));
}

function makeRecord({ year, month, filename, source, localPath, driveFileId, driveLink, uploader, uploadedAt }) {
  return {
    year,
    month,
    monthName: getUktMonthName(month),
    filename,
    source,
    ...(localPath ? { localPath } : {}),
    ...(driveFileId ? { driveFileId } : {}),
    ...(driveLink ? { driveLink } : {}),
    ...(uploader ? { uploader } : {}),
    uploadedAt,
  };
}

export async function handleUktCommand(messageObj, sock, remoteJid, numberUser, chatMessage) {
  const command = String(chatMessage || '').trim();
  if (!/^\/ukt(?:\s|$)/i.test(command)) return false;

  const args = command.replace(/^\/ukt\b/i, '').trim().toLocaleLowerCase('id-ID');
  if (args === 'list') {
    const months = getConfiguredUktMonths();
    let records = await listUktPayments({ configuredMonths: months });
    let remoteError = null;

    try {
      const drive = getDriveClient();
      const rootId = getRootDriveFolderId();
      const qParts = ["mimeType = 'application/vnd.google-apps.folder'", "trashed = false"];
      if (rootId) qParts.push(`'${rootId.replace(/'/g, "\\'")}' in parents`);
      const yearsResponse = await drive.files.list({
        q: qParts.join(' and '),
        pageSize: 1000,
        orderBy: 'name',
        fields: 'files(id,name,mimeType)',
        ...(rootId ? {} : { corpora: 'user' }),
      });
      const years = (yearsResponse.data.files || []).filter((item) => /^\d{4}$/.test(item.name));
      for (const yearFolder of years) {
        const monthResponse = await drive.files.list({
          q: `'${yearFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          pageSize: 1000,
          fields: 'files(id,name,mimeType)',
        });
        for (const monthFolder of monthResponse.data.files || []) {
          const month = MONTH_NAMES.findIndex((name) => name === monthFolder.name) + 1;
          if (!month) continue;
          const fileResponse = await drive.files.list({
            q: `'${monthFolder.id}' in parents and trashed = false`,
            pageSize: 1000,
            orderBy: 'name',
            fields: 'files(id,name,mimeType,webViewLink,createdTime)',
          });
          for (const file of fileResponse.data.files || []) {
            if (file.mimeType === 'application/vnd.google-apps.folder') continue;
            records.push({
              year: Number(yearFolder.name), month, monthName: monthFolder.name,
              filename: file.name, source: 'drive', driveFileId: file.id,
              driveLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
              uploadedAt: file.createdTime,
            });
          }
        }
      }
    } catch (error) {
      remoteError = error;
      console.warn('[UKT] Tidak bisa membaca daftar Google Drive:', error.message);
    }

    const seen = new Set();
    records = records.filter((record) => {
      if (!months.includes(Number(record.month))) return false;
      const key = `${record.year}-${record.month}-${record.filename}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const paidPeriods = new Set(records.map((record) => `${record.year}-${record.month}`));
    const years = [...new Set(records.map((record) => Number(record.year)))].sort((a, b) => b - a);
    const lines = [];
    for (const year of years) {
      const monthsForYear = months.filter((month) => paidPeriods.has(`${year}-${month}`));
      lines.push(`*${year}*`, ...monthsForYear.map((month) => `✅ ${getUktMonthName(month)}`), '');
    }
    let response = `🎓 *DAFTAR BUKTI PEMBAYARAN UKT*\n\n`;
    if (lines.length) response += `${lines.join('\n').trim()}\n\n`;
    else response += 'Belum ada bukti UKT yang ditemukan di Google Drive atau penyimpanan lokal.\n\n';
    response += `Bulan yang dipantau: ${months.map(getUktMonthName).join(', ')}.\n`;
    if (years.length) {
      const notRecorded = years.flatMap((year) => months
        .filter((month) => !paidPeriods.has(`${year}-${month}`))
        .map((month) => `• ${getUktMonthName(month)} ${year}`));
      if (notRecorded.length) {
        response += `\nBelum ada bukti untuk:\n${notRecorded.join('\n')}\n`;
      }
    }
    if (remoteError) response += '⚠️ Google Drive tidak bisa diperiksa; daftar ini hanya berdasarkan data lokal.\n';
    response += `Total bulan tercatat: ${paidPeriods.size}.`;
    await sock.sendMessage(remoteJid, { text: response }, { quoted: messageObj });
    return true;
  }

  const image = getImageMessage(messageObj);
  if (!image) {
    await sock.sendMessage(remoteJid, {
      text: '🎓 *Simpan bukti UKT*\n\nKirim gambar dengan caption `/ukt` untuk menyimpannya otomatis.\nKetik `/ukt list` untuk melihat tahun/bulan yang sudah ada buktinya.\n\nBulan aktif diatur melalui `UKT_MONTHS` pada file `.env`.',
    }, { quoted: messageObj });
    return true;
  }

  const dateParts = getUktDateParts();
  await sock.sendMessage(remoteJid, {
    text: `🎓 Menerima bukti UKT. Menyimpan ke folder ${dateParts.year}/${dateParts.monthName}…`,
  }, { quoted: messageObj });

  let buffer;
  try {
    buffer = await downloadImage(sock, messageObj);
  } catch (error) {
    console.error('[UKT] Gagal mengunduh gambar:', error);
    await sock.sendMessage(remoteJid, { text: `❌ Gagal mengunduh gambar: ${error.message}` }, { quoted: messageObj });
    return true;
  }

  const media = image.media;
  const ext = media.mimetype === 'image/png' ? '.png'
    : media.mimetype === 'image/webp' ? '.webp'
      : media.mimetype === 'image/gif' ? '.gif' : '.jpg';
  const filename = sanitizeUktFilename(media.fileName || `UKT_${dateParts.year}_${String(dateParts.month).padStart(2, '0')}_${Date.now()}${ext}`);
  const uploadedAt = new Date().toISOString();
  let record;

  try {
    const drive = getDriveClient();
    const { monthId } = await ensureUktDriveFolder(drive, dateParts.year, dateParts.month);
    const file = await uploadDriveBuffer(drive, monthId, filename, buffer, media.mimetype || 'image/jpeg');
    record = makeRecord({
      ...dateParts, filename, source: 'drive', driveFileId: file.id,
      driveLink: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      uploader: String(numberUser || ''), uploadedAt,
    });
  } catch (driveError) {
    console.error('[UKT] Upload Drive gagal, fallback ke lokal:', driveError.message);
    try {
      const directory = getUktLocalDirectory(__dirname, dateParts.year, dateParts.month);
      await fs.mkdir(directory, { recursive: true });
      let localPath = path.join(directory, filename);
      try {
        await fs.access(localPath);
        const extname = path.extname(filename);
        const basename = path.basename(filename, extname);
        localPath = path.join(directory, `${basename}_${Date.now()}${extname}`);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await fs.writeFile(localPath, buffer, { flag: 'wx' });
      record = makeRecord({
        ...dateParts, filename: path.basename(localPath), source: 'local', localPath,
        uploader: String(numberUser || ''), uploadedAt,
      });
    } catch (localError) {
      console.error('[UKT] Fallback lokal gagal:', localError);
      await sock.sendMessage(remoteJid, {
        text: `❌ Gagal menyimpan bukti UKT ke Google Drive maupun lokal.\nDrive: ${driveError.message}\nLokal: ${localError.message}`,
      }, { quoted: messageObj });
      return true;
    }
  }

  try {
    await saveManifestRecord(record);
  } catch (error) {
    console.error('[UKT] Gagal mencatat manifest lokal:', error);
  }

  const where = record.source === 'drive'
    ? `Google Drive (${dateParts.year}/${dateParts.monthName})\n${record.driveLink}`
    : `penyimpanan lokal (${dateParts.year}/${dateParts.monthName})\n${record.localPath}\n⚠️ Google Drive gagal: file tetap tersimpan di bot.`;
  await sock.sendMessage(remoteJid, {
    text: `✅ *Bukti UKT berhasil disimpan*\n\n📅 Periode: ${dateParts.monthName} ${dateParts.year}\n📄 File: ${record.filename}\n📁 Lokasi: ${where}`,
  }, { quoted: messageObj });
  return true;
}
