// games/susunkata.js
const fs = require('fs');
const path = require('path');

const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../database/susunkata.json')));

function getRandom() {
  const randomIndex = Math.floor(Math.random() * data.length);
  return data[randomIndex];
}

module.exports = {
  getRandom,
};
