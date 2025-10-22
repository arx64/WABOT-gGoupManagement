// db/leaderboard.js
import knex from 'knex';

const knexInstance = knex({
  client: 'sqlite3',
  connection: {
    filename: './leaderboard.db',
  },
  useNullAsDefault: true,
});

export async function getScore(chatId, userJid) {
  const row = await knexInstance('leaderboard').where({ userJid, chatId }).first();
  return row?.score || 0;
}

export async function addScore(chatId, userJid, name, delta = 10) {
  const existing = await knexInstance('leaderboard').where({ userJid, chatId }).first();
  if (existing) {
    await knexInstance('leaderboard')
      .where({ userJid, chatId })
      .update({ score: existing.score + delta });
  } else {
    await knexInstance('leaderboard').insert({ userJid, chatId, name, score: delta });
  }
}

export async function getTopUsers(chatId, limit = 5) {
  return await knexInstance('leaderboard').where({ chatId }).orderBy('score', 'desc').limit(limit);
}

export default knexInstance;
