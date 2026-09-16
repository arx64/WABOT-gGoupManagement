import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const file = path.join(__dirname, './database/tebakkalimat.json'); // ganti sesuai path kamu
const data = JSON.parse(fs.readFileSync(file));

const cleaned = data.map(item => ({
  ...item,
  jawaban: item.jawaban.trim()
}));

fs.writeFileSync(file, JSON.stringify(cleaned, null, 2));
console.log('✅ Semua spasi dihapus dari jawaban.');

export default true;
