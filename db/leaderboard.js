// db/leaderboard.js
const knex = require('knex')({
  client: 'sqlite3',
  connection: {
    filename: './leaderboard.db',
  },
  useNullAsDefault: true,
});

async function getScore(userJid) {
  const row = await knex('leaderboard').where({ userJid }).first();
  return row?.score || 0;
}

async function addScore(userJid, name, delta = 10) {
  const existing = await knex('leaderboard').where({ userJid }).first();
  if (existing) {
    await knex('leaderboard')
      .where({ userJid })
      .update({ score: existing.score + delta });
  } else {
    await knex('leaderboard').insert({ userJid, name, score: delta });
  }
}

async function getTopUsers(limit = 5) {
  return await knex('leaderboard').orderBy('score', 'desc').limit(limit);
}

module.exports = {
  getScore,
  addScore,
  getTopUsers,
};
