import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../database/tebaktebakan.json')));
export function getRandom() {
  const idx = Math.floor(Math.random() * data.length);
  return data[idx];
}

export default { getRandom };
