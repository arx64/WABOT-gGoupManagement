const knex = require('knex')({
  client: 'sqlite3',
  connection: {
    filename: './leaderboard.db',
  },
  useNullAsDefault: true,
});

async function resetLeaderboard() {
  try {
    await knex('leaderboard').truncate();
    console.log('✅ Semua data leaderboard berhasil dihapus.');
  } catch (err) {
    console.error('❌ Gagal hapus leaderboard:', err.message);
  } finally {
    knex.destroy();
  }
}

resetLeaderboard();
