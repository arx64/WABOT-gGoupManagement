import knex from 'knex';

const knexInstance = knex({
  client: 'sqlite3',
  connection: {
    filename: './leaderboard.db',
  },
  useNullAsDefault: true,
});

export async function resetLeaderboardTable() {
  await knexInstance.schema.dropTableIfExists('leaderboard');

  await knexInstance.schema.createTable('leaderboard', (table) => {
    table.string('userJid');
    table.string('chatId');
    table.string('name');
    table.integer('score').defaultTo(0);
    table.primary(['userJid', 'chatId']); // ✅ ini membuat kombinasi unik
  });

  console.log('✅ Tabel leaderboard berhasil dibuat ulang!');
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  resetLeaderboardTable();
}
