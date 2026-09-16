import knex from 'knex';

const knexInstance = knex({
  client: 'better-sqlite3',
  connection: {
    filename: './leaderboard.db',
  },
  useNullAsDefault: true,
});

async function ensureTable() {
  const exists = await knexInstance.schema.hasTable('leaderboard');
  if (!exists) {
    await knexInstance.schema.createTable('leaderboard', (table) => {
      table.string('userJid');
      table.string('chatId');
      table.string('name');
      table.integer('score').defaultTo(0);
      table.primary(['chatId', 'userJid']);
    });
  }
}

await ensureTable();

export async function getScore(chatId, userJid) {
  const row = await knexInstance('leaderboard').where({ userJid, chatId }).first();
  return row?.score || 0;
}

export async function addScore(chatId, userJid, name, delta = 10) {
  const existing = await knexInstance('leaderboard').where({ userJid, chatId }).first();
  if (existing) {
    await knexInstance('leaderboard')
      .where({ userJid, chatId })
      .update({ name, score: existing.score + delta });
  } else {
    await knexInstance('leaderboard').insert({ userJid, chatId, name, score: delta });
  }
}

export async function getTopUsers(chatId, limit = 5) {
  return await knexInstance('leaderboard').where({ chatId }).orderBy('score', 'desc').limit(limit);
}

export default knexInstance;
