// games/family100.js
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../database/family100.json')));

function getRandom() {
  const randomIndex = Math.floor(Math.random() * data.length);
  const item = data[randomIndex];
  return {
    soal: item.soal,
    jawaban: item.jawaban.map((j) => j.toLowerCase()), // normalisasi
    terjawab: [],
  };
}

function isCorrectAnswer(session, userAnswer) {
  const normalized = userAnswer.toLowerCase();
  return session.jawaban.includes(normalized) && !session.terjawab.includes(normalized);
}

function markAnswer(session, answer) {
  session.terjawab.push(answer.toLowerCase());
}

function isComplete(session) {
  return session.jawaban.length === session.terjawab.length;
}

module.exports = {
  getRandom,
  isCorrectAnswer,
  markAnswer,
  isComplete,
};
