import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getConfiguredUktMonths,
  getUktDateParts,
  getUktLocalDirectory,
  getUktMonthName,
  ensureUktDriveFolder,
  listUktPayments,
  sanitizeUktFilename,
} from './uktManager.js';

test('default UKT periods are January, March, April, May and June', () => {
  assert.deepEqual(getConfiguredUktMonths(''), [1, 3, 4, 5, 6]);
  assert.deepEqual(getConfiguredUktMonths(undefined), [1, 3, 4, 5, 6]);
  assert.deepEqual(getConfiguredUktMonths('Januari,Maret,April,Mei,Juni'), [1, 3, 4, 5, 6]);
});

test('UKT period configuration supports numeric months and deduplicates entries', () => {
  assert.deepEqual(getConfiguredUktMonths('1,03,April,12,3'), [1, 3, 4, 12]);
  assert.throws(() => getConfiguredUktMonths('Februari,bulan-gaib'), /Bulan UKT tidak dikenal/);
  assert.throws(() => getConfiguredUktMonths('13'), /Bulan UKT tidak dikenal/);
});

test('date and folder helpers use year and Indonesian month in the configured timezone', () => {
  const date = new Date('2026-10-12T03:00:00.000Z');
  assert.deepEqual(getUktDateParts(date, 'Asia/Jakarta'), {
    year: 2026,
    month: 10,
    monthName: 'Oktober',
  });
  assert.equal(getUktMonthName(11), 'November');
  assert.equal(getUktLocalDirectory('D:/bot', 2026, 10), path.join('D:/bot', 'uploads', 'ukt', '2026', 'Oktober'));
});

test('Google Drive UKT uploads use UKT Yulia Khairani/year/month folders', async () => {
  const previousRoot = process.env.UKT_DRIVE_ROOT_FOLDER_ID;
  const previousFolder = process.env.GOOGLE_DRIVE_FOLDER_ID;
  process.env.UKT_DRIVE_ROOT_FOLDER_ID = 'parent-root-id';
  delete process.env.GOOGLE_DRIVE_FOLDER_ID;
  const createdFolders = [];
  let nextId = 1;
  const drive = {
    files: {
      list: async () => ({ data: { files: [] } }),
      create: async ({ requestBody }) => {
        const folder = { id: `folder-${nextId++}`, ...requestBody };
        createdFolders.push(folder);
        return { data: { id: folder.id, name: folder.name } };
      },
    },
  };

  try {
    const result = await ensureUktDriveFolder(drive, 2026, 10);
    assert.deepEqual(createdFolders.map(({ name, parents }) => ({ name, parents })), [
      { name: 'UKT Yulia Khairani', parents: ['parent-root-id'] },
      { name: '2026', parents: ['folder-1'] },
      { name: 'Oktober', parents: ['folder-2'] },
    ]);
    assert.deepEqual(result, { yearId: 'folder-2', monthId: 'folder-3', monthName: 'Oktober' });
  } finally {
    if (previousRoot === undefined) delete process.env.UKT_DRIVE_ROOT_FOLDER_ID;
    else process.env.UKT_DRIVE_ROOT_FOLDER_ID = previousRoot;
    if (previousFolder === undefined) delete process.env.GOOGLE_DRIVE_FOLDER_ID;
    else process.env.GOOGLE_DRIVE_FOLDER_ID = previousFolder;
  }
});

test('UKT filename sanitization removes path traversal and invalid filename characters', () => {
  assert.equal(sanitizeUktFilename('../../bukti:ukt?.jpg'), '____bukti_ukt_.jpg');
  assert.equal(sanitizeUktFilename(''), 'bukti-ukt');
});

test('listUktPayments finds uploaded proof in any month and persisted manifest', async () => {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ukt-test-'));
  try {
    const jan = getUktLocalDirectory(rootDir, 2026, 1);
    const feb = getUktLocalDirectory(rootDir, 2026, 2);
    await fs.mkdir(jan, { recursive: true });
    await fs.mkdir(feb, { recursive: true });
    await fs.writeFile(path.join(jan, 'bukti-jan.jpg'), Buffer.from('image'));
    await fs.writeFile(path.join(feb, 'bukti-feb.jpg'), Buffer.from('image'));
    const manifestPath = path.join(rootDir, 'uploads', 'ukt', 'manifest.json');
    await fs.writeFile(manifestPath, JSON.stringify([
      { year: 2025, month: 6, monthName: 'Juni', filename: 'bukti-drive.jpg', source: 'drive', driveFileId: 'abc' },
    ]));

    const records = await listUktPayments({ rootDir, configuredMonths: [1, 6] });
    assert.deepEqual(records.map(({ year, month, filename }) => ({ year, month, filename })), [
      { year: 2026, month: 2, filename: 'bukti-feb.jpg' },
      { year: 2026, month: 1, filename: 'bukti-jan.jpg' },
      { year: 2025, month: 6, filename: 'bukti-drive.jpg' },
    ]);
  } finally {
    await fs.rm(rootDir, { recursive: true, force: true });
  }
});
