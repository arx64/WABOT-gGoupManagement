import { Readable } from 'node:stream';
import { formatDriveAuthError, getDriveClient } from './driveClient.js';

export const SEE_DRIVE_FOLDER_NAME = 'About U❤️';

function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function ensureSeeDriveFolder(drive) {
  const parentId = String(process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
  const clauses = [
    "mimeType = 'application/vnd.google-apps.folder'",
    `name = '${escapeDriveQuery(SEE_DRIVE_FOLDER_NAME)}'`,
    'trashed = false',
    `'${escapeDriveQuery(parentId || 'root')}' in parents`,
  ];
  const found = await drive.files.list({
    q: clauses.join(' and '),
    pageSize: 100,
    orderBy: 'createdTime',
    fields: 'files(id,name,mimeType,parents)',
    ...(!parentId ? { corpora: 'user' } : {}),
  });
  const existing = found.data.files?.[0];
  if (existing?.id) return existing.id;

  const created = await drive.files.create({
    requestBody: {
      name: SEE_DRIVE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id,name',
  });
  if (!created.data.id) throw new Error(`Google Drive tidak mengembalikan ID folder ${SEE_DRIVE_FOLDER_NAME}.`);
  return created.data.id;
}

function getFileExtension(media) {
  const originalName = media?.fileName || media?.filename;
  if (originalName && /\.[a-z0-9]{1,8}$/i.test(originalName)) return originalName.match(/\.[a-z0-9]{1,8}$/i)[0];
  const mime = String(media?.mimetype || '').split(';')[0].toLowerCase();
  const extensions = {
    'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
    'video/mp4': '.mp4', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a',
    'application/pdf': '.pdf', 'application/zip': '.zip',
  };
  return extensions[mime] || '';
}

export async function uploadSeeMediaToDrive(buffer, media = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Media kosong, tidak bisa diunggah ke Google Drive.');
  try {
    const drive = getDriveClient();
    const folderId = await ensureSeeDriveFolder(drive);
    const extension = getFileExtension(media);
    const originalName = media?.fileName || media?.filename;
    const filename = originalName || `see_${new Date().toISOString().replace(/[:.]/g, '-')}${extension}`;
    const result = await drive.files.create({
      requestBody: { name: filename, parents: [folderId] },
      media: { mimeType: media?.mimetype || 'application/octet-stream', body: Readable.from(buffer) },
      fields: 'id,name,webViewLink,mimeType,parents',
    });
    if (!result.data.id) throw new Error('Google Drive tidak mengembalikan ID file setelah upload.');
    return {
      ...result.data,
      webViewLink: result.data.webViewLink || `https://drive.google.com/file/d/${result.data.id}/view`,
    };
  } catch (error) {
    throw new Error(formatDriveAuthError(error), { cause: error });
  }
}
