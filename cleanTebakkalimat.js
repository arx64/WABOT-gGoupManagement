const fs = require('fs');

const file = './database/tebakkalimat.json'; // ganti sesuai path kamu
const data = JSON.parse(fs.readFileSync(file));

const cleaned = data.map(item => ({
  ...item,
  jawaban: item.jawaban.trim()
}));

fs.writeFileSync(file, JSON.stringify(cleaned, null, 2));
console.log('✅ Semua spasi dihapus dari jawaban.');
