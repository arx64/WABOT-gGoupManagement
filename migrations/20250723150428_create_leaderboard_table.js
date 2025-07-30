exports.up = function (knex) {
  return knex.schema.createTable('leaderboard', (table) => {
    table.string('chatId'); // bisa grup atau private chat
    table.string('userJid'); // nomor WA
    table.string('name'); // nama terakhir
    table.integer('score');
    table.primary(['chatId', 'userJid']);
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('leaderboard');
};
