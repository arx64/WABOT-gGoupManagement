exports.up = function (knex) {
  return knex.schema.alterTable('leaderboard', (table) => {
    table.string('chatId').defaultTo('');
  });
};

exports.down = function (knex) {
  return knex.schema.alterTable('leaderboard', (table) => {
    table.dropColumn('chatId');
  });
};
