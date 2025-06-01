// db.js
const knex = require('knex');
const Database = require('better-sqlite3');
const db = new Database('reminders.db');

const knexInstance = knex({
  client: 'better-sqlite3',
  connection: {
    filename: './reminders.db',
  },
  useNullAsDefault: true,
});

// Buat tabel untuk menyimpan jadwal
const createTable = () => {
  knexInstance.schema.hasTable('reminders').then((exists) => {
    if (!exists) {
      return knexInstance.schema.createTable('reminders', (table) => {
        table.increments('id');
        table.string('course_name');
        table.string('zoom_link');
        table.string('reminder_time'); // Format waktu "HH:mm"
        table.string('days'); // Hari dalam bentuk "Mon, Tue, Wed"
        table.string('added_by');
      });
    }
  });
};

createTable();

module.exports = knexInstance;
