// games/family100.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../database/family100.json')));

export function getRandom() {
  const randomIndex = Math.floor(Math.random() * data.length);
  const item = data[randomIndex];
  return {
    soal: item.soal,
    jawaban: item.jawaban.map((j) => j.toLowerCase()), // normalisasi
    terjawab: [],
  };
}

export function isCorrectAnswer(session, userAnswer) {
  const normalized = userAnswer.toLowerCase();
  return session.jawaban.includes(normalized) && !session.terjawab.includes(normalized);
}

export function markAnswer(session, answer) {
  session.terjawab.push(answer.toLowerCase());
}

export function isComplete(session) {
  return session.jawaban.length === session.terjawab.length;
}
