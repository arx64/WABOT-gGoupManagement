import db from './db.js'; // Koneksi ke database

// Fungsi untuk menghapus jadwal berdasarkan ID
export async function deleteReminder(id, numberUser) {
  const deletedRows = await db('reminders').where('id', '=', id).andWhere('added_by', '=', numberUser).del();

  if (deletedRows > 0) {
    console.log(`Jadwal dengan ID ${id} berhasil dihapus.`);
    return `Jadwal dengan ID ${id} berhasil dihapus.`;
  } else {
    console.log(`Jadwal dengan ID ${id} tidak ditemukan.`);
    return `Jadwal dengan ID ${id} tidak ditemukan.`;
  }
}
