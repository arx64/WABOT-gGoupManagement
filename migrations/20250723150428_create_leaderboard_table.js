exports.up = function (knex) {
  return knex.schema.createTable('leaderboard', function (table) {
    table.string('userJid').primary(); // ID unik user (biasanya nomor WA)
    table.string('name'); // Nama user
    table.integer('score'); // Skor total
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('leaderboard');
};
