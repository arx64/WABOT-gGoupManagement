import db from './db.js';

// Ensure table exists
const ensureTable = async () => {
  const exists = await db.schema.hasTable('notes');
  if (!exists) {
    await db.schema.createTable('notes', (table) => {
      table.increments('id');
      table.string('author');
      table.text('content');
      table.timestamp('created_at').defaultTo(db.fn.now());
    });
  }
};

await ensureTable();

export async function createNote(author, content) {
  const [id] = await db('notes').insert({ author, content });
  return id;
}

export async function getNoteById(id) {
  const row = await db('notes').where({ id }).first();
  return row || null;
}

export async function listNotes() {
  const rows = await db.select('id', 'author', 'content', 'created_at').from('notes').orderBy('id', 'asc');
  return rows;
}

export async function deleteNote(id) {
  const affected = await db('notes').where({ id }).del();
  return affected > 0;
}

export default { createNote, getNoteById, listNotes, deleteNote };
