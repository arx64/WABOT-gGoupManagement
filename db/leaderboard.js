// db/leaderboard.js
const knex = require('knex')({
  client: 'sqlite3',
  connection: {
    filename: './leaderboard.db',
  },
  useNullAsDefault: true,
});

async function getScore(chatId, userJid) {
  const row = await knex('leaderboard').where({ chatId, userJid }).first();
  return row?.score || 0;
}

async function addScore(chatId, userJid, name, delta = 10) {
  const existing = await knex('leaderboard').where({ chatId, userJid }).first();
  if (existing) {
    await knex('leaderboard')
      .where({ chatId, userJid })
      .update({ score: existing.score + delta, name });
  } else {
    await knex('leaderboard').insert({ chatId, userJid, name, score: delta });
  }
}

async function getTopUsers(chatId, limit = 5) {
  return await knex('leaderboard').where({ chatId }).orderBy('score', 'desc').limit(limit);
}

module.exports = {
  getScore,
  addScore,
  getTopUsers,
};
