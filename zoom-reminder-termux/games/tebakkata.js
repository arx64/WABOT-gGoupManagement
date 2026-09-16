// games/tebakkata.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../database/tebakkata.json')));
export function getRandom() {
  const randomIndex = Math.floor(Math.random() * data.length);
  return data[randomIndex];
}