import knex from 'knex';
import Database from 'better-sqlite3';

const dbFile = './reminders.db';
const db = new Database(dbFile);

const knexInstance = knex({
  client: 'better-sqlite3',
  connection: {
    filename: dbFile,
  },
  useNullAsDefault: true,
});

// Buat tabel untuk menyimpan jadwal jika belum ada
const createTable = () => {
  knexInstance.schema
    .hasTable('reminders')
    .then((exists) => {
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
    })
    .catch((err) => {
      console.error('Gagal membuat tabel reminders:', err);
    });
};

createTable();

export default knexInstance;
